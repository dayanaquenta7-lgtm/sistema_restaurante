// Pollos, piezas del día, pérdidas (consumo del personal, se quemó, regalo) y gastos de caja.
const express = require('express');
const { z, id, texto, dineroPositivo, entero, fecha } = require('../util/validacion');
const { pool, conUsuario, transaccion, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { soloDueno, atencionODueno } = require('../middleware/auth');
const { obtenerOCrearJornadaHoy, jornadaHoy, jornadaAbiertaHoy, sesionEncargada } = require('../servicios/jornada');
const { stockPiezas, stockGaseosas } = require('../servicios/stock');
const { anotar } = require('../util/bitacora');

const router = express.Router();

const stockPollos = async (cx = pool) => Number(uno((await cx.query('SELECT pollos_crudos FROM v_stock_pollos'))[0]).pollos_crudos);

// ------------------------------------------------------------------ Pollos enteros (crudos)

router.get(
  '/pollos',
  atencionODueno,
  envolver(async (req, res) => {
    const [movimientos] = await pool.query(
      `SELECT m.id, m.tipo, m.cantidad, m.costo_total, m.nota, m.creado_en, e.nombre AS registrado_por
         FROM movimientos_pollo m LEFT JOIN empleados e ON e.id = m.registrado_por
        ORDER BY m.id DESC LIMIT 15`
    );
    res.json({ pollos_crudos: await stockPollos(), movimientos });
  })
);

/** "Llegaron pollos". */
router.post(
  '/pollos/compra',
  soloDueno,
  envolver(async (req, res) => {
    const d = z
      .object({ cantidad: entero(1, 5000), costo_total: dineroPositivo.optional(), nota: texto(1, 200).optional() })
      .parse(req.body);
    await conUsuario(req.usuario.id, (cx) =>
      cx.query("INSERT INTO movimientos_pollo (tipo, cantidad, costo_total, registrado_por, nota) VALUES ('compra', ?, ?, ?, ?)", [
        d.cantidad,
        d.costo_total ?? null,
        req.usuario.id,
        d.nota ?? null,
      ])
    );
    res.status(201).json({ pollos_crudos: await stockPollos() });
  })
);

/** Pollo crudo que se echó a perder (baja el stock). */
router.post(
  '/pollos/merma',
  soloDueno,
  envolver(async (req, res) => {
    const d = z.object({ cantidad: entero(1, 5000), nota: texto(3, 200) }).parse(req.body);
    await transaccion(req.usuario.id, async (cx) => {
      if ((await stockPollos(cx)) < d.cantidad) throw new ErrorApp(409, 'No hay tantos pollos crudos en stock');
      await cx.query("INSERT INTO movimientos_pollo (tipo, cantidad, registrado_por, nota) VALUES ('merma', ?, ?, ?)", [-d.cantidad, req.usuario.id, d.nota]);
    });
    res.status(201).json({ pollos_crudos: await stockPollos() });
  })
);

/** Corrección por conteo: "en realidad tengo N pollos". Queda la diferencia anotada. */
router.post(
  '/pollos/conteo',
  soloDueno,
  envolver(async (req, res) => {
    const d = z.object({ contados: entero(0, 100000), nota: texto(1, 200).optional() }).parse(req.body);
    const diferencia = await transaccion(req.usuario.id, async (cx) => {
      await cx.query('SELECT 1 FROM movimientos_pollo LIMIT 1 FOR UPDATE');
      const sistema = await stockPollos(cx);
      const dif = d.contados - sistema;
      if (dif !== 0) {
        await cx.query("INSERT INTO movimientos_pollo (tipo, cantidad, registrado_por, nota) VALUES ('ajuste', ?, ?, ?)", [
          dif,
          req.usuario.id,
          d.nota ?? 'Conteo físico',
        ]);
      }
      return dif;
    });
    res.json({ pollos_crudos: d.contados, diferencia });
  })
);

/** "Abrir pollos": pasan de pollos crudos a piezas del día (10 presas + 4 aumentos cada uno). */
router.post(
  '/pollos/abrir',
  atencionODueno,
  envolver(async (req, res) => {
    const { cantidad } = z.object({ cantidad: entero(1, 500) }).parse(req.body);
    await conUsuario(req.usuario.id, async (cx) => {
      const jornada = await obtenerOCrearJornadaHoy(cx);
      if (jornada.estado !== 'abierta') throw new ErrorApp(409, 'El día de hoy ya está cerrado.', { codigo: 'JORNADA_CERRADA' });
      await cx.query('CALL sp_abrir_pollos(?, ?, ?)', [jornada.id, cantidad, req.usuario.id]);
    });
    res.status(201).json({ pollos_crudos: await stockPollos(), piezas: await piezasHoy() });
  })
);

// ------------------------------------------------------------------ Piezas del día

async function piezasHoy() {
  const jornada = await jornadaHoy(pool);
  if (!jornada) return [];
  const [filas] = await pool.query(
    `SELECT c.tipo_pieza_id AS id, c.nombre, c.categoria, c.abiertas, c.vendidas, c.perdidas, c.restante
       FROM v_cuadre_piezas c JOIN tipos_pieza p ON p.id = c.tipo_pieza_id
      WHERE c.jornada_id = ? ORDER BY p.orden`,
    [jornada.id]
  );
  return filas.map((f) => ({ ...f, abiertas: Number(f.abiertas), vendidas: Number(f.vendidas), perdidas: Number(f.perdidas), restante: Number(f.restante) }));
}

router.get(
  '/piezas/hoy',
  atencionODueno,
  envolver(async (req, res) => {
    res.json({ piezas: await piezasHoy() });
  })
);

// ------------------------------------------------------------------ Pérdidas (solo CANTIDAD, sin dinero)

const lineaPerdida = z
  .object({ pieza_id: id.optional(), gaseosa_id: id.optional(), cantidad: entero(1, 1000) })
  .refine((l) => (l.pieza_id === undefined) !== (l.gaseosa_id === undefined), 'Cada línea es una pieza o una gaseosa');

router.post(
  '/perdidas',
  atencionODueno,
  envolver(async (req, res) => {
    const d = z
      .object({
        motivo: z.enum(['consumo_personal', 'quemado_o_caido', 'regalo', 'otro']),
        nota: texto(1, 200).optional(),
        items: z.array(lineaPerdida).min(1).max(30),
      })
      .refine((o) => o.motivo !== 'otro' || o.nota, { message: 'Explica el motivo', path: ['nota'] })
      .parse(req.body);

    const ids = await transaccion(req.usuario.id, async (cx) => {
      const jornada = await jornadaAbiertaHoy(cx, true);
      const stockP = await stockPiezas(cx, jornada.id);
      const stockG = await stockGaseosas(cx);
      const creadas = [];
      for (const l of d.items) {
        if (l.pieza_id !== undefined) {
          const p = uno((await cx.query('SELECT id, nombre FROM tipos_pieza WHERE id = ?', [l.pieza_id]))[0]);
          if (!p) throw new ErrorApp(404, 'Esa pieza no existe');
          const quedan = stockP.get(p.id) || 0;
          if (quedan < l.cantidad) throw new ErrorApp(409, `Solo quedan ${Math.max(quedan, 0)} de ${p.nombre.toLowerCase()}`, { codigo: 'SIN_STOCK' });
          stockP.set(p.id, quedan - l.cantidad);
        } else {
          const g = uno((await cx.query('SELECT id, marca, tamano FROM gaseosas WHERE id = ?', [l.gaseosa_id]))[0]);
          if (!g) throw new ErrorApp(404, 'Esa gaseosa no existe');
          const quedan = stockG.get(g.id) || 0;
          if (quedan < l.cantidad) throw new ErrorApp(409, `Solo quedan ${Math.max(quedan, 0)} de ${g.marca} ${g.tamano}`, { codigo: 'SIN_STOCK' });
          stockG.set(g.id, quedan - l.cantidad);
        }
        const [r] = await cx.query(
          'INSERT INTO perdidas (jornada_id, motivo, tipo_pieza_id, gaseosa_id, cantidad, nota, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [jornada.id, d.motivo, l.pieza_id ?? null, l.gaseosa_id ?? null, l.cantidad, d.nota ?? null, req.usuario.id]
        );
        creadas.push(r.insertId);
      }
      return creadas;
    });
    res.status(201).json({ ids, piezas: await piezasHoy() });
  })
);

router.get(
  '/perdidas',
  atencionODueno,
  envolver(async (req, res) => {
    const { fecha: dia } = z.object({ fecha: fecha.optional() }).parse(req.query);
    const [perdidas] = await pool.query(
      `SELECT pe.id, pe.motivo, pe.cantidad, pe.nota, pe.creado_en, pe.anulada,
              COALESCE(t.nombre, CONCAT(g.marca, ' ', g.tamano)) AS producto, e.nombre AS registrado_por
         FROM perdidas pe
         JOIN jornadas j ON j.id = pe.jornada_id
         LEFT JOIN tipos_pieza t ON t.id = pe.tipo_pieza_id
         LEFT JOIN gaseosas g ON g.id = pe.gaseosa_id
         LEFT JOIN empleados e ON e.id = pe.registrado_por
        WHERE j.fecha = COALESCE(?, CURDATE()) ORDER BY pe.id DESC`,
      [dia ?? null]
    );
    res.json({ perdidas: perdidas.map((p) => ({ ...p, anulada: !!p.anulada })) });
  })
);

/** Anular una pérdida mal anotada: el stock vuelve solo y queda en la bitácora. */
router.delete(
  '/perdidas/:id',
  soloDueno,
  envolver(async (req, res) => {
    const perdidaId = id.parse(req.params.id);
    await transaccion(req.usuario.id, async (cx) => {
      const p = uno(
        (
          await cx.query(
            `SELECT pe.id, pe.anulada, j.estado FROM perdidas pe JOIN jornadas j ON j.id = pe.jornada_id WHERE pe.id = ? FOR UPDATE`,
            [perdidaId]
          )
        )[0]
      );
      if (!p) throw new ErrorApp(404, 'Esa pérdida no existe');
      if (p.anulada) throw new ErrorApp(409, 'Esa pérdida ya estaba anulada');
      if (p.estado !== 'abierta') throw new ErrorApp(409, 'Ese día está cerrado. Reábrelo para corregirlo.');
      await cx.query('UPDATE perdidas SET anulada = 1 WHERE id = ?', [perdidaId]);
    });
    res.json({ ok: true, piezas: await piezasHoy() });
  })
);

// ------------------------------------------------------------------ Gastos del día

router.post(
  '/gastos',
  atencionODueno,
  envolver(async (req, res) => {
    const d = z
      .object({ concepto: texto(2, 120), monto: dineroPositivo, de_caja: z.boolean().default(true) })
      .parse(req.body);
    const gastoId = await transaccion(req.usuario.id, async (cx) => {
      const jornada = await jornadaAbiertaHoy(cx, true);
      // El gasto se descuenta del efectivo de quien guarda la caja (la encargada)
      const encargada = d.de_caja ? await sesionEncargada(cx, jornada.id) : null;
      const [r] = await cx.query(
        'INSERT INTO gastos (jornada_id, sesion_caja_id, concepto, monto, pagado_de_caja, registrado_por) VALUES (?, ?, ?, ?, ?, ?)',
        [jornada.id, encargada ? encargada.id : null, d.concepto, d.monto, d.de_caja ? 1 : 0, req.usuario.id]
      );
      return r.insertId;
    });
    res.status(201).json({ id: gastoId });
  })
);

router.get(
  '/gastos',
  atencionODueno,
  envolver(async (req, res) => {
    const { fecha: dia } = z.object({ fecha: fecha.optional() }).parse(req.query);
    const [gastos] = await pool.query(
      `SELECT g.id, g.concepto, g.monto, g.pagado_de_caja, g.creado_en, g.anulado, e.nombre AS registrado_por
         FROM gastos g JOIN jornadas j ON j.id = g.jornada_id LEFT JOIN empleados e ON e.id = g.registrado_por
        WHERE j.fecha = COALESCE(?, CURDATE()) ORDER BY g.id DESC`,
      [dia ?? null]
    );
    res.json({ gastos: gastos.map((g) => ({ ...g, pagado_de_caja: !!g.pagado_de_caja, anulado: !!g.anulado })) });
  })
);

/** Anular un gasto mal anotado. Quien lo anotó puede hacerlo mientras su caja siga abierta; el dueño siempre (con el día abierto). */
router.delete(
  '/gastos/:id',
  atencionODueno,
  envolver(async (req, res) => {
    const gastoId = id.parse(req.params.id);
    await transaccion(req.usuario.id, async (cx) => {
      const g = uno(
        (
          await cx.query(
            `SELECT g.id, g.anulado, g.monto, g.concepto, g.registrado_por, j.estado AS estado_jornada, s.estado AS estado_sesion
               FROM gastos g JOIN jornadas j ON j.id = g.jornada_id LEFT JOIN sesiones_caja s ON s.id = g.sesion_caja_id
              WHERE g.id = ? FOR UPDATE`,
            [gastoId]
          )
        )[0]
      );
      if (!g) throw new ErrorApp(404, 'Ese gasto no existe');
      if (g.anulado) throw new ErrorApp(409, 'Ese gasto ya estaba anulado');
      if (g.estado_jornada !== 'abierta') throw new ErrorApp(409, 'Ese día está cerrado. El dueño debe reabrirlo para corregirlo.');
      if (req.usuario.rol !== 'dueno') {
        if (g.registrado_por !== req.usuario.id) throw new ErrorApp(403, 'Solo quien anotó el gasto o el dueño pueden anularlo');
        if (g.estado_sesion && g.estado_sesion !== 'abierta') throw new ErrorApp(403, 'Esa caja ya se cerró. Pídele al dueño que lo anule.');
      }
      await cx.query('UPDATE gastos SET anulado = 1 WHERE id = ?', [gastoId]);
      await anotar(cx, req.usuario.id, 'anular', 'gastos', gastoId, { concepto: g.concepto, monto: g.monto }, { anulado: 1 });
    });
    res.json({ ok: true });
  })
);

module.exports = router;
module.exports.piezasHoy = piezasHoy;

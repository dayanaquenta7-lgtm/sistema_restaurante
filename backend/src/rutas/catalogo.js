// Menú (presas, aumentos, acompañamientos, recargo de "pura papa") y registro de gaseosas.
const express = require('express');
const { z, id, texto, dinero, entero } = require('../util/validacion');
const { pool, conUsuario, transaccion, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { soloDueno, atencionODueno } = require('../middleware/auth');
const { jornadaHoy } = require('../servicios/jornada');
const { stockPiezas } = require('../servicios/stock');

const router = express.Router();

/** Todo lo que necesita la pantalla de caja para vender, con el stock de hoy. */
router.get(
  '/menu',
  atencionODueno,
  envolver(async (req, res) => {
    const jornada = await jornadaHoy(pool);
    const stock = jornada ? await stockPiezas(pool, jornada.id) : new Map();
    const [piezas] = await pool.query(
      'SELECT id, nombre, categoria, cantidad_por_pollo, precio, orden, activo FROM tipos_pieza ORDER BY orden'
    );
    const [relaciones] = await pool.query('SELECT presa_id, aumento_id FROM presa_aumento');
    const porId = new Map(piezas.map((p) => [p.id, p]));

    const presas = piezas
      .filter((p) => p.categoria === 'presa')
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        cantidad_por_pollo: p.cantidad_por_pollo,
        activo: !!p.activo,
        stock: stock.get(p.id) || 0,
        aumentos: relaciones
          .filter((r) => r.presa_id === p.id)
          .map((r) => porId.get(r.aumento_id))
          .filter(Boolean)
          .map((a) => ({ id: a.id, nombre: a.nombre, activo: !!a.activo, stock: stock.get(a.id) || 0 })),
      }));
    const aumentos = piezas
      .filter((p) => p.categoria === 'aumento')
      .map((p) => ({ id: p.id, nombre: p.nombre, cantidad_por_pollo: p.cantidad_por_pollo, activo: !!p.activo, stock: stock.get(p.id) || 0 }));

    const [acompanamientos] = await pool.query('SELECT id, nombre, precio_porcion, orden, activo FROM acompanamientos ORDER BY orden');
    const [reglas] = await pool.query(
      `SELECT r.id, r.nombre, r.recargo, r.activo, r.acompanamiento_unico_id, a.nombre AS acompanamiento
         FROM reglas_precio r JOIN acompanamientos a ON a.id = r.acompanamiento_unico_id ORDER BY r.id`
    );
    const [gaseosas] = await pool.query(
      'SELECT gaseosa_id AS id, marca, tamano, precio, stock, semaforo FROM v_stock_gaseosas WHERE activo = 1 ORDER BY marca, tamano'
    );

    res.json({
      jornada: jornada ? { id: jornada.id, fecha: jornada.fecha, estado: jornada.estado } : null,
      presas,
      aumentos,
      acompanamientos: acompanamientos.map((a) => ({ ...a, activo: !!a.activo })),
      reglas: reglas.map((r) => ({ ...r, activo: !!r.activo })),
      gaseosas: gaseosas.map((g) => ({ ...g, stock: Number(g.stock) })),
    });
  })
);

// ------------------------------------------------------------------ Cambios del dueño al menú
// (los precios y activaciones quedan anotados solos en la bitácora por la base de datos)

router.patch(
  '/menu/piezas/:id',
  soloDueno,
  envolver(async (req, res) => {
    const piezaId = id.parse(req.params.id);
    const d = z
      .object({ precio: dinero.optional(), activo: z.boolean().optional(), cantidad_por_pollo: entero(1, 20).optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const pieza = uno((await pool.query('SELECT id, categoria FROM tipos_pieza WHERE id = ?', [piezaId]))[0]);
    if (!pieza) throw new ErrorApp(404, 'Esa pieza no existe');
    if (d.precio !== undefined && pieza.categoria === 'aumento') {
      throw new ErrorApp(422, 'Los aumentos no tienen precio: van incluidos con la presa');
    }
    const sets = [];
    const valores = [];
    if (d.precio !== undefined) (sets.push('precio = ?'), valores.push(d.precio));
    if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
    if (d.cantidad_por_pollo !== undefined) (sets.push('cantidad_por_pollo = ?'), valores.push(d.cantidad_por_pollo));
    await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE tipos_pieza SET ${sets.join(', ')} WHERE id = ?`, [...valores, piezaId]));
    res.json({ ok: true });
  })
);

router.patch(
  '/menu/acompanamientos/:id',
  soloDueno,
  envolver(async (req, res) => {
    const acompId = id.parse(req.params.id);
    const d = z
      .object({ precio_porcion: dinero.nullable().optional(), activo: z.boolean().optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const sets = [];
    const valores = [];
    if (d.precio_porcion !== undefined) (sets.push('precio_porcion = ?'), valores.push(d.precio_porcion));
    if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
    const [r] = await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE acompanamientos SET ${sets.join(', ')} WHERE id = ?`, [...valores, acompId]));
    if (r.affectedRows === 0) throw new ErrorApp(404, 'Ese acompañamiento no existe');
    res.json({ ok: true });
  })
);

router.patch(
  '/menu/reglas/:id',
  soloDueno,
  envolver(async (req, res) => {
    const reglaId = id.parse(req.params.id);
    const d = z
      .object({ recargo: dinero.optional(), activo: z.boolean().optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const sets = [];
    const valores = [];
    if (d.recargo !== undefined) (sets.push('recargo = ?'), valores.push(d.recargo));
    if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
    const [r] = await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE reglas_precio SET ${sets.join(', ')} WHERE id = ?`, [...valores, reglaId]));
    if (r.affectedRows === 0) throw new ErrorApp(404, 'Esa regla no existe');
    res.json({ ok: true });
  })
);

// ------------------------------------------------------------------ Gaseosas (las registra el dueño)

router.get(
  '/gaseosas',
  soloDueno,
  envolver(async (req, res) => {
    const [gaseosas] = await pool.query(
      'SELECT gaseosa_id AS id, marca, tamano, precio, stock_minimo, activo, stock, semaforo FROM v_stock_gaseosas ORDER BY activo DESC, marca, tamano'
    );
    res.json({ gaseosas: gaseosas.map((g) => ({ ...g, activo: !!g.activo, stock: Number(g.stock) })) });
  })
);

router.post(
  '/gaseosas',
  soloDueno,
  envolver(async (req, res) => {
    const d = z
      .object({ marca: texto(2, 60), tamano: texto(1, 30), precio: dinero, stock_minimo: entero(0, 1000).optional() })
      .parse(req.body);
    let minimo = d.stock_minimo;
    if (minimo === undefined) {
      const cfg = uno((await pool.query("SELECT valor FROM configuracion WHERE clave = 'stock_minimo_gaseosa'"))[0]);
      minimo = cfg ? Number(cfg.valor) : 6;
    }
    const [r] = await conUsuario(req.usuario.id, (cx) =>
      cx.query('INSERT INTO gaseosas (marca, tamano, precio, stock_minimo) VALUES (?, ?, ?, ?)', [d.marca, d.tamano, d.precio, minimo])
    );
    res.status(201).json({ id: r.insertId });
  })
);

router.patch(
  '/gaseosas/:id',
  soloDueno,
  envolver(async (req, res) => {
    const gaseosaId = id.parse(req.params.id);
    const d = z
      .object({ precio: dinero.optional(), activo: z.boolean().optional(), stock_minimo: entero(0, 1000).optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const sets = [];
    const valores = [];
    if (d.precio !== undefined) (sets.push('precio = ?'), valores.push(d.precio));
    if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
    if (d.stock_minimo !== undefined) (sets.push('stock_minimo = ?'), valores.push(d.stock_minimo));
    const [r] = await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE gaseosas SET ${sets.join(', ')} WHERE id = ?`, [...valores, gaseosaId]));
    if (r.affectedRows === 0) throw new ErrorApp(404, 'Esa gaseosa no existe');
    res.json({ ok: true });
  })
);

const lineasIngreso = z
  .array(z.object({ gaseosa_id: id, cantidad: z.number().int().min(1).max(5000) }))
  .min(1)
  .max(100);

/** "Llegaron gaseosas": una sola pantalla con la lista y una casilla de cantidad por variedad. */
router.post(
  '/gaseosas/ingreso',
  soloDueno,
  envolver(async (req, res) => {
    const d = z.object({ items: lineasIngreso, nota: texto(1, 200).optional() }).parse(req.body);
    await transaccion(req.usuario.id, async (cx) => {
      for (const l of d.items) {
        const g = uno((await cx.query('SELECT id FROM gaseosas WHERE id = ?', [l.gaseosa_id]))[0]);
        if (!g) throw new ErrorApp(404, 'Una de las gaseosas no existe');
        await cx.query(
          "INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, registrado_por, nota) VALUES (?, 'ingreso', ?, ?, ?)",
          [l.gaseosa_id, l.cantidad, req.usuario.id, d.nota ?? null]
        );
      }
    });
    res.status(201).json({ ok: true, lineas: d.items.length });
  })
);

/** "Contar lo que queda": el dueño escribe lo que contó y el sistema registra la diferencia. */
router.post(
  '/gaseosas/conteo',
  soloDueno,
  envolver(async (req, res) => {
    const d = z
      .object({ items: z.array(z.object({ gaseosa_id: id, contado: z.number().int().min(0).max(100000) })).min(1).max(100) })
      .parse(req.body);
    const diferencias = await transaccion(req.usuario.id, async (cx) => {
      const salida = [];
      for (const l of d.items) {
        const g = uno((await cx.query('SELECT id, marca, tamano FROM gaseosas WHERE id = ? FOR UPDATE', [l.gaseosa_id]))[0]);
        if (!g) throw new ErrorApp(404, 'Una de las gaseosas no existe');
        const sistema = Number(uno((await cx.query('SELECT COALESCE(SUM(cantidad), 0) AS s FROM movimientos_gaseosa WHERE gaseosa_id = ?', [g.id]))[0]).s);
        const dif = l.contado - sistema;
        if (dif !== 0) {
          await cx.query(
            "INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, registrado_por, nota) VALUES (?, 'ajuste', ?, ?, 'Conteo físico')",
            [g.id, dif, req.usuario.id]
          );
          salida.push({ gaseosa_id: g.id, nombre: `${g.marca} ${g.tamano}`, sistema, contado: l.contado, diferencia: dif });
        }
      }
      return salida;
    });
    res.json({ ok: true, diferencias });
  })
);

module.exports = router;

// Caja: cada persona abre su sesión, y al cerrar recibe un informe de cuánto debería haber.
// Solo la ENCARGADA guarda el efectivo y responde por él; quien apoya solo registra su horario.
const express = require('express');
const { z, dinero, fecha, texto } = require('../util/validacion');
const { pool, conUsuario, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { atencionODueno, soloDueno } = require('../middleware/auth');
const { resolverTurno, registrarEntrada } = require('../servicios/asistencia');

const router = express.Router();

/** Lo que debería haber en caja ahora (misma fórmula que usa el cierre en la base de datos). */
async function informeSesion(sesionId) {
  const s = uno(
    (
      await pool.query(
        `SELECT s.id, s.es_encargada, s.inicio, s.jornada_id, COALESCE(s.fondo_recibido, 0) AS fondo, e.nombre
           FROM sesiones_caja s JOIN empleados e ON e.id = s.empleado_id WHERE s.id = ?`,
        [sesionId]
      )
    )[0]
  );
  if (!s) return null;
  const ventas = uno(
    (
      await pool.query(
        `SELECT COUNT(*) AS cantidad,
                COALESCE(SUM(CASE WHEN forma_pago = 'efectivo' THEN total END), 0) AS efectivo,
                COALESCE(SUM(CASE WHEN forma_pago = 'qr' THEN total END), 0) AS qr
           FROM ventas WHERE sesion_caja_id = ? AND estado = 'valida'`,
        [sesionId]
      )
    )[0]
  );
  const gastos = uno(
    (
      await pool.query(
        'SELECT COALESCE(SUM(monto), 0) AS total FROM gastos WHERE sesion_caja_id = ? AND pagado_de_caja = 1 AND anulado = 0',
        [sesionId]
      )
    )[0]
  );
  const esperado = (Number(s.fondo) + Number(ventas.efectivo) - Number(gastos.total)).toFixed(2);
  return {
    sesion_id: s.id,
    nombre: s.nombre,
    es_encargada: !!s.es_encargada,
    inicio: s.inicio,
    fondo_inicial: Number(s.fondo).toFixed(2),
    ventas_cantidad: ventas.cantidad,
    ventas_efectivo: ventas.efectivo,
    ventas_qr: ventas.qr,
    venta_total: (Number(ventas.efectivo) + Number(ventas.qr)).toFixed(2),
    gastos_caja: gastos.total,
    efectivo_esperado: esperado,
  };
}

router.get(
  '/estado',
  atencionODueno,
  envolver(async (req, res) => {
    const jornada = uno((await pool.query('SELECT id, fecha, estado, fondo_inicial FROM jornadas WHERE fecha = CURDATE()'))[0]);
    const miSesion = uno(
      (await pool.query("SELECT id, es_encargada, inicio FROM sesiones_caja WHERE empleado_id = ? AND estado = 'abierta'", [req.usuario.id]))[0]
    );
    const encargada = uno(
      (
        await pool.query(
          `SELECT s.id, e.nombre, s.inicio FROM sesiones_caja s JOIN empleados e ON e.id = s.empleado_id
            WHERE s.estado = 'abierta' AND s.es_encargada = 1 LIMIT 1`
        )
      )[0]
    );
    const relevo = jornada
      ? uno(
          (
            await pool.query(
              `SELECT t.id, t.monto_entregado, e.nombre AS entrego
                 FROM traspasos_caja t
                 JOIN sesiones_caja s ON s.id = t.sesion_entrega_id JOIN empleados e ON e.id = s.empleado_id
                WHERE s.jornada_id = ? AND t.estado = 'pendiente' ORDER BY t.id DESC LIMIT 1`,
              [jornada.id]
            )
          )[0]
        )
      : null;

    // Cuánto debería encontrar al abrir la encargada: lo que le entregan, o el cambio que se dejó ayer
    let fondoEsperado = '0.00';
    if (relevo) fondoEsperado = relevo.monto_entregado;
    else if (jornada) fondoEsperado = jornada.fondo_inicial;
    else {
      const ultimo = uno(
        (await pool.query("SELECT fondo_para_manana FROM jornadas WHERE estado = 'cerrada' ORDER BY fecha DESC LIMIT 1"))[0]
      );
      if (ultimo && ultimo.fondo_para_manana !== null) fondoEsperado = ultimo.fondo_para_manana;
    }

    const adentro = uno((await pool.query('SELECT 1 AS si FROM asistencias WHERE empleado_id = ? AND entrada IS NOT NULL AND salida IS NULL', [req.usuario.id]))[0]);
    let turnos = null;
    if (!adentro && req.usuario.rol !== 'dueno') {
      const emp = uno((await pool.query('SELECT id, nombre, turno_habitual_id FROM empleados WHERE id = ?', [req.usuario.id]))[0]);
      try { await resolverTurno(emp); } catch (e) { if (e.extra?.codigo === 'ELEGIR_TURNO') turnos = e.extra.turnos; else throw e; }
    }
    res.json({ jornada, mi_sesion: miSesion, encargada_actual: encargada, relevo_pendiente: relevo, fondo_esperado: fondoEsperado, ya_marco_llegada: !!adentro, elegir_turno: turnos });
  })
);

router.get(
  '/informe',
  atencionODueno,
  envolver(async (req, res) => {
    const miSesion = uno((await pool.query("SELECT id FROM sesiones_caja WHERE empleado_id = ? AND estado = 'abierta'", [req.usuario.id]))[0]);
    if (!miSesion) throw new ErrorApp(409, 'No tienes una caja abierta');
    res.json(await informeSesion(miSesion.id));
  })
);

router.post(
  '/abrir',
  atencionODueno,
  envolver(async (req, res) => {
    const d = z
      .object({ es_encargada: z.boolean().optional(), fondo_recibido: dinero.optional(), turno_id: z.number().int().positive().optional() })
      .parse(req.body ?? {});

    // Si no se indica, quien abre primero es la encargada; los demás apoyan
    let esEncargada = d.es_encargada;
    if (esEncargada === undefined) {
      const hay = uno((await pool.query("SELECT 1 AS hay FROM sesiones_caja WHERE estado = 'abierta' AND es_encargada = 1 LIMIT 1"))[0]);
      esEncargada = !hay;
    }
    if (esEncargada && d.fondo_recibido === undefined) {
      throw new ErrorApp(400, 'Cuenta el efectivo que recibes en caja y escríbelo', { codigo: 'FALTA_FONDO' });
    }

    // "Empezar mi turno": si todavía no marcó su llegada, se marca aquí (el dueño no marca asistencia)
    let llegada = null;
    if (req.usuario.rol !== 'dueno') {
      const adentro = uno((await pool.query('SELECT 1 AS si FROM asistencias WHERE empleado_id = ? AND entrada IS NOT NULL AND salida IS NULL', [req.usuario.id]))[0]);
      if (!adentro) {
        const emp = uno((await pool.query('SELECT id, nombre, turno_habitual_id FROM empleados WHERE id = ?', [req.usuario.id]))[0]);
        const turnoId = await resolverTurno(emp, d.turno_id);
        llegada = await registrarEntrada(req.usuario.id, turnoId);
      }
    }

    const sesionId = await conUsuario(req.usuario.id, async (cx) => {
      await cx.query('CALL sp_abrir_sesion_caja(?, ?, ?, @sesion_id)', [req.usuario.id, esEncargada ? 1 : 0, esEncargada ? d.fondo_recibido : null]);
      return uno((await cx.query('SELECT @sesion_id AS id'))[0]).id;
    });

    const s = uno(
      (
        await pool.query(
          `SELECT s.id AS sesion_id, s.es_encargada, s.fondo_esperado, s.fondo_recibido, tc.estado AS relevo, tc.diferencia
             FROM sesiones_caja s
             LEFT JOIN traspasos_caja tc ON tc.sesion_recibe_id = s.id
            WHERE s.id = ?`,
          [sesionId]
        )
      )[0]
    );
    let mensaje = esEncargada ? 'Caja abierta. Eres la encargada del dinero.' : 'Sesión abierta. Apoyas en caja.';
    if (s.relevo === 'con_diferencia') {
      mensaje += ` Ojo: la caja que recibiste tenía una diferencia de Bs ${Math.abs(Number(s.diferencia))}. Quedó anotada para el dueño.`;
    }
    res.status(201).json({ ...s, es_encargada: !!s.es_encargada, llegada, mensaje });
  })
);

router.post(
  '/cerrar',
  atencionODueno,
  envolver(async (req, res) => {
    const d = z.object({ efectivo_contado: dinero.optional(), motivo: texto(1, 200).optional() }).parse(req.body ?? {});
    const miSesion = uno(
      (await pool.query("SELECT id, es_encargada FROM sesiones_caja WHERE empleado_id = ? AND estado = 'abierta'", [req.usuario.id]))[0]
    );
    if (!miSesion) throw new ErrorApp(409, 'No tienes una caja abierta');
    if (miSesion.es_encargada && d.efectivo_contado === undefined) {
      throw new ErrorApp(400, 'Cuenta el efectivo que hay en caja y escríbelo', { codigo: 'FALTA_CONTADO' });
    }

    // Informe ANTES de cerrar (lo que debería haber); la base calcula lo mismo y lo congela al cerrar
    const informe = await informeSesion(miSesion.id);
    await conUsuario(req.usuario.id, (cx) =>
      cx.query('CALL sp_cerrar_sesion_caja(?, ?, ?)', [miSesion.id, d.efectivo_contado ?? null, d.motivo ?? null])
    );

    const cerrada = uno(
      (
        await pool.query(
          `SELECT id AS sesion_id, fin, ventas_efectivo, ventas_qr, gastos_caja, efectivo_esperado, efectivo_contado, diferencia, motivo_diferencia
             FROM sesiones_caja WHERE id = ?`,
          [miSesion.id]
        )
      )[0]
    );
    const dif = Number(cerrada.diferencia ?? 0);
    const mensaje = !miSesion.es_encargada
      ? 'Sesión cerrada. Gracias por apoyar en caja.'
      : dif === 0
        ? 'Caja cerrada. Todo cuadra.'
        : `Caja cerrada. ${dif < 0 ? 'Faltan' : 'Sobran'} Bs ${Math.abs(dif)}. Quedó anotado para el dueño.`;
    res.json({ ...informe, ...cerrada, mensaje });
  })
);

// Dueño: cierres de caja con nombre, hora y diferencia
router.get(
  '/sesiones',
  soloDueno,
  envolver(async (req, res) => {
    const { fecha: dia } = z.object({ fecha: fecha.optional() }).parse(req.query);
    const [filas] = dia
      ? await pool.query('SELECT * FROM v_sesiones_caja_admin WHERE fecha = ? ORDER BY inicio', [dia])
      : await pool.query('SELECT * FROM v_sesiones_caja_admin WHERE fecha = CURDATE() ORDER BY inicio');
    res.json({ sesiones: filas });
  })
);

module.exports = router;
module.exports.informeSesion = informeSesion;

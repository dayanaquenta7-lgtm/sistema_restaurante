// Sueldos: el sistema calcula con la asistencia; el dueño solo revisa y cierra el periodo.
const express = require('express');
const { z, id, dineroPositivo, fecha, texto } = require('../util/validacion');
const { pool, conUsuario, transaccion, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { soloDueno } = require('../middleware/auth');
const { jornadaAbiertaHoy, sesionEncargada } = require('../servicios/jornada');
const { anotar } = require('../util/bitacora');

const router = express.Router();
router.use(soloDueno);

const hoy = async (cx = pool) => uno((await cx.query('SELECT CURDATE() AS d'))[0]).d;

const periodo = z
  .object({ desde: fecha, hasta: fecha })
  .refine((p) => p.hasta >= p.desde, { message: 'La fecha final no puede ser antes de la inicial', path: ['hasta'] });

router.get(
  '/planillas',
  envolver(async (req, res) => {
    const [planillas] = await pool.query(
      `SELECT p.id, p.periodo_inicio, p.periodo_fin, p.estado, p.cerrada_en, e.nombre AS cerrada_por,
              (SELECT COALESCE(SUM(total_pagar), 0) FROM planilla_detalles d WHERE d.planilla_id = p.id) AS total
         FROM planillas p LEFT JOIN empleados e ON e.id = p.cerrada_por ORDER BY p.periodo_inicio DESC LIMIT 60`
    );
    res.json({ planillas });
  })
);

/** Vista previa: cuánto se pagaría hoy a cada persona (no guarda nada). */
router.get(
  '/planillas/estimar',
  envolver(async (req, res) => {
    const p = periodo.parse(req.query);
    const [resultado] = await pool.query('CALL sp_estimar_planilla(?, ?)', [p.desde, p.hasta]);
    const filas = resultado[0];
    const total = filas.reduce((a, f) => a + Number(f.total_pagar), 0).toFixed(2);
    res.json({ desde: p.desde, hasta: p.hasta, empleados: filas, total });
  })
);

router.post(
  '/planillas',
  envolver(async (req, res) => {
    const p = periodo.parse(req.body);
    if (p.hasta > (await hoy())) throw new ErrorApp(422, 'El periodo no puede terminar en una fecha futura', { codigo: 'PERIODO_FUTURO' });
    const choque = uno(
      (
        await pool.query(
          'SELECT id, periodo_inicio, periodo_fin FROM planillas WHERE periodo_inicio <= ? AND periodo_fin >= ? LIMIT 1',
          [p.hasta, p.desde]
        )
      )[0]
    );
    if (choque) {
      throw new ErrorApp(409, `Ese periodo se cruza con la planilla del ${choque.periodo_inicio} al ${choque.periodo_fin}.`, { codigo: 'PERIODO_CRUZADO' });
    }
    const [r] = await conUsuario(req.usuario.id, (cx) =>
      cx.query('INSERT INTO planillas (periodo_inicio, periodo_fin) VALUES (?, ?)', [p.desde, p.hasta])
    );
    res.status(201).json({ id: r.insertId });
  })
);

/** Cerrar: calcula, congela los montos y marca los adelantos/bonos como usados. */
router.post(
  '/planillas/:id/cerrar',
  envolver(async (req, res) => {
    const planillaId = id.parse(req.params.id);
    const pl = uno((await pool.query('SELECT id, estado, periodo_fin FROM planillas WHERE id = ?', [planillaId]))[0]);
    if (!pl) throw new ErrorApp(404, 'Esa planilla no existe');
    if (pl.estado !== 'abierta') throw new ErrorApp(409, 'Esa planilla ya está cerrada');
    if (pl.periodo_fin > (await hoy())) throw new ErrorApp(422, 'El periodo aún no terminó', { codigo: 'PERIODO_FUTURO' });
    await conUsuario(req.usuario.id, (cx) => cx.query('CALL sp_cerrar_planilla(?, ?)', [planillaId, req.usuario.id]));
    res.json({ ok: true });
  })
);

router.get(
  '/planillas/:id',
  envolver(async (req, res) => {
    const planillaId = id.parse(req.params.id);
    const pl = uno((await pool.query('SELECT * FROM planillas WHERE id = ?', [planillaId]))[0]);
    if (!pl) throw new ErrorApp(404, 'Esa planilla no existe');
    if (pl.estado === 'abierta') {
      const [r] = await pool.query('CALL sp_estimar_planilla(?, ?)', [pl.periodo_inicio, pl.periodo_fin]);
      return res.json({ planilla: pl, vista_previa: true, detalles: r[0] });
    }
    const [detalles] = await pool.query(
      'SELECT d.*, e.nombre FROM planilla_detalles d JOIN empleados e ON e.id = d.empleado_id WHERE d.planilla_id = ? ORDER BY e.nombre',
      [planillaId]
    );
    const total = detalles.reduce((a, f) => a + Number(f.total_pagar), 0).toFixed(2);
    res.json({ planilla: pl, vista_previa: false, detalles, total });
  })
);

/** Boleta de una persona: el detalle de su pago, con los días que faltó o llegó tarde. */
router.get(
  '/planillas/:id/boleta/:empleadoId',
  envolver(async (req, res) => {
    const planillaId = id.parse(req.params.id);
    const empleadoId = id.parse(req.params.empleadoId);
    const pl = uno((await pool.query('SELECT * FROM planillas WHERE id = ?', [planillaId]))[0]);
    if (!pl) throw new ErrorApp(404, 'Esa planilla no existe');
    let detalle;
    if (pl.estado === 'cerrada') {
      detalle = uno(
        (
          await pool.query(
            'SELECT d.*, e.nombre FROM planilla_detalles d JOIN empleados e ON e.id = d.empleado_id WHERE d.planilla_id = ? AND d.empleado_id = ?',
            [planillaId, empleadoId]
          )
        )[0]
      );
    } else {
      const [r] = await pool.query('CALL sp_estimar_planilla(?, ?)', [pl.periodo_inicio, pl.periodo_fin]);
      detalle = r[0].find((f) => f.empleado_id === empleadoId) || null;
    }
    if (!detalle) throw new ErrorApp(404, 'Esa persona no está en esta planilla');
    const [dias] = await pool.query(
      `SELECT a.fecha, t.nombre AS turno, a.estado, a.falta_justificada, a.entrada, a.salida, a.minutos_atraso
         FROM asistencias a JOIN turnos t ON t.id = a.turno_id
        WHERE a.empleado_id = ? AND a.fecha BETWEEN ? AND ? ORDER BY a.fecha, a.entrada`,
      [empleadoId, pl.periodo_inicio, pl.periodo_fin]
    );
    const [ajustes] = await pool.query(
      `SELECT tipo, monto, fecha, nota FROM ajustes_sueldo
        WHERE empleado_id = ? AND fecha BETWEEN ? AND ? AND (planilla_id = ? OR planilla_id IS NULL) ORDER BY fecha`,
      [empleadoId, pl.periodo_inicio, pl.periodo_fin, planillaId]
    );
    res.json({ planilla: pl, detalle, dias, ajustes });
  })
);

// ------------------------------------------------------------------ Adelantos y bonos

router.get(
  '/ajustes-sueldo',
  envolver(async (req, res) => {
    const q = z.object({ empleado_id: id.optional(), pendientes: z.enum(['1', '0']).optional() }).parse(req.query);
    const [ajustes] = await pool.query(
      `SELECT a.id, a.empleado_id, e.nombre, a.tipo, a.monto, a.fecha, a.nota, a.planilla_id, a.gasto_id
         FROM ajustes_sueldo a JOIN empleados e ON e.id = a.empleado_id
        WHERE (? IS NULL OR a.empleado_id = ?) AND (? IS NULL OR (a.planilla_id IS NULL) = (? = '1'))
        ORDER BY a.fecha DESC, a.id DESC LIMIT 200`,
      [q.empleado_id ?? null, q.empleado_id ?? null, q.pendientes ?? null, q.pendientes ?? null]
    );
    res.json({ ajustes });
  })
);

router.post(
  '/ajustes-sueldo',
  envolver(async (req, res) => {
    const d = z
      .object({
        empleado_id: id,
        tipo: z.enum(['adelanto', 'bono']),
        monto: dineroPositivo,
        fecha: fecha.optional(),
        nota: texto(1, 200).optional(),
        de_caja: z.boolean().default(false),
      })
      .parse(req.body);
    if (d.de_caja && d.tipo !== 'adelanto') throw new ErrorApp(422, 'Solo un adelanto puede salir de la caja');

    const resultado = await transaccion(req.usuario.id, async (cx) => {
      const emp = uno((await cx.query("SELECT id, nombre, rol FROM empleados WHERE id = ? AND activo = 1", [d.empleado_id]))[0]);
      if (!emp || emp.rol === 'dueno') throw new ErrorApp(404, 'Esa persona no está en la planilla');
      const dia = d.fecha ?? (await hoy(cx));
      const cerrada = uno(
        (await cx.query("SELECT periodo_inicio, periodo_fin FROM planillas WHERE estado = 'cerrada' AND periodo_inicio <= ? AND periodo_fin >= ? LIMIT 1", [dia, dia]))[0]
      );
      if (cerrada) {
        throw new ErrorApp(409, `Ese día ya está en una planilla cerrada (${cerrada.periodo_inicio} al ${cerrada.periodo_fin}). Usa una fecha posterior.`, { codigo: 'PLANILLA_CERRADA' });
      }
      let gastoId = null;
      if (d.de_caja) {
        const jornada = await jornadaAbiertaHoy(cx, true);
        const encargada = await sesionEncargada(cx, jornada.id);
        const [g] = await cx.query(
          'INSERT INTO gastos (jornada_id, sesion_caja_id, concepto, monto, pagado_de_caja, registrado_por) VALUES (?, ?, ?, ?, 1, ?)',
          [jornada.id, encargada.id, `Adelanto de sueldo: ${emp.nombre}`, d.monto, req.usuario.id]
        );
        gastoId = g.insertId;
      }
      const [r] = await cx.query(
        'INSERT INTO ajustes_sueldo (empleado_id, tipo, monto, fecha, nota, gasto_id, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [d.empleado_id, d.tipo, d.monto, dia, d.nota ?? null, gastoId, req.usuario.id]
      );
      await anotar(cx, req.usuario.id, 'crear', 'ajustes_sueldo', r.insertId, null, { empleado: emp.nombre, tipo: d.tipo, monto: d.monto, de_caja: d.de_caja });
      return r.insertId;
    });
    res.status(201).json({ id: resultado });
  })
);

/** Borrar un adelanto/bono mal puesto (solo si todavía no entró a una planilla cerrada). */
router.delete(
  '/ajustes-sueldo/:id',
  envolver(async (req, res) => {
    const ajusteId = id.parse(req.params.id);
    await transaccion(req.usuario.id, async (cx) => {
      const a = uno((await cx.query('SELECT * FROM ajustes_sueldo WHERE id = ? FOR UPDATE', [ajusteId]))[0]);
      if (!a) throw new ErrorApp(404, 'Ese registro no existe');
      if (a.planilla_id) throw new ErrorApp(409, 'Ya se descontó en una planilla cerrada y no se puede borrar');
      if (a.gasto_id) {
        const g = uno(
          (await cx.query('SELECT g.anulado, j.estado, s.estado AS estado_sesion FROM gastos g JOIN jornadas j ON j.id = g.jornada_id LEFT JOIN sesiones_caja s ON s.id = g.sesion_caja_id WHERE g.id = ? FOR UPDATE', [a.gasto_id]))[0]
        );
        if (g && !g.anulado) {
          if (g.estado !== 'abierta') throw new ErrorApp(409, 'El adelanto salió de una caja de un día ya cerrado. Reabre ese día para corregirlo.');
          await cx.query('UPDATE gastos SET anulado = 1 WHERE id = ?', [a.gasto_id]);
          await anotar(cx, req.usuario.id, 'anular', 'gastos', a.gasto_id, { concepto: 'Adelanto de sueldo' }, { anulado: 1 });
        }
      }
      await cx.query('DELETE FROM ajustes_sueldo WHERE id = ?', [ajusteId]);
      await anotar(cx, req.usuario.id, 'borrar', 'ajustes_sueldo', ajusteId, { tipo: a.tipo, monto: a.monto, empleado_id: a.empleado_id }, null);
    });
    res.json({ ok: true });
  })
);

module.exports = router;

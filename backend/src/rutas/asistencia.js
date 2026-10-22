// Asistencia: lo único que genera pago. Se marca en la tablet fija del local con el PIN.
// No hay botones de "entrada" y "salida": si la persona no tiene entrada abierta, es entrada; si la tiene, es salida.
const express = require('express');
const { z, pin, id, fecha } = require('../util/validacion');
const { pool, conUsuario, uno } = require('../db');
const config = require('../config');
const { envolver, ErrorApp } = require('../util/errores');
const { hmacPin } = require('../util/seguridad');
const { soloDueno, atencionODueno } = require('../middleware/auth');
const { limiteIntentos, exigirTablet } = require('../middleware/seguridad-http');
const { turnosActivos, resolverTurno, registrarEntrada } = require('../servicios/asistencia');

const router = express.Router();

// Turnos activos (la tablet los muestra como botones grandes cuando hay que elegir)
router.get(
  '/turnos',
  envolver(async (req, res) => {
    const [turnos] = await pool.query(
      "SELECT id, nombre, TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin FROM turnos WHERE activo = 1 ORDER BY hora_inicio, id"
    );
    res.json({ turnos });
  })
);

router.post(
  '/marcar',
  limiteIntentos,
  exigirTablet,
  envolver(async (req, res) => {
    const { pin: pinIngresado, turno_id: turnoElegido } = z
      .object({ pin, turno_id: z.number().int().positive().optional() })
      .parse(req.body);

    const empleado = uno(
      (
        await pool.query('SELECT id, nombre, rol, turno_habitual_id FROM empleados WHERE pin_hmac = ? AND activo = 1', [
          hmacPin(pinIngresado),
        ])
      )[0]
    );
    if (!empleado) throw new ErrorApp(401, 'PIN incorrecto', { codigo: 'PIN_INCORRECTO' });

    const abierta = uno(
      (
        await pool.query(
          `SELECT a.id, a.entrada, a.turno_id, t.nombre AS turno, TIMESTAMPDIFF(SECOND, a.entrada, NOW()) AS segundos
             FROM asistencias a JOIN turnos t ON t.id = a.turno_id
            WHERE a.empleado_id = ? AND a.entrada IS NOT NULL AND a.salida IS NULL`,
          [empleado.id]
        )
      )[0]
    );

    // ---------- SALIDA ----------
    if (abierta) {
      if (abierta.segundos < config.esperaSalidaSeg) {
        throw new ErrorApp(409, `Ya marcaste tu entrada hace un momento, ${empleado.nombre}.`, { codigo: 'ENTRADA_RECIENTE' });
      }
      const caja = uno(
        (await pool.query("SELECT id, es_encargada FROM sesiones_caja WHERE empleado_id = ? AND estado = 'abierta'", [empleado.id]))[0]
      );
      if (caja && caja.es_encargada) {
        throw new ErrorApp(409, 'Primero cierra tu caja (cuenta el dinero) y después marca tu salida.', { codigo: 'CAJA_ABIERTA' });
      }
      if (caja) {
        // Quien solo apoyaba en caja no responde por dinero: se cierra su sesión sola
        await conUsuario(empleado.id, (cx) => cx.query('CALL sp_cerrar_sesion_caja(?, NULL, NULL)', [caja.id]));
      }
      const [r] = await pool.query(
        `UPDATE asistencias a JOIN turnos t ON t.id = a.turno_id
            SET a.salida = NOW(),
                a.minutos_extra = LEAST(GREATEST(0, TIMESTAMPDIFF(MINUTE, TIMESTAMP(a.fecha, t.hora_fin), NOW())), 65535)
          WHERE a.id = ? AND a.salida IS NULL`,
        [abierta.id]
      );
      if (r.affectedRows === 0) throw new ErrorApp(409, 'Tu salida ya estaba registrada');
      const ahora = uno((await pool.query("SELECT DATE_FORMAT(NOW(), '%H:%i') AS hora"))[0]).hora;
      return res.json({ accion: 'salida', nombre: empleado.nombre, hora: ahora, turno: abierta.turno, mensaje: `Hasta luego, ${empleado.nombre}. Salida registrada ${ahora}.` });
    }

    // ---------- ENTRADA ----------
    const turnoId = await resolverTurno(empleado, turnoElegido);
    const fila = await registrarEntrada(empleado.id, turnoId);
    const atraso = fila.minutos_atraso > 0 ? ` Llegaste ${fila.minutos_atraso} min tarde.` : '';
    res.json({
      accion: 'entrada',
      nombre: empleado.nombre,
      hora: fila.hora,
      turno: fila.turno,
      minutos_atraso: fila.minutos_atraso,
      mensaje: `Hola ${empleado.nombre}. Entrada registrada ${fila.hora}.${atraso}`,
    });
  })
);

// "Terminar mi turno": quien atiende marca su salida desde su propia pantalla (sin ir a la tablet).
// Antes debe haber cerrado su caja si era la encargada del dinero.
router.post(
  '/mi-salida',
  atencionODueno,
  envolver(async (req, res) => {
    const abierta = uno(
      (
        await pool.query(
          `SELECT a.id, t.nombre AS turno FROM asistencias a JOIN turnos t ON t.id = a.turno_id
            WHERE a.empleado_id = ? AND a.entrada IS NOT NULL AND a.salida IS NULL`,
          [req.usuario.id]
        )
      )[0]
    );
    if (!abierta) throw new ErrorApp(409, 'No tienes una entrada abierta: ya marcaste tu salida.', { codigo: 'SIN_ENTRADA' });
    const caja = uno((await pool.query("SELECT id, es_encargada FROM sesiones_caja WHERE empleado_id = ? AND estado = 'abierta'", [req.usuario.id]))[0]);
    if (caja && caja.es_encargada) throw new ErrorApp(409, 'Primero cierra tu caja (cuenta el dinero) y después marca tu salida.', { codigo: 'CAJA_ABIERTA' });
    if (caja) await conUsuario(req.usuario.id, (cx) => cx.query('CALL sp_cerrar_sesion_caja(?, NULL, NULL)', [caja.id]));
    await pool.query(
      `UPDATE asistencias a JOIN turnos t ON t.id = a.turno_id
          SET a.salida = NOW(),
              a.minutos_extra = LEAST(GREATEST(0, TIMESTAMPDIFF(MINUTE, TIMESTAMP(a.fecha, t.hora_fin), NOW())), 65535)
        WHERE a.id = ? AND a.salida IS NULL`,
      [abierta.id]
    );
    const ahora = uno((await pool.query("SELECT DATE_FORMAT(NOW(), '%H:%i') AS hora"))[0]).hora;
    res.json({ accion: 'salida', hora: ahora, turno: abierta.turno, mensaje: `Hasta luego, ${req.usuario.nombre}. Salida registrada ${ahora}.` });
  })
);

// ---------------- Solo el dueño: ver y corregir ----------------

router.get(
  '/hoy',
  soloDueno,
  envolver(async (req, res) => {
    const [filas] = await pool.query('SELECT * FROM v_asistencia_admin WHERE fecha = CURDATE() ORDER BY entrada');
    res.json({ asistencias: filas });
  })
);

router.get(
  '/',
  soloDueno,
  envolver(async (req, res) => {
    const { desde, hasta } = z.object({ desde: fecha, hasta: fecha }).parse(req.query);
    const [filas] = await pool.query(
      `SELECT a.id, a.fecha, e.nombre, t.nombre AS turno, a.estado, a.entrada, a.salida,
              a.minutos_atraso, a.minutos_extra, a.falta_justificada, a.nota
         FROM asistencias a JOIN empleados e ON e.id = a.empleado_id JOIN turnos t ON t.id = a.turno_id
        WHERE a.fecha BETWEEN ? AND ? ORDER BY a.fecha DESC, a.entrada`,
      [desde, hasta]
    );
    res.json({ asistencias: filas });
  })
);

// Marcar una falta (con o sin justificación)
router.post(
  '/falta',
  soloDueno,
  envolver(async (req, res) => {
    const d = z
      .object({ empleado_id: id, turno_id: id, fecha, justificada: z.boolean().default(false), nota: z.string().trim().max(200).optional() })
      .parse(req.body);
    const [r] = await conUsuario(req.usuario.id, (cx) =>
      cx.query(
        "INSERT INTO asistencias (empleado_id, turno_id, fecha, estado, falta_justificada, nota) VALUES (?, ?, ?, 'falta', ?, ?)",
        [d.empleado_id, d.turno_id, d.fecha, d.justificada ? 1 : 0, d.nota ?? null]
      )
    );
    res.status(201).json({ id: r.insertId });
  })
);

// Corregir una asistencia (queda en la bitácora con el valor anterior)
router.patch(
  '/:id',
  soloDueno,
  envolver(async (req, res) => {
    const asistenciaId = id.parse(req.params.id);
    const fechaHora = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/, 'Usa el formato AAAA-MM-DD HH:MM');
    const d = z
      .object({
        entrada: fechaHora.nullable().optional(),
        salida: fechaHora.nullable().optional(),
        estado: z.enum(['presente', 'falta', 'permiso']).optional(),
        minutos_atraso: z.number().int().min(0).max(1440).optional(),
        falta_justificada: z.boolean().optional(),
        nota: z.string().trim().max(200).nullable().optional(),
      })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);

    const sets = [];
    const valores = [];
    for (const [campo, valor] of Object.entries(d)) {
      sets.push(`${campo} = ?`);
      valores.push(campo === 'falta_justificada' ? (valor ? 1 : 0) : valor);
    }
    const [r] = await conUsuario(req.usuario.id, (cx) =>
      cx.query(`UPDATE asistencias SET ${sets.join(', ')} WHERE id = ?`, [...valores, asistenciaId])
    );
    if (r.affectedRows === 0) throw new ErrorApp(404, 'Esa asistencia no existe');
    res.json({ ok: true });
  })
);

// ---------------- Plan semanal (opcional) ----------------

router.get(
  '/plan',
  soloDueno,
  envolver(async (req, res) => {
    const { desde, hasta } = z.object({ desde: fecha, hasta: fecha }).parse(req.query);
    const [filas] = await pool.query(
      `SELECT p.empleado_id, e.nombre, p.fecha, p.turno_id, t.nombre AS turno
         FROM asignaciones_turno p JOIN empleados e ON e.id = p.empleado_id JOIN turnos t ON t.id = p.turno_id
        WHERE p.fecha BETWEEN ? AND ? ORDER BY p.fecha, e.nombre`,
      [desde, hasta]
    );
    res.json({ plan: filas });
  })
);

router.put(
  '/plan',
  soloDueno,
  envolver(async (req, res) => {
    const { asignaciones } = z
      .object({ asignaciones: z.array(z.object({ empleado_id: id, fecha, turno_id: id.nullable() })).min(1).max(400) })
      .parse(req.body);
    await conUsuario(req.usuario.id, async (cx) => {
      for (const a of asignaciones) {
        if (a.turno_id === null) {
          await cx.query('DELETE FROM asignaciones_turno WHERE empleado_id = ? AND fecha = ?', [a.empleado_id, a.fecha]);
        } else {
          await cx.query(
            'INSERT INTO asignaciones_turno (empleado_id, fecha, turno_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE turno_id = VALUES(turno_id)',
            [a.empleado_id, a.fecha, a.turno_id]
          );
        }
      }
    });
    res.json({ ok: true, guardadas: asignaciones.length });
  })
);

module.exports = router;

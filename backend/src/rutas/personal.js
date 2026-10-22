// Personal y turnos: el dueño registra nombre, turno, PIN y sueldo; el sistema calcula el resto.
const express = require('express');
const { z, id, texto, dinero, pin, fecha } = require('../util/validacion');
const { pool, conUsuario, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { hmacPin, hashClave, verificarClave } = require('../util/seguridad');
const { soloDueno, requiereSesion } = require('../middleware/auth');
const { anotar } = require('../util/bitacora');

const router = express.Router();

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa la hora en formato HH:MM (por ejemplo 18:00)');
const tipoPago = z.enum(['mensual', 'diario', 'por_turno']);

// ------------------------------------------------------------------ Empleados

router.get(
  '/empleados',
  soloDueno,
  envolver(async (req, res) => {
    const [empleados] = await pool.query(
      `SELECT e.id, e.nombre, e.cargo, e.rol, e.tipo_pago, e.monto_pago, e.turno_habitual_id,
              t.nombre AS turno_habitual, e.fecha_ingreso, e.activo,
              EXISTS(SELECT 1 FROM asistencias a WHERE a.empleado_id = e.id AND a.entrada IS NOT NULL AND a.salida IS NULL) AS adentro,
              EXISTS(SELECT 1 FROM asistencias a WHERE a.empleado_id = e.id AND a.fecha = CURDATE() AND a.estado = 'presente') AS vino_hoy
         FROM empleados e LEFT JOIN turnos t ON t.id = e.turno_habitual_id
        ORDER BY e.activo DESC, e.rol = 'dueno' DESC, e.nombre`
    );
    res.json({ empleados: empleados.map((e) => ({ ...e, activo: !!e.activo, adentro: !!e.adentro, vino_hoy: !!e.vino_hoy })) });
  })
);

router.post(
  '/empleados',
  soloDueno,
  envolver(async (req, res) => {
    const d = z
      .object({
        nombre: texto(2, 100),
        cargo: texto(1, 50).optional(),
        rol: z.enum(['atencion', 'solo_asistencia']).default('atencion'),
        pin,
        tipo_pago: tipoPago.default('mensual'),
        monto_pago: dinero,
        turno_habitual_id: id.optional(),
        fecha_ingreso: fecha.optional(),
      })
      .parse(req.body);

    const [r] = await conUsuario(req.usuario.id, (cx) =>
      cx.query(
        `INSERT INTO empleados (nombre, cargo, rol, pin_hmac, tipo_pago, monto_pago, turno_habitual_id, fecha_ingreso)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.nombre, d.cargo ?? null, d.rol, hmacPin(d.pin), d.tipo_pago, d.monto_pago, d.turno_habitual_id ?? null, d.fecha_ingreso ?? null]
      )
    );
    await conUsuario(req.usuario.id, (cx) =>
      anotar(cx, req.usuario.id, 'crear', 'empleados', r.insertId, null, {
        nombre: d.nombre,
        rol: d.rol,
        tipo_pago: d.tipo_pago,
        monto_pago: d.monto_pago,
      })
    );
    res.status(201).json({ id: r.insertId });
  })
);

// Cambiar MI contraseña (solo el dueño). Va antes de /empleados/:id.
router.post(
  '/empleados/mi-clave',
  soloDueno,
  envolver(async (req, res) => {
    const d = z.object({ clave_actual: z.string().min(1).max(200), clave_nueva: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200) }).parse(req.body);
    const yo = uno((await pool.query('SELECT clave_hash FROM empleados WHERE id = ?', [req.usuario.id]))[0]);
    if (!(await verificarClave(d.clave_actual, yo?.clave_hash))) {
      throw new ErrorApp(401, 'La contraseña actual no es correcta', { codigo: 'CLAVE_INCORRECTA' });
    }
    await conUsuario(req.usuario.id, async (cx) => {
      await cx.query('UPDATE empleados SET clave_hash = ? WHERE id = ?', [await hashClave(d.clave_nueva), req.usuario.id]);
      await anotar(cx, req.usuario.id, 'cambiar_clave', 'empleados', req.usuario.id);
    });
    res.json({ ok: true });
  })
);

const CAMPOS_EDITABLES = {
  nombre: (v) => v,
  cargo: (v) => v,
  rol: (v) => v,
  tipo_pago: (v) => v,
  monto_pago: (v) => v,
  turno_habitual_id: (v) => v,
  fecha_ingreso: (v) => v,
  activo: (v) => (v ? 1 : 0),
};

router.patch(
  '/empleados/:id',
  soloDueno,
  envolver(async (req, res) => {
    const empleadoId = id.parse(req.params.id);
    const d = z
      .object({
        nombre: texto(2, 100).optional(),
        cargo: texto(1, 50).nullable().optional(),
        rol: z.enum(['atencion', 'solo_asistencia']).optional(),
        tipo_pago: tipoPago.optional(),
        monto_pago: dinero.optional(),
        turno_habitual_id: id.nullable().optional(),
        fecha_ingreso: fecha.nullable().optional(),
        activo: z.boolean().optional(),
      })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);

    const emp = uno((await pool.query('SELECT id, nombre, rol, activo FROM empleados WHERE id = ?', [empleadoId]))[0]);
    if (!emp) throw new ErrorApp(404, 'Esa persona no existe');
    if (emp.rol === 'dueno' && (d.rol !== undefined || d.activo === false)) {
      throw new ErrorApp(422, 'No se puede cambiar el rol ni desactivar al dueño');
    }
    if (d.activo === false) {
      const [[ocupado]] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM sesiones_caja WHERE empleado_id = ? AND estado = 'abierta') AS cajas,
                (SELECT COUNT(*) FROM asistencias WHERE empleado_id = ? AND entrada IS NOT NULL AND salida IS NULL) AS adentro`,
        [empleadoId, empleadoId]
      );
      if (Number(ocupado.cajas) > 0) throw new ErrorApp(409, `${emp.nombre} tiene la caja abierta. Ciérrala antes de desactivarla.`);
      if (Number(ocupado.adentro) > 0) throw new ErrorApp(409, `${emp.nombre} no marcó su salida. Marca la salida antes de desactivarla.`);
    }

    const sets = [];
    const valores = [];
    for (const [campo, valor] of Object.entries(d)) {
      sets.push(`${campo} = ?`);
      valores.push(CAMPOS_EDITABLES[campo](valor));
    }
    await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE empleados SET ${sets.join(', ')} WHERE id = ?`, [...valores, empleadoId]));
    if (d.activo === false || d.rol !== undefined) {
      await pool.query('DELETE FROM sesiones_app WHERE empleado_id = ?', [empleadoId]);
    }
    res.json({ ok: true });
  })
);

// El dueño puede asignar un PIN nuevo (nunca puede VER el PIN de nadie: se guarda cifrado)
router.post(
  '/empleados/:id/pin',
  soloDueno,
  envolver(async (req, res) => {
    const empleadoId = id.parse(req.params.id);
    const { pin: nuevo } = z.object({ pin }).parse(req.body);
    const [r] = await conUsuario(req.usuario.id, (cx) => cx.query('UPDATE empleados SET pin_hmac = ? WHERE id = ?', [hmacPin(nuevo), empleadoId]));
    if (r.affectedRows === 0) throw new ErrorApp(404, 'Esa persona no existe');
    await pool.query('DELETE FROM sesiones_app WHERE empleado_id = ?', [empleadoId]);
    res.json({ ok: true });
  })
);

// ------------------------------------------------------------------ Turnos

router.get(
  '/turnos',
  requiereSesion,
  envolver(async (req, res) => {
    const [turnos] = await pool.query(
      "SELECT id, nombre, TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin, activo FROM turnos ORDER BY hora_inicio, id"
    );
    res.json({ turnos: turnos.map((t) => ({ ...t, activo: !!t.activo })) });
  })
);

router.post(
  '/turnos',
  soloDueno,
  envolver(async (req, res) => {
    const d = z.object({ nombre: texto(2, 30), hora_inicio: hora, hora_fin: hora }).parse(req.body);
    if (d.hora_fin <= d.hora_inicio) throw new ErrorApp(422, 'El turno debe terminar el mismo día, después de la hora de inicio');
    const [r] = await pool.query('INSERT INTO turnos (nombre, hora_inicio, hora_fin) VALUES (?, ?, ?)', [d.nombre, d.hora_inicio, d.hora_fin]);
    await conUsuario(req.usuario.id, (cx) => anotar(cx, req.usuario.id, 'crear', 'turnos', r.insertId, null, d));
    res.status(201).json({ id: r.insertId });
  })
);

router.patch(
  '/turnos/:id',
  soloDueno,
  envolver(async (req, res) => {
    const turnoId = id.parse(req.params.id);
    const d = z
      .object({ nombre: texto(2, 30).optional(), hora_inicio: hora.optional(), hora_fin: hora.optional(), activo: z.boolean().optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const antes = uno(
      (await pool.query("SELECT nombre, TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin, activo FROM turnos WHERE id = ?", [turnoId]))[0]
    );
    if (!antes) throw new ErrorApp(404, 'Ese turno no existe');
    const final = { ...antes, ...d, activo: d.activo === undefined ? antes.activo : d.activo ? 1 : 0 };
    if (final.hora_fin <= final.hora_inicio) throw new ErrorApp(422, 'El turno debe terminar el mismo día, después de la hora de inicio');
    await pool.query('UPDATE turnos SET nombre = ?, hora_inicio = ?, hora_fin = ?, activo = ? WHERE id = ?', [
      final.nombre,
      final.hora_inicio,
      final.hora_fin,
      final.activo,
      turnoId,
    ]);
    await conUsuario(req.usuario.id, (cx) => anotar(cx, req.usuario.id, 'editar', 'turnos', turnoId, antes, final));
    res.json({ ok: true });
  })
);

module.exports = router;

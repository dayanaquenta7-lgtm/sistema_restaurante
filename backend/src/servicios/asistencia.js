// Entrada de personal: la usan la tablet de asistencia y el botón "Empezar mi turno" de la caja.
const { pool, uno } = require('../db');
const { ErrorApp } = require('../util/errores');

const SQL_TURNOS =
  "SELECT id, nombre, TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin FROM turnos WHERE activo = 1 ORDER BY hora_inicio, id";

const turnosActivos = async () => (await pool.query(SQL_TURNOS))[0];

/** Turno elegido, o el de la planificación de hoy, o el habitual. Si no hay ninguno, pide elegir (con botones). */
async function resolverTurno(empleado, turnoElegido) {
  let turnoId = turnoElegido ?? null;
  if (!turnoId) {
    const plan = uno((await pool.query('SELECT turno_id FROM asignaciones_turno WHERE empleado_id = ? AND fecha = CURDATE()', [empleado.id]))[0]);
    turnoId = plan ? plan.turno_id : empleado.turno_habitual_id;
  }
  if (!turnoId) {
    throw new ErrorApp(409, `Hola ${empleado.nombre}, ¿en qué turno vas a trabajar hoy?`, { codigo: 'ELEGIR_TURNO', turnos: await turnosActivos() });
  }
  return turnoId;
}

/** Marca la llegada (con atraso si pasó la tolerancia). Devuelve hora, turno y minutos de atraso. */
async function registrarEntrada(empleadoId, turnoId) {
  const tolerancia = Number(uno((await pool.query("SELECT valor FROM configuracion WHERE clave = 'tolerancia_minutos'"))[0])?.valor ?? 10);
  const [r] = await pool.query(
    `INSERT INTO asistencias (empleado_id, turno_id, fecha, estado, entrada, minutos_atraso)
     SELECT ?, t.id, CURDATE(), 'presente', NOW(),
            LEAST(GREATEST(0, TIMESTAMPDIFF(MINUTE, TIMESTAMP(CURDATE(), t.hora_inicio), NOW()) - ?), 65535)
       FROM turnos t WHERE t.id = ? AND t.activo = 1`,
    [empleadoId, tolerancia, turnoId]
  );
  if (r.affectedRows === 0) throw new ErrorApp(422, 'Ese turno no existe o está desactivado');
  return uno(
    (
      await pool.query(
        `SELECT DATE_FORMAT(a.entrada, '%H:%i') AS hora, a.minutos_atraso, t.nombre AS turno
           FROM asistencias a JOIN turnos t ON t.id = a.turno_id WHERE a.id = ?`,
        [r.insertId]
      )
    )[0]
  );
}

module.exports = { turnosActivos, resolverTurno, registrarEntrada };

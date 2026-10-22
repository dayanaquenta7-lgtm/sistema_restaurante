// Jornada = un día de venta. Se crea sola con el fondo que se dejó el día anterior.
const { ErrorApp } = require('../util/errores');
const { uno } = require('../db');

/**
 * Devuelve la jornada de hoy (o null si todavía no existe).
 * Con bloquear=true la fila queda bloqueada hasta terminar la transacción: así dos ventas
 * (o una venta y un cierre del día) nunca se cruzan, y se lee siempre el dato más reciente.
 */
async function jornadaHoy(conexion, bloquear = false) {
  const sql = `SELECT * FROM jornadas WHERE fecha = CURDATE()${bloquear ? ' FOR UPDATE' : ''}`;
  return uno((await conexion.query(sql))[0]);
}

/** Devuelve la jornada de hoy y la crea si no existe (con el fondo que quedó de ayer). */
async function obtenerOCrearJornadaHoy(conexion) {
  let jornada = await jornadaHoy(conexion);
  if (jornada) return jornada;
  // (MySQL no permite leer la misma tabla dentro del INSERT: primero se lee el fondo de ayer)
  const ayer = uno(
    (
      await conexion.query(
        `SELECT COALESCE(fondo_para_manana, 0) AS fondo FROM jornadas
          WHERE estado = 'cerrada' AND fecha < CURDATE() ORDER BY fecha DESC LIMIT 1`
      )
    )[0]
  );
  try {
    await conexion.query('INSERT INTO jornadas (fecha, fondo_inicial) VALUES (CURDATE(), ?)', [ayer ? ayer.fondo : 0]);
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error; // otra petición la creó al mismo tiempo
  }
  jornada = await jornadaHoy(conexion);
  return jornada;
}

/** La jornada de hoy debe existir y estar abierta; si no, explica qué falta. */
async function jornadaAbiertaHoy(conexion, bloquear = false) {
  const jornada = await jornadaHoy(conexion, bloquear);
  if (!jornada) {
    throw new ErrorApp(409, 'Todavía no se abrió la caja de hoy. Abre la caja primero.', { codigo: 'JORNADA_NO_ABIERTA' });
  }
  if (jornada.estado !== 'abierta') {
    throw new ErrorApp(409, 'El día de hoy ya está cerrado.', { codigo: 'JORNADA_CERRADA' });
  }
  return jornada;
}

/** Sesión de caja abierta de la ENCARGADA en esa jornada (la que cobra todas las ventas). */
async function sesionEncargada(conexion, jornadaId) {
  const sesion = uno(
    (
      await conexion.query(
        "SELECT id, empleado_id FROM sesiones_caja WHERE jornada_id = ? AND estado = 'abierta' AND es_encargada = 1 LIMIT 1",
        [jornadaId]
      )
    )[0]
  );
  if (!sesion) {
    throw new ErrorApp(409, 'No hay una encargada con la caja abierta. Abre la caja primero.', { codigo: 'SIN_ENCARGADA' });
  }
  return sesion;
}

module.exports = { jornadaHoy, obtenerOCrearJornadaHoy, jornadaAbiertaHoy, sesionEncargada };

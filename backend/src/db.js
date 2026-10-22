// Conexión a MySQL (con "pool" de conexiones) y ayudas para operar con seguridad.
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  socketPath: config.db.socketPath,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: config.zonaHoraria,
  // Fechas como texto "2026-10-11 09:03:00" y dinero (DECIMAL) como texto "15.00":
  // así nunca se pierde precisión con números decimales de JavaScript.
  dateStrings: true,
  decimalNumbers: false,
});

// Cada conexión nueva trabaja en hora de Bolivia, para que "el día" cambie a medianoche local.
pool.pool.on('connection', (conexion) => {
  conexion.query(`SET time_zone = '${config.zonaHoraria}'`);
});

/**
 * Ejecuta fn(conexion) con @usuario_id fijado EN ESA MISMA conexión,
 * para que la bitácora (triggers) sepa quién hizo el cambio.
 */
async function conUsuario(usuarioId, fn) {
  const conexion = await pool.getConnection();
  let sana = true;
  try {
    await conexion.query('SET @usuario_id = ?', [usuarioId ?? null]);
    return await fn(conexion);
  } finally {
    try {
      await conexion.query('SET @usuario_id = NULL');
    } catch {
      sana = false;
    }
    if (sana) conexion.release();
    else conexion.destroy();
  }
}

/** Igual que conUsuario pero dentro de una transacción (todo o nada). */
async function transaccion(usuarioId, fn) {
  return conUsuario(usuarioId, async (conexion) => {
    await conexion.beginTransaction();
    try {
      const resultado = await fn(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try {
        await conexion.rollback();
      } catch {
        /* la conexión se descarta abajo si quedó rota */
      }
      throw error;
    }
  });
}

/** Devuelve la primera fila (o null). */
const uno = (filas) => (filas && filas.length ? filas[0] : null);

module.exports = { pool, conUsuario, transaccion, uno };

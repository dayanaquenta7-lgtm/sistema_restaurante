// Crear la base de datos y la cuenta del dueño. Lo usan los scripts (npm run db:crear) y el asistente del programa.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');
const { dividirSql } = require('./migrar');

const carpetaSql = path.join(__dirname, '..', '..', 'db');
const ARCHIVOS = ['01_schema.sql', '02_logica.sql', '03_datos_iniciales.sql', '05_api.sql', '06_mejoras.sql'];

function adaptarNombreBase(sentencia, nombreBase) {
  // Los scripts dicen "broasteria"; aquí se usa el nombre configurado (DB_NAME o la base de pruebas)
  return sentencia.replace(/^(CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS|USE)\s+`?broasteria`?/i, (_, inicio) => `${inicio} \`${nombreBase}\``);
}

const conectar = (extra = {}) =>
  mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, socketPath: config.db.socketPath, charset: 'utf8mb4', ...extra });

/** Prueba la conexión con MySQL. Devuelve null si todo bien o un mensaje en claro. */
async function probarMysql() {
  let c;
  try {
    c = await conectar();
    await c.query('SELECT 1');
    return null;
  } catch (e) {
    if (e.code === 'ER_ACCESS_DENIED_ERROR') return 'La contraseña de MySQL no es correcta.';
    if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') return 'MySQL no está encendido en esta computadora.';
    return e.message;
  } finally {
    await c?.end().catch(() => {});
  }
}

/**
 * Crea la base completa. Si ya existe con tablas y no se pide recrear, no toca nada y devuelve {creada:false}.
 * opciones: { nombreBase, recrear, log }
 */
async function crearBase({ nombreBase = config.db.database, recrear = false, log = () => {} } = {}) {
  const conexion = await conectar();
  try {
    const [bases] = await conexion.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [nombreBase]);
    if (bases.length > 0) {
      const [tablas] = await conexion.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [nombreBase]);
      if (tablas[0].n > 0 && !recrear) return { creada: false, tablas: tablas[0].n };
      if (recrear) {
        await conexion.query(`DROP DATABASE \`${nombreBase}\``);
        log(`Base "${nombreBase}" borrada.`);
      }
    }
    for (const archivo of ARCHIVOS) {
      const sentencias = dividirSql(fs.readFileSync(path.join(carpetaSql, archivo), 'utf8')).map((x) => adaptarNombreBase(x, nombreBase));
      for (const [indice, sentencia] of sentencias.entries()) {
        try {
          await conexion.query(sentencia);
        } catch (error) {
          log(`\nError en ${archivo}, sentencia ${indice + 1}:\n${sentencia.slice(0, 300)}`);
          throw error;
        }
      }
      log(`OK  ${archivo}  (${sentencias.length} sentencias)`);
    }
    return { creada: true };
  } finally {
    await conexion.end();
  }
}

/** Crea la cuenta del dueño si todavía no existe ninguna. */
async function crearDueno({ nombre, pin, clave }) {
  const { pool } = require('./db');
  const { hmacPin, hashClave } = require('./util/seguridad');
  if (String(nombre || '').trim().length < 2) throw new Error('El nombre es muy corto.');
  if (!/^\d{4,6}$/.test(String(pin))) throw new Error('El PIN debe tener de 4 a 6 números.');
  if (String(clave || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const [existentes] = await pool.query("SELECT nombre FROM empleados WHERE rol = 'dueno' AND activo = 1");
  if (existentes.length) return { creado: false, nombre: existentes[0].nombre };
  await pool.query(
    "INSERT INTO empleados (nombre, cargo, rol, pin_hmac, clave_hash, tipo_pago, monto_pago) VALUES (?, 'Dueño', 'dueno', ?, ?, 'mensual', 0)",
    [String(nombre).trim(), hmacPin(pin), await hashClave(clave)]
  );
  return { creado: true, nombre: String(nombre).trim() };
}

module.exports = { crearBase, crearDueno, probarMysql };

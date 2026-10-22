// Arranque del servidor.  Uso:  npm start   (o desde el programa de escritorio)
const os = require('os');
const config = require('./src/config');
const { crearApp } = require('./src/app');
const { pool } = require('./src/db');
const { migrar } = require('./src/migrar');

/** Direcciones para abrir el sistema desde otras tablets o celulares de la red del local. */
function direccionesRed() {
  const lista = [];
  for (const interfaz of Object.values(os.networkInterfaces())) {
    for (const i of interfaz || []) if (i.family === 'IPv4' && !i.internal) lista.push(`http://${i.address}:${config.puerto}`);
  }
  return lista;
}

let servidor = null;

/** Prepara la base y enciende el servidor. Lanza un error con mensaje claro si algo falla. */
async function iniciar() {
  config.validar();
  try {
    await migrar();
  } catch (e) {
    const err = new Error('No se pudo preparar la base de datos: ' + e.message + '. ¿Está encendido MySQL y existe la base?');
    err.codigo = 'SIN_BASE';
    throw err;
  }
  servidor = await new Promise((resolver, rechazar) => {
    const s = crearApp().listen(config.puerto, '0.0.0.0', () => resolver(s));
    s.once('error', rechazar);
  });
  return { puerto: config.puerto, direcciones: direccionesRed() };
}

async function apagar() {
  if (servidor) await new Promise((r) => servidor.close(r));
  servidor = null;
  await pool.end().catch(() => {});
}

module.exports = { iniciar, apagar, direccionesRed };

if (require.main === module) {
  iniciar()
    .then(({ puerto, direcciones }) => {
      console.log(`\n${config.negocioNombre}: sistema listo`);
      console.log(`  En esta computadora:  http://localhost:${puerto}`);
      direcciones.forEach((d) => console.log(`  Desde tablet/celular: ${d}`));
      console.log('');
    })
    .catch((e) => {
      console.error('\n⚠  ' + e.message + '\n');
      if (e.codigo === 'SIN_BASE') console.error('   Prueba:  npm run db:crear\n');
      process.exit(1);
    });
  let cerrando = false;
  const salir = () => {
    if (cerrando) return;
    cerrando = true;
    console.log('Cerrando el sistema...');
    apagar().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}

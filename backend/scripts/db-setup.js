// Crea la base de datos completa (tablas, lógica y datos iniciales) desde Node.js.
// No necesitas el cliente "mysql": este script entiende los DELIMITER de los .sql.
//
//   npm run db:crear                -> crea la base si NO existe (si ya existe, no toca nada)
//   npm run db:recrear              -> BORRA la base y la crea de cero (¡se pierden los datos!)
//   node scripts/db-setup.js --prueba --recrear --si   -> hace lo mismo con la base de pruebas
const config = require('../src/config');
const { crearBase } = require('../src/instalar');
const { dividirSql } = require('../src/migrar');

const args = new Set(process.argv.slice(2));
const nombreBase = args.has('--prueba') ? process.env.DB_NAME_PRUEBA || `${config.db.database}_test` : config.db.database;

async function main() {
  if (args.has('--recrear') && !args.has('--si')) {
    console.log(`Esto BORRARÁ la base "${nombreBase}" con todos sus datos.`);
    console.log('Si estás segura, repite el comando agregando  --si');
    process.exitCode = 1;
    return;
  }
  const r = await crearBase({ nombreBase, recrear: args.has('--recrear'), log: (t) => console.log(t) });
  if (!r.creada) {
    console.log(`La base "${nombreBase}" ya existe y tiene ${r.tablas} tablas. No se tocó nada.`);
    console.log('Si quieres borrarla y empezar de cero: npm run db:recrear');
    return;
  }
  console.log(`\nBase "${nombreBase}" lista.`);
  if (!args.has('--prueba')) console.log('Siguiente paso: npm run crear-dueno');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nNo se pudo crear la base:', error.message);
    process.exit(1);
  });
}

module.exports = { dividirSql };

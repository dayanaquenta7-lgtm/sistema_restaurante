// Aplica las mejoras de la base de datos (db/06_mejoras.sql) cada vez que arranca el sistema.
// Es seguro repetirlo: solo reemplaza procedimientos y no toca los datos.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

/**
 * Divide un script SQL en sentencias, respetando:
 *  - DELIMITER (usado en triggers y procedimientos),
 *  - textos entre comillas,
 *  - comentarios  -- ...   #...   /* ... *\/
 */
function dividirSql(texto) {
  const sentencias = [];
  let delimitador = ';';
  let actual = '';
  let i = 0;
  const n = texto.length;

  const bufferVacio = () => actual.trim() === '';

  while (i < n) {
    const c = texto[i];
    const c2 = texto[i + 1];

    // Línea DELIMITER (solo al inicio de una sentencia)
    if (bufferVacio() && /^DELIMITER\s/i.test(texto.slice(i, i + 10))) {
      const finLinea = texto.indexOf('\n', i);
      const linea = texto.slice(i, finLinea === -1 ? n : finLinea);
      delimitador = linea.replace(/^DELIMITER\s+/i, '').trim();
      actual = '';
      i = finLinea === -1 ? n : finLinea + 1;
      continue;
    }

    // Comentarios
    if ((c === '-' && c2 === '-' && /\s/.test(texto[i + 2] || ' ')) || c === '#') {
      const fin = texto.indexOf('\n', i);
      i = fin === -1 ? n : fin;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const fin = texto.indexOf('*/', i + 2);
      i = fin === -1 ? n : fin + 2;
      continue;
    }

    // Textos entre comillas
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (texto[j] === '\\' && c !== '`') {
          j += 2;
          continue;
        }
        if (texto[j] === c) {
          if (texto[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      actual += texto.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // Fin de sentencia
    if (texto.startsWith(delimitador, i)) {
      if (!bufferVacio()) sentencias.push(actual.trim());
      actual = '';
      i += delimitador.length;
      continue;
    }

    actual += c;
    i += 1;
  }
  if (!bufferVacio()) sentencias.push(actual.trim());
  return sentencias;
}


async function migrar(archivos = ['06_mejoras.sql']) {
  const conexion = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password,
    socketPath: config.db.socketPath, charset: 'utf8mb4', database: config.db.database, multipleStatements: false,
  });
  try {
    for (const archivo of archivos) {
      const ruta = path.join(__dirname, '..', '..', 'db', archivo);
      const sentencias = dividirSql(fs.readFileSync(ruta, 'utf8')).filter((x) => !/^USE\s/i.test(x));
      for (const sentencia of sentencias) await conexion.query(sentencia);
    }
  } finally {
    await conexion.end();
  }
}

module.exports = { dividirSql, migrar };

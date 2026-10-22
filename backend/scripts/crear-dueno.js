// Crea (por única vez) la cuenta del dueño.  Uso:  npm run crear-dueno
const readline = require('readline');
const config = require('../src/config');

config.validar();
const { pool } = require('../src/db');
const { hmacPin, hashClave } = require('../src/util/seguridad');

function preguntar(texto, { oculto = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = (cadena) => {
        if (cadena.includes(texto)) rl.output.write(cadena);
        else if (cadena.includes('\n') || cadena.includes('\r')) rl.output.write('\n');
      };
    }
    rl.question(texto, (respuesta) => {
      rl.close();
      resolve(respuesta.trim());
    });
  });
}

async function main() {
  const [existentes] = await pool.query("SELECT id, nombre FROM empleados WHERE rol = 'dueno' AND activo = 1");
  if (existentes.length) {
    console.log(`Ya existe un dueño (${existentes[0].nombre}). No se creó otro.`);
    return;
  }

  const nombre = await preguntar('Nombre del dueño: ');
  if (nombre.length < 2) throw new Error('El nombre es muy corto.');

  const pin = await preguntar('PIN de 4 a 6 números: ', { oculto: true });
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN debe tener de 4 a 6 números.');

  const clave = await preguntar('Contraseña para entrar al panel (mínimo 8 caracteres): ', { oculto: true });
  if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

  await pool.query(
    "INSERT INTO empleados (nombre, cargo, rol, pin_hmac, clave_hash, tipo_pago, monto_pago) VALUES (?, 'Dueño', 'dueno', ?, ?, 'mensual', 0)",
    [nombre, hmacPin(pin), await hashClave(clave)]
  );
  console.log(`\nListo. El dueño "${nombre}" ya puede entrar con su nombre y contraseña.`);
}

main()
  .catch((error) => {
    console.error('\nNo se pudo crear el dueño:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

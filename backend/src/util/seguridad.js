const crypto = require('crypto');
const { promisify } = require('util');
const config = require('../config');

const scrypt = promisify(crypto.scrypt);

/** El PIN se guarda como HMAC-SHA256 con una clave secreta del servidor, nunca en claro. */
const hmacPin = (pin) =>
  crypto.createHmac('sha256', config.pinSecret).update(String(pin)).digest('hex');

/** Contraseña larga del dueño: scrypt con sal aleatoria. */
async function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(clave, sal, 32);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

async function verificarClave(clave, guardado) {
  if (!guardado) return false;
  const [algoritmo, salHex, hashHex] = String(guardado).split('$');
  if (algoritmo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = await scrypt(clave, Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(calculado, esperado);
}

/** Token de sesión: se entrega en la cookie; en la base solo se guarda su huella. */
const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
const huellaToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Comparación de textos sin filtrar información por tiempo. */
function iguales(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { hmacPin, hashClave, verificarClave, nuevoToken, huellaToken, iguales };

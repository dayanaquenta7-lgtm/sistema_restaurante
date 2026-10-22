// Protecciones de entrada: límite de intentos, origen de las peticiones y clave de la tablet.
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { ErrorApp } = require('../util/errores');
const { iguales } = require('../util/seguridad');

/**
 * Limita los intentos FALLIDOS de PIN/contraseña por dispositivo (IP).
 * Nota: como el PIN identifica a la persona, no se puede bloquear "a un empleado";
 * el bloqueo es por dispositivo, y los intentos exitosos no cuentan.
 */
const limiteIntentos = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: config.limiteIntentos,
  // Solo cuentan los PIN/contraseñas EQUIVOCADOS (401). Otros avisos normales ("elige tu turno",
  // "ya marcaste") no deben bloquear la tablet compartida por todo el personal.
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) =>
    next(
      new ErrorApp(429, 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo.', {
        codigo: 'DEMASIADOS_INTENTOS',
      })
    ),
});

/** Evita que otra página web haga peticiones en nombre del usuario (CSRF). */
function verificarOrigen(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origen = req.headers.origin;
  if (!origen) return next(); // herramientas sin navegador (pruebas, curl)
  try {
    if (new URL(origen).host !== req.headers.host) {
      return next(new ErrorApp(403, 'Origen no permitido', { codigo: 'ORIGEN_NO_PERMITIDO' }));
    }
  } catch {
    return next(new ErrorApp(403, 'Origen no permitido', { codigo: 'ORIGEN_NO_PERMITIDO' }));
  }
  next();
}

/** Si TABLET_KEY está definida, solo la tablet del local (que la envía) puede marcar asistencia. */
function exigirTablet(req, res, next) {
  if (!config.tabletKey) return next();
  const enviada = req.headers['x-tablet-key'];
  if (!enviada || !iguales(enviada, config.tabletKey)) {
    return next(new ErrorApp(403, 'La asistencia solo se marca desde la tablet del local', { codigo: 'TABLET_NO_AUTORIZADA' }));
  }
  next();
}

module.exports = { limiteIntentos, verificarOrigen, exigirTablet };

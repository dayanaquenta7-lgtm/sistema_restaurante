// Error "esperado": un problema que el usuario puede entender y corregir.
class ErrorApp extends Error {
  constructor(estado, mensaje, extra = {}) {
    super(mensaje);
    this.estado = estado;
    this.extra = extra;
  }
}

// Evita escribir try/catch en cada ruta: cualquier error pasa al manejador central.
const envolver = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { ErrorApp, envolver };

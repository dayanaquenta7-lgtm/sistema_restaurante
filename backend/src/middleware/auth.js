// Sesiones: quién está usando el sistema (cookie "sid" httpOnly, guardada como huella en MySQL).
const config = require('../config');
const { pool, uno } = require('../db');
const { nuevoToken, huellaToken } = require('../util/seguridad');
const { ErrorApp } = require('../util/errores');

const NOMBRE_COOKIE = 'sid';

function leerCookie(req, nombre) {
  const cabecera = req.headers.cookie;
  if (!cabecera) return null;
  for (const par of cabecera.split(';')) {
    const i = par.indexOf('=');
    if (i < 0) continue;
    if (par.slice(0, i).trim() === nombre) {
      try {
        return decodeURIComponent(par.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Si la cookie es válida, deja al usuario en req.usuario. No bloquea a nadie por sí solo. */
async function cargarSesion(req, res, next) {
  try {
    const token = leerCookie(req, NOMBRE_COOKIE);
    if (!token) return next();
    const fila = uno(
      (
        await pool.query(
          `SELECT e.id, e.nombre, e.rol
             FROM sesiones_app s JOIN empleados e ON e.id = s.empleado_id
            WHERE s.token_hash = ? AND s.expira_en > NOW() AND e.activo = 1`,
          [huellaToken(token)]
        )
      )[0]
    );
    if (fila) {
      req.usuario = { id: fila.id, nombre: fila.nombre, rol: fila.rol };
      req.huellaToken = huellaToken(token);
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** Crea la sesión y entrega la cookie al navegador. */
async function iniciarSesion(req, res, empleado) {
  const horas = empleado.rol === 'dueno' ? config.sesionHorasDueno : config.sesionHorasAtencion;
  const token = nuevoToken();
  await pool.query('DELETE FROM sesiones_app WHERE expira_en < NOW()');
  await pool.query(
    'INSERT INTO sesiones_app (token_hash, empleado_id, expira_en, ip) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)',
    [huellaToken(token), empleado.id, horas, (req.ip || '').slice(0, 45)]
  );
  res.cookie(NOMBRE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSegura,
    maxAge: horas * 3600 * 1000,
    path: '/',
  });
}

async function cerrarSesion(req, res) {
  if (req.huellaToken) {
    await pool.query('DELETE FROM sesiones_app WHERE token_hash = ?', [req.huellaToken]);
  }
  res.clearCookie(NOMBRE_COOKIE, { path: '/' });
}

function requiereSesion(req, res, next) {
  if (!req.usuario) {
    return next(new ErrorApp(401, 'Inicia sesión con tu PIN', { codigo: 'NO_AUTENTICADO' }));
  }
  next();
}

const requiereRol =
  (...roles) =>
  (req, res, next) => {
    if (!req.usuario) {
      return next(new ErrorApp(401, 'Inicia sesión con tu PIN', { codigo: 'NO_AUTENTICADO' }));
    }
    if (!roles.includes(req.usuario.rol)) {
      return next(new ErrorApp(403, 'No tienes permiso para hacer esto', { codigo: 'SIN_PERMISO' }));
    }
    next();
  };

const soloDueno = requiereRol('dueno');
const atencionODueno = requiereRol('atencion', 'dueno');

module.exports = {
  cargarSesion,
  iniciarSesion,
  cerrarSesion,
  requiereSesion,
  requiereRol,
  soloDueno,
  atencionODueno,
};

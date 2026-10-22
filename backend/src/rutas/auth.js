// Acceso al sistema: PIN para el personal de atención, nombre + contraseña para el dueño.
const express = require('express');
const { z, pin, texto } = require('../util/validacion');
const { pool, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { hmacPin, verificarClave, hashClave } = require('../util/seguridad');
const { iniciarSesion, cerrarSesion, requiereSesion } = require('../middleware/auth');
const { limiteIntentos } = require('../middleware/seguridad-http');

const router = express.Router();

/** Qué está haciendo esta persona ahora mismo (para que la pantalla sepa qué mostrar). */
async function estadoUsuario(usuario) {
  const asistencia = uno(
    (
      await pool.query(
        `SELECT a.id, a.fecha, a.entrada, a.minutos_atraso, t.nombre AS turno
           FROM asistencias a JOIN turnos t ON t.id = a.turno_id
          WHERE a.empleado_id = ? AND a.entrada IS NOT NULL AND a.salida IS NULL`,
        [usuario.id]
      )
    )[0]
  );
  const caja = uno(
    (
      await pool.query(
        "SELECT id, es_encargada, inicio, jornada_id FROM sesiones_caja WHERE empleado_id = ? AND estado = 'abierta'",
        [usuario.id]
      )
    )[0]
  );
  return {
    usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
    asistencia_abierta: asistencia,
    caja_abierta: caja,
  };
}

router.post(
  '/pin',
  limiteIntentos,
  envolver(async (req, res) => {
    const { pin: pinIngresado } = z.object({ pin }).parse(req.body);
    const empleado = uno(
      (
        await pool.query('SELECT id, nombre, rol, clave_hash FROM empleados WHERE pin_hmac = ? AND activo = 1', [
          hmacPin(pinIngresado),
        ])
      )[0]
    );
    if (!empleado) throw new ErrorApp(401, 'PIN incorrecto', { codigo: 'PIN_INCORRECTO' });
    if (empleado.rol === 'solo_asistencia') {
      throw new ErrorApp(403, 'Tu PIN solo sirve para marcar tu llegada y salida en la tablet', { codigo: 'SOLO_ASISTENCIA' });
    }
    if (empleado.rol === 'dueno' && empleado.clave_hash) {
      throw new ErrorApp(403, 'El dueño entra con su nombre y contraseña', { codigo: 'DUENO_USA_CLAVE' });
    }
    await iniciarSesion(req, res, empleado);
    res.json(await estadoUsuario(empleado));
  })
);

// Para comparar siempre contra algo, aunque el nombre no exista (evita adivinar nombres por el tiempo de respuesta)
let claveFalsa = null;

router.post(
  '/dueno',
  limiteIntentos,
  envolver(async (req, res) => {
    const { nombre, clave } = z.object({ nombre: texto(1, 100), clave: z.string().min(1).max(200) }).parse(req.body);
    const empleado = uno(
      (
        await pool.query("SELECT id, nombre, rol, clave_hash FROM empleados WHERE rol = 'dueno' AND activo = 1 AND nombre = ?", [nombre])
      )[0]
    );
    if (!claveFalsa) claveFalsa = await hashClave('clave-falsa-para-igualar-tiempos');
    const correcta = await verificarClave(clave, empleado ? empleado.clave_hash : claveFalsa);
    if (!empleado || !correcta) throw new ErrorApp(401, 'Nombre o contraseña incorrectos', { codigo: 'CREDENCIALES_INCORRECTAS' });
    await iniciarSesion(req, res, empleado);
    res.json(await estadoUsuario(empleado));
  })
);

router.post(
  '/salir',
  envolver(async (req, res) => {
    await cerrarSesion(req, res);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  requiereSesion,
  envolver(async (req, res) => {
    res.json(await estadoUsuario(req.usuario));
  })
);

module.exports = router;
module.exports.estadoUsuario = estadoUsuario;

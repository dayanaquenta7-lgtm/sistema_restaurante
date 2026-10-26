// Controlador de gaseosas: recibe la petición, valida el identificador, llama al servicio
// y decide el código HTTP. No contiene SQL (eso es trabajo del servicio).
//
//   200 consulta / actualización / eliminación correcta
//   201 se registró una gaseosa nueva
//   400 datos o identificador inválidos   (lo responde el manejador central de errores)
//   404 la gaseosa no existe
//   409 repetida (marca + tamaño) o con historial (no se puede borrar)
//   500 error interno (sin mostrar contraseñas ni consultas)
const servicio = require('../servicios/gaseosas');
const { ErrorApp } = require('../util/errores');

/**
 * Una sola función para validar el :id de la URL (se usa en GET, PUT, PATCH y DELETE).
 * /api/gaseosas/abc  -> 400 antes de ejecutar cualquier consulta SQL.
 */
function validarId(valor) {
  if (!/^\d{1,10}$/.test(String(valor)) || Number(valor) <= 0 || Number(valor) > 4294967295) {
    throw new ErrorApp(400, 'El identificador debe ser un número entero positivo', { codigo: 'ID_INVALIDO' });
  }
  return Number(valor);
}

const noExiste = () => new ErrorApp(404, 'La gaseosa solicitada no existe', { codigo: 'NO_ENCONTRADO' });


 async function listar(req, res) {
  // ?buscar=texto  (si no viene o viene vacío, se listan todas)
  const buscar = typeof req.query.buscar === 'string' ? req.query.buscar.trim() : '';
  const gaseosas = await servicio.listarGaseosas(buscar);
  res.status(200).json({ total: gaseosas.length, gaseosas });
}

async function obtener(req, res) {
  const gaseosaId = validarId(req.params.id);
  const gaseosa = await servicio.obtenerGaseosaPorId(gaseosaId);
  if (!gaseosa) throw noExiste();
  res.status(200).json({ gaseosa });
}

async function crear(req, res) {
  const gaseosa = await servicio.crearGaseosa(req.usuario.id, req.body);
  // "id" se mantiene arriba para las pantallas que ya lo usaban
  res.status(201).json({ mensaje: 'Gaseosa registrada correctamente', id: gaseosa.id, gaseosa });
}

async function actualizar(req, res) {
  const gaseosaId = validarId(req.params.id);
  const gaseosa = await servicio.actualizarGaseosa(req.usuario.id, gaseosaId, req.body);
  if (!gaseosa) throw noExiste();
  res.status(200).json({ mensaje: 'Gaseosa actualizada correctamente', gaseosa });
}

async function actualizarParcial(req, res) {
  const gaseosaId = validarId(req.params.id);
  const gaseosa = await servicio.actualizarGaseosaParcial(req.usuario.id, gaseosaId, req.body);
  if (!gaseosa) throw noExiste();
  res.status(200).json({ ok: true, gaseosa });
}

async function eliminar(req, res) {
  const gaseosaId = validarId(req.params.id);
  const gaseosa = await servicio.eliminarGaseosa(req.usuario.id, gaseosaId);
  if (!gaseosa) throw noExiste();
  res.status(200).json({ mensaje: 'Gaseosa eliminada correctamente', gaseosa });
}

async function ingreso(req, res) {
  const lineas = await servicio.registrarIngreso(req.usuario.id, req.body);
  res.status(201).json({ ok: true, lineas });
}

async function conteo(req, res) {
  const diferencias = await servicio.registrarConteo(req.usuario.id, req.body);
  res.status(200).json({ ok: true, diferencias });
}

module.exports = { validarId, listar, obtener, crear, actualizar, actualizarParcial, eliminar, ingreso, conteo };

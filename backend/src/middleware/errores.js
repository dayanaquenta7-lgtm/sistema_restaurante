// Manejador central: convierte cualquier error en una respuesta clara en español.
const { ZodError } = require('zod');
const { ErrorApp } = require('../util/errores');

// Qué decir cuando MySQL rechaza un dato repetido (restricción UNIQUE)
const DUPLICADOS = {
  uq_empleados_pin: 'Ese PIN ya lo usa otra persona. Elige otro.',
  uq_asis_dia_turno: 'Ya hay un registro de ese turno para hoy. Si fue un error, avisa al dueño.',
  uq_asis_abierta: 'Ya tienes una entrada abierta.',
  uq_gaseosa: 'Esa gaseosa (marca y tamaño) ya está registrada.',
  uq_planilla_periodo: 'Ya existe una planilla para ese periodo.',
  uq_jornada_fecha: 'Ese día ya está abierto.',
  uq_ses_persona_abierta: 'Ya tienes una caja abierta.',
  uq_ses_encargada_abierta: 'Ya hay una encargada con la caja abierta.',
  uq_turnos_nombre: 'Ya existe un turno con ese nombre.',
};

function noEncontrada(req, res) {
  res.status(404).json({ error: 'Esa dirección no existe', codigo: 'NO_ENCONTRADO' });
}

// eslint-disable-next-line no-unused-vars
function manejadorErrores(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof ErrorApp) {
    return res.status(error.estado).json({ error: error.message, ...error.extra });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Hay datos incorrectos o faltantes',
      codigo: 'DATOS_INVALIDOS',
      detalles: error.issues.map((i) => ({ campo: i.path.join('.') || '(cuerpo)', mensaje: i.message })),
    });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido', codigo: 'JSON_INVALIDO' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La petición es demasiado grande', codigo: 'MUY_GRANDE' });
  }

  // Reglas del negocio que la propia base de datos hace cumplir (SIGNAL en triggers y procedimientos)
  if (error.sqlState === '45000' && error.sqlMessage) {
    return res.status(422).json({ error: error.sqlMessage, codigo: 'REGLA_DEL_NEGOCIO' });
  }

  if (error.code === 'ER_DUP_ENTRY') {
    const llave = Object.keys(DUPLICADOS).find((k) => String(error.sqlMessage).includes(k));
    return res.status(409).json({ error: llave ? DUPLICADOS[llave] : 'Ese registro ya existe', codigo: 'DUPLICADO' });
  }
  if (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || error.code === 'ER_CONSTRAINT_FAILED') {
    return res.status(422).json({ error: 'Algún dato está fuera de lo permitido', codigo: 'DATO_FUERA_DE_RANGO' });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
    return res.status(422).json({ error: 'Se hace referencia a algo que no existe', codigo: 'REFERENCIA_INVALIDA' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
    return res.status(409).json({ error: 'No se puede borrar porque tiene registros relacionados', codigo: 'EN_USO' });
  }

  console.error('[error]', req.method, req.originalUrl, error);
  return res.status(500).json({ error: 'Ocurrió un problema en el sistema. Inténtalo de nuevo.', codigo: 'ERROR_INTERNO' });
}

module.exports = { manejadorErrores, noEncontrada };

// Anota en la bitácora los cambios que no tienen un trigger propio en la base de datos.
async function anotar(conexion, usuarioId, accion, entidad, entidadId, antes = null, despues = null) {
  await conexion.query(
    'INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo) VALUES (?, ?, ?, ?, ?, ?)',
    [
      usuarioId ?? null,
      accion,
      entidad,
      entidadId === null || entidadId === undefined ? null : String(entidadId),
      antes === null ? null : JSON.stringify(antes),
      despues === null ? null : JSON.stringify(despues),
    ]
  );
}

module.exports = { anotar };

// El stock nunca es un número editable: es la SUMA de los movimientos.
// Estas funciones lo calculan; la API las usa (con la jornada bloqueada) para no vender lo que no hay.

/** Piezas (presas y aumentos) que quedan en la jornada: Map(id_pieza -> cantidad). */
async function stockPiezas(conexion, jornadaId) {
  const [filas] = await conexion.query(
    'SELECT tipo_pieza_id, SUM(cantidad) AS stock FROM movimientos_pieza WHERE jornada_id = ? GROUP BY tipo_pieza_id',
    [jornadaId]
  );
  return new Map(filas.map((f) => [f.tipo_pieza_id, Number(f.stock)]));
}

/** Gaseosas que quedan: Map(id_gaseosa -> cantidad). Si no se indican ids, trae todas. */
async function stockGaseosas(conexion, ids = null) {
  if (ids && ids.length === 0) return new Map();
  const [filas] = ids
    ? await conexion.query('SELECT gaseosa_id, SUM(cantidad) AS stock FROM movimientos_gaseosa WHERE gaseosa_id IN (?) GROUP BY gaseosa_id', [ids])
    : await conexion.query('SELECT gaseosa_id, SUM(cantidad) AS stock FROM movimientos_gaseosa GROUP BY gaseosa_id');
  return new Map(filas.map((f) => [f.gaseosa_id, Number(f.stock)]));
}

module.exports = { stockPiezas, stockGaseosas };

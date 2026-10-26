// Servicio de gaseosas: aquí viven las consultas SQL y las reglas del negocio.
// La ruta identifica la operación, el controlador coordina la respuesta y ESTE archivo habla con MySQL.
//
// Todas las consultas son PARAMETRIZADAS (los "?"): los valores viajan aparte del SQL,
// así un texto malicioso enviado por el cliente nunca se convierte en una orden SQL.
const { z, texto, dinero, entero, id } = require('../util/validacion');
const { pool, conUsuario, transaccion, uno } = require('../db');
const { ErrorApp } = require('../util/errores');
const { anotar } = require('../util/bitacora');

// Columnas que devuelve la API para una gaseosa (con su stock calculado por la vista).
const COLUMNAS = 'gaseosa_id AS id, marca, tamano, precio, stock_minimo, activo, stock, semaforo';

/** Convierte la fila de MySQL en el objeto que entrega la API. */
const formatear = (fila) => (fila ? { ...fila, activo: !!fila.activo, stock: Number(fila.stock) } : undefined);

// ------------------------------------------------------------------ Validación reutilizable

const esquemaGaseosa = z.object({
  marca: texto(2, 60),
  tamano: texto(1, 30),
  precio: dinero
    .refine((v) => Number(v) > 0, 'El precio debe ser mayor que cero')
    .refine((v) => Number(v) <= 5000, 'El precio no puede superar Bs 5.000'),
  stock_minimo: entero(0, 1000).optional(),
  activo: z.boolean().optional(),
});

/**
 * Valida los datos de una gaseosa. Se REUTILIZA al crear (POST) y al actualizar (PUT).
 * Si algo está mal lanza un ZodError, que el manejador central convierte en 400.
 * Ojo: no confiamos solo en JavaScript; MySQL también tiene sus restricciones
 * (CHECK precio >= 0, UNIQUE marca + tamaño, NOT NULL).
 */
function validarDatosGaseosa(datos) {
  return esquemaGaseosa.parse(datos ?? {});
}

// ------------------------------------------------------------------ READ

async function listarGaseosas(buscar = '') {
  let sql = `SELECT ${COLUMNAS} FROM v_stock_gaseosas`;
  const valores = [];
  if (buscar) {
    // El texto viaja como PARÁMETRO (?): nunca se pega dentro del SQL
    sql += " WHERE LOWER(CONCAT(marca, ' ', tamano)) LIKE LOWER(?)";
    // % y _ son comodines de LIKE: se escapan para buscarlos como texto normal
    const texto = buscar.replace(/[\\%_]/g, '\\$&');
    valores.push(`%${texto}%`);
  }
  sql += ' ORDER BY activo DESC, marca, tamano';
  const [filas] = await pool.query(sql, valores);
  return filas.map(formatear);
}

/** Devuelve la gaseosa o undefined si no existe (el controlador responde 404). */
async function obtenerGaseosaPorId(gaseosaId, conexion = pool) {
  const [filas] = await conexion.query(`SELECT ${COLUMNAS} FROM v_stock_gaseosas WHERE gaseosa_id = ?`, [gaseosaId]);
  return formatear(uno(filas) ?? undefined);
}

// ------------------------------------------------------------------ CREATE

async function crearGaseosa(usuarioId, datos) {
  const d = validarDatosGaseosa(datos);
  let minimo = d.stock_minimo;
  if (minimo === undefined) {
    const cfg = uno((await pool.query("SELECT valor FROM configuracion WHERE clave = 'stock_minimo_gaseosa'"))[0]);
    minimo = cfg ? Number(cfg.valor) : 6;
  }
  return conUsuario(usuarioId, async (cx) => {
    const [r] = await cx.query('INSERT INTO gaseosas (marca, tamano, precio, stock_minimo, activo) VALUES (?, ?, ?, ?, ?)', [
      d.marca,
      d.tamano,
      d.precio,
      minimo,
      d.activo === false ? 0 : 1,
    ]);
    // MySQL no tiene RETURNING como PostgreSQL: leemos el registro recién creado con su id.
    return obtenerGaseosaPorId(r.insertId, cx);
  });
}

// ------------------------------------------------------------------ UPDATE (PUT: reemplaza los datos editables)

async function actualizarGaseosa(usuarioId, gaseosaId, datos) {
  const d = validarDatosGaseosa(datos); // si falla, NO se toca la base de datos
  return transaccion(usuarioId, async (cx) => {
    const actual = uno((await cx.query('SELECT id, stock_minimo, activo FROM gaseosas WHERE id = ? FOR UPDATE', [gaseosaId]))[0]);
    if (!actual) return undefined;
    // El WHERE id = ? es OBLIGATORIO: sin él, el UPDATE cambiaría TODAS las gaseosas.
    await cx.query('UPDATE gaseosas SET marca = ?, tamano = ?, precio = ?, stock_minimo = ?, activo = ? WHERE id = ?', [
      d.marca,
      d.tamano,
      d.precio,
      d.stock_minimo ?? actual.stock_minimo,
      d.activo === undefined ? actual.activo : d.activo ? 1 : 0,
      gaseosaId,
    ]);
    return obtenerGaseosaPorId(gaseosaId, cx);
  });
}

// ------------------------------------------------------------------ UPDATE parcial (PATCH: lo usa la pantalla del dueño)

const esquemaParcial = z
  .object({
    precio: dinero.refine((v) => Number(v) > 0 && Number(v) <= 5000, 'El precio debe ser mayor que 0 y no superar Bs 5.000').optional(),
    activo: z.boolean().optional(),
    stock_minimo: entero(0, 1000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio');

async function actualizarGaseosaParcial(usuarioId, gaseosaId, datos) {
  const d = esquemaParcial.parse(datos ?? {});
  const sets = [];
  const valores = [];
  if (d.precio !== undefined) (sets.push('precio = ?'), valores.push(d.precio));
  if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
  if (d.stock_minimo !== undefined) (sets.push('stock_minimo = ?'), valores.push(d.stock_minimo));
  const [r] = await conUsuario(usuarioId, (cx) => cx.query(`UPDATE gaseosas SET ${sets.join(', ')} WHERE id = ?`, [...valores, gaseosaId]));
  if (r.affectedRows === 0) return undefined;
  return obtenerGaseosaPorId(gaseosaId);
}

// ------------------------------------------------------------------ DELETE

/**
 * Elimina una gaseosa y devuelve el registro eliminado (o undefined si no existía → 404).
 * Regla del negocio: "nada con historial se borra". Si la gaseosa ya tiene ingresos, ventas
 * o pérdidas, borrarla rompería los reportes; en ese caso se responde 409 y se pide desactivarla.
 * Así DELETE sirve para quitar una gaseosa registrada por error, sin perder la historia del local.
 */
async function eliminarGaseosa(usuarioId, gaseosaId) {
  return transaccion(usuarioId, async (cx) => {
    const antes = await obtenerGaseosaPorId(gaseosaId, cx);
    if (!antes) return undefined;
    await cx.query('SELECT id FROM gaseosas WHERE id = ? FOR UPDATE', [gaseosaId]);
    const usos = uno(
      (
        await cx.query(
          `SELECT (SELECT COUNT(*) FROM movimientos_gaseosa WHERE gaseosa_id = ?)
                + (SELECT COUNT(*) FROM venta_items        WHERE gaseosa_id = ?)
                + (SELECT COUNT(*) FROM perdidas           WHERE gaseosa_id = ?) AS n`,
          [gaseosaId, gaseosaId, gaseosaId]
        )
      )[0]
    );
    if (Number(usos.n) > 0) {
      throw new ErrorApp(409, 'Esta gaseosa ya tiene movimientos o ventas: no se puede borrar sin perder el historial. Desactívala.', {
        codigo: 'EN_USO',
      });
    }
    await cx.query('DELETE FROM gaseosas WHERE id = ?', [gaseosaId]);
    await anotar(cx, usuarioId, 'eliminar', 'gaseosas', gaseosaId, { marca: antes.marca, tamano: antes.tamano, precio: antes.precio }, null);
    return antes;
  });
}

// ------------------------------------------------------------------ Movimientos de stock

const lineasIngreso = z
  .array(z.object({ gaseosa_id: id, cantidad: z.number().int().min(1).max(5000) }))
  .min(1)
  .max(100);

/** "Llegaron gaseosas": suma stock con un movimiento de ingreso por variedad. */
async function registrarIngreso(usuarioId, datos) {
  const d = z.object({ items: lineasIngreso, nota: texto(1, 200).optional() }).parse(datos ?? {});
  await transaccion(usuarioId, async (cx) => {
    for (const l of d.items) {
      const g = uno((await cx.query('SELECT id FROM gaseosas WHERE id = ?', [l.gaseosa_id]))[0]);
      if (!g) throw new ErrorApp(404, 'Una de las gaseosas no existe');
      await cx.query(
        "INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, registrado_por, nota) VALUES (?, 'ingreso', ?, ?, ?)",
        [l.gaseosa_id, l.cantidad, usuarioId, d.nota ?? null]
      );
    }
  });
  return d.items.length;
}

/** "Contar lo que queda": registra un ajuste por la diferencia entre lo contado y lo que dice el sistema. */
async function registrarConteo(usuarioId, datos) {
  const d = z
    .object({ items: z.array(z.object({ gaseosa_id: id, contado: z.number().int().min(0).max(100000) })).min(1).max(100) })
    .parse(datos ?? {});
  return transaccion(usuarioId, async (cx) => {
    const salida = [];
    for (const l of d.items) {
      const g = uno((await cx.query('SELECT id, marca, tamano FROM gaseosas WHERE id = ? FOR UPDATE', [l.gaseosa_id]))[0]);
      if (!g) throw new ErrorApp(404, 'Una de las gaseosas no existe');
      const sistema = Number(uno((await cx.query('SELECT COALESCE(SUM(cantidad), 0) AS s FROM movimientos_gaseosa WHERE gaseosa_id = ?', [g.id]))[0]).s);
      const dif = l.contado - sistema;
      if (dif !== 0) {
        await cx.query(
          "INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, registrado_por, nota) VALUES (?, 'ajuste', ?, ?, 'Conteo físico')",
          [g.id, dif, usuarioId]
        );
        salida.push({ gaseosa_id: g.id, nombre: `${g.marca} ${g.tamano}`, sistema, contado: l.contado, diferencia: dif });
      }
    }
    return salida;
  });
}

module.exports = {
  validarDatosGaseosa,
  listarGaseosas,
  obtenerGaseosaPorId,
  crearGaseosa,
  actualizarGaseosa,
  actualizarGaseosaParcial,
  eliminarGaseosa,
  registrarIngreso,
  registrarConteo,
};

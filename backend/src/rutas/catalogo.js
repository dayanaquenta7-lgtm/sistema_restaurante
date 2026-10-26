// Menú (presas, aumentos, acompañamientos y recargo de "pura papa").
const express = require('express');
const { z, id, dinero, entero } = require('../util/validacion');
const { pool, conUsuario, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { soloDueno, atencionODueno } = require('../middleware/auth');
const { jornadaHoy } = require('../servicios/jornada');
const { stockPiezas } = require('../servicios/stock');

const router = express.Router();

/** Todo lo que necesita la pantalla de caja para vender, con el stock de hoy. */
router.get(
  '/menu',
  atencionODueno,
  envolver(async (req, res) => {
    const jornada = await jornadaHoy(pool);
    const stock = jornada ? await stockPiezas(pool, jornada.id) : new Map();
    const [piezas] = await pool.query(
      'SELECT id, nombre, categoria, cantidad_por_pollo, precio, orden, activo FROM tipos_pieza ORDER BY orden'
    );
    const [relaciones] = await pool.query('SELECT presa_id, aumento_id FROM presa_aumento');
    const porId = new Map(piezas.map((p) => [p.id, p]));

    const presas = piezas
      .filter((p) => p.categoria === 'presa')
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        cantidad_por_pollo: p.cantidad_por_pollo,
        activo: !!p.activo,
        stock: stock.get(p.id) || 0,
        aumentos: relaciones
          .filter((r) => r.presa_id === p.id)
          .map((r) => porId.get(r.aumento_id))
          .filter(Boolean)
          .map((a) => ({ id: a.id, nombre: a.nombre, activo: !!a.activo, stock: stock.get(a.id) || 0 })),
      }));
    const aumentos = piezas
      .filter((p) => p.categoria === 'aumento')
      .map((p) => ({ id: p.id, nombre: p.nombre, cantidad_por_pollo: p.cantidad_por_pollo, activo: !!p.activo, stock: stock.get(p.id) || 0 }));

    const [acompanamientos] = await pool.query('SELECT id, nombre, precio_porcion, orden, activo FROM acompanamientos ORDER BY orden');
    const [reglas] = await pool.query(
      `SELECT r.id, r.nombre, r.recargo, r.activo, r.acompanamiento_unico_id, a.nombre AS acompanamiento
         FROM reglas_precio r JOIN acompanamientos a ON a.id = r.acompanamiento_unico_id ORDER BY r.id`
    );
    const [gaseosas] = await pool.query(
      'SELECT gaseosa_id AS id, marca, tamano, precio, stock, semaforo FROM v_stock_gaseosas WHERE activo = 1 ORDER BY marca, tamano'
    );

    res.json({
      jornada: jornada ? { id: jornada.id, fecha: jornada.fecha, estado: jornada.estado } : null,
      presas,
      aumentos,
      acompanamientos: acompanamientos.map((a) => ({ ...a, activo: !!a.activo })),
      reglas: reglas.map((r) => ({ ...r, activo: !!r.activo })),
      gaseosas: gaseosas.map((g) => ({ ...g, stock: Number(g.stock) })),
    });
  })
);

// ------------------------------------------------------------------ Cambios del dueño al menú
// (los precios y activaciones quedan anotados solos en la bitácora por la base de datos)

router.patch(
  '/menu/piezas/:id',
  soloDueno,
  envolver(async (req, res) => {
    const piezaId = id.parse(req.params.id);
    const d = z
      .object({ precio: dinero.optional(), activo: z.boolean().optional(), cantidad_por_pollo: entero(1, 20).optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const pieza = uno((await pool.query('SELECT id, categoria FROM tipos_pieza WHERE id = ?', [piezaId]))[0]);
    if (!pieza) throw new ErrorApp(404, 'Esa pieza no existe');
    if (d.precio !== undefined && pieza.categoria === 'aumento') {
      throw new ErrorApp(422, 'Los aumentos no tienen precio: van incluidos con la presa');
    }
    const sets = [];
    const valores = [];
    if (d.precio !== undefined) (sets.push('precio = ?'), valores.push(d.precio));
    if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
    if (d.cantidad_por_pollo !== undefined) (sets.push('cantidad_por_pollo = ?'), valores.push(d.cantidad_por_pollo));
    await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE tipos_pieza SET ${sets.join(', ')} WHERE id = ?`, [...valores, piezaId]));
    res.json({ ok: true });
  })
);

router.patch(
  '/menu/acompanamientos/:id',
  soloDueno,
  envolver(async (req, res) => {
    const acompId = id.parse(req.params.id);
    const d = z
      .object({ precio_porcion: dinero.nullable().optional(), activo: z.boolean().optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const sets = [];
    const valores = [];
    if (d.precio_porcion !== undefined) (sets.push('precio_porcion = ?'), valores.push(d.precio_porcion));
    if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
    const [r] = await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE acompanamientos SET ${sets.join(', ')} WHERE id = ?`, [...valores, acompId]));
    if (r.affectedRows === 0) throw new ErrorApp(404, 'Ese acompañamiento no existe');
    res.json({ ok: true });
  })
);

router.patch(
  '/menu/reglas/:id',
  soloDueno,
  envolver(async (req, res) => {
    const reglaId = id.parse(req.params.id);
    const d = z
      .object({ recargo: dinero.optional(), activo: z.boolean().optional() })
      .refine((o) => Object.keys(o).length > 0, 'No enviaste ningún cambio')
      .parse(req.body);
    const sets = [];
    const valores = [];
    if (d.recargo !== undefined) (sets.push('recargo = ?'), valores.push(d.recargo));
    if (d.activo !== undefined) (sets.push('activo = ?'), valores.push(d.activo ? 1 : 0));
    const [r] = await conUsuario(req.usuario.id, (cx) => cx.query(`UPDATE reglas_precio SET ${sets.join(', ')} WHERE id = ?`, [...valores, reglaId]));
    if (r.affectedRows === 0) throw new ErrorApp(404, 'Esa regla no existe');
    res.json({ ok: true });
  })
);

// Las gaseosas (CRUD, ingreso y conteo) están en rutas/gaseosas.js → controladores/ → servicios/.

module.exports = router;

// Reportes sencillos, bitácora y las "Reglas" configurables.
const express = require('express');
const { z, fecha, id } = require('../util/validacion');
const { pool, conUsuario, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { soloDueno } = require('../middleware/auth');

const router = express.Router();
router.use(soloDueno);

router.get(
  '/reportes/ventas-semana',
  envolver(async (req, res) => {
    const [dias] = await pool.query(
      `SELECT fecha, venta_total, venta_efectivo, venta_qr, gastos, queda_del_dia
         FROM v_registro_dia WHERE fecha > DATE_SUB(CURDATE(), INTERVAL 7 DAY) ORDER BY fecha`
    );
    const total = dias.reduce((a, d) => a + Number(d.venta_total), 0).toFixed(2);
    res.json({ dias, total });
  })
);

router.get(
  '/reportes/pollos',
  envolver(async (req, res) => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const [filas] = await pool.query(
      `SELECT fecha, pollos_usados, presas_abiertas, presas_vendidas, presas_perdidas, presas_sin_explicar
         FROM v_registro_dia WHERE fecha > DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY fecha`,
      [dias]
    );
    res.json({ dias: filas });
  })
);

/** Puntualidad por persona en un periodo. */
router.get(
  '/reportes/puntualidad',
  envolver(async (req, res) => {
    const q = z.object({ desde: fecha, hasta: fecha }).parse(req.query);
    const [personas] = await pool.query(
      `SELECT e.id, e.nombre,
              COALESCE(SUM(a.estado = 'presente'), 0) AS dias_trabajados,
              COALESCE(SUM(a.estado = 'presente' AND a.minutos_atraso > 0), 0) AS veces_tarde,
              COALESCE(SUM(a.minutos_atraso), 0) AS minutos_atraso,
              COALESCE(SUM(a.estado = 'falta' AND a.falta_justificada = 0), 0) AS faltas,
              COALESCE(SUM(a.estado = 'falta' AND a.falta_justificada = 1), 0) AS faltas_justificadas
         FROM empleados e LEFT JOIN asistencias a ON a.empleado_id = e.id AND a.fecha BETWEEN ? AND ?
        WHERE e.activo = 1 AND e.rol <> 'dueno' GROUP BY e.id, e.nombre ORDER BY e.nombre`,
      [q.desde, q.hasta]
    );
    res.json({ personas });
  })
);

/** Bitácora: quién cambió qué y cuándo (solo lectura, no se puede borrar ni editar). */
router.get(
  '/bitacora',
  envolver(async (req, res) => {
    const q = z
      .object({
        desde: fecha.optional(),
        hasta: fecha.optional(),
        entidad: z.string().max(40).optional(),
        empleado_id: id.optional(),
        limite: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const [filas] = await pool.query(
      `SELECT b.id, b.fecha_hora, e.nombre AS quien, b.accion, b.entidad, b.entidad_id, b.valor_anterior, b.valor_nuevo
         FROM bitacora b LEFT JOIN empleados e ON e.id = b.empleado_id
        WHERE (? IS NULL OR DATE(b.fecha_hora) >= ?) AND (? IS NULL OR DATE(b.fecha_hora) <= ?)
          AND (? IS NULL OR b.entidad = ?) AND (? IS NULL OR b.empleado_id = ?)
        ORDER BY b.id DESC LIMIT ?`,
      [q.desde ?? null, q.desde ?? null, q.hasta ?? null, q.hasta ?? null, q.entidad ?? null, q.entidad ?? null, q.empleado_id ?? null, q.empleado_id ?? null, q.limite]
    );
    const leer = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== 'string') return v; // mysql2 ya lo entregó como objeto
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    };
    res.json({ registros: filas.map((f) => ({ ...f, valor_anterior: leer(f.valor_anterior), valor_nuevo: leer(f.valor_nuevo) })) });
  })
);

// ------------------------------------------------------------------ Reglas (configuración)

const decimal = (max) => z.union([z.number(), z.string()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^\d{1,5}(\.\d{1,4})?$/)).refine((v) => Number(v) <= max, `Máximo ${max}`);
const REGLAS = {
  tolerancia_minutos: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().min(0).max(120)).transform(String),
  descuento_por_minuto_atraso: decimal(100),
  dias_mes_sueldo: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().min(20).max(31)).transform(String),
  margen_diferencia_caja: decimal(1000),
  stock_minimo_gaseosa: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().min(0).max(1000)).transform(String),
};

router.get(
  '/configuracion',
  envolver(async (req, res) => {
    const [reglas] = await pool.query('SELECT clave, valor, descripcion FROM configuracion ORDER BY clave');
    res.json({ reglas });
  })
);

router.put(
  '/configuracion',
  envolver(async (req, res) => {
    const cuerpo = z.record(z.union([z.string(), z.number()])).parse(req.body);
    const claves = Object.keys(cuerpo);
    if (!claves.length) throw new ErrorApp(422, 'No enviaste ningún cambio');
    const nuevos = {};
    for (const clave of claves) {
      if (!REGLAS[clave]) throw new ErrorApp(422, `La regla "${clave}" no existe`);
      const r = REGLAS[clave].safeParse(cuerpo[clave]);
      if (!r.success) throw new ErrorApp(422, `Valor inválido para "${clave}"`);
      nuevos[clave] = r.data;
    }
    await conUsuario(req.usuario.id, async (cx) => {
      for (const [clave, valor] of Object.entries(nuevos)) {
        const actual = uno((await cx.query('SELECT valor FROM configuracion WHERE clave = ?', [clave]))[0]);
        if (actual && actual.valor !== valor) await cx.query('UPDATE configuracion SET valor = ? WHERE clave = ?', [valor, clave]);
      }
    });
    const [reglas] = await pool.query('SELECT clave, valor, descripcion FROM configuracion ORDER BY clave');
    res.json({ reglas });
  })
);

module.exports = router;

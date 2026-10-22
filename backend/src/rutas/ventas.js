// Ventas, tickets y pedidos por llamada.
const express = require('express');
const { z, id, fecha, texto } = require('../util/validacion');
const { pool, transaccion, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { atencionODueno } = require('../middleware/auth');
const { esquemaVenta, crearVenta, anularVenta } = require('../servicios/ventas');
const { ticketsDeVenta } = require('../servicios/tickets');

const router = express.Router();

router.post(
  '/ventas',
  atencionODueno,
  envolver(async (req, res) => {
    const datos = esquemaVenta.parse(req.body);
    const resultado = await crearVenta(req.usuario, datos);
    res.status(201).json(resultado);
  })
);

router.get(
  '/ventas',
  atencionODueno,
  envolver(async (req, res) => {
    const { fecha: dia } = z.object({ fecha: fecha.optional() }).parse(req.query);
    const [ventas] = await pool.query(
      `SELECT v.id, v.numero, v.canal, v.forma_pago, v.total, v.estado, v.creado_en, ea.nombre AS atendida_por,
              pl.codigo AS codigo_llamada, pl.cliente_nombre, pl.estado AS estado_pedido
         FROM ventas v
         JOIN jornadas j ON j.id = v.jornada_id
         JOIN empleados ea ON ea.id = v.atendida_por
         LEFT JOIN pedidos_llamada pl ON pl.venta_id = v.id
        WHERE j.fecha = COALESCE(?, CURDATE())
        ORDER BY v.numero DESC`,
      [dia ?? null]
    );
    res.json({ ventas });
  })
);

router.get(
  '/ventas/:id',
  atencionODueno,
  envolver(async (req, res) => {
    const venta = await ticketsDeVenta(pool, id.parse(req.params.id));
    if (!venta) throw new ErrorApp(404, 'Esa venta no existe');
    res.json({ venta });
  })
);

// Los dos tickets (cliente y caja) listos para mostrar o imprimir. "Reimprimir" también pasa por aquí.
router.get(
  '/ventas/:id/ticket',
  atencionODueno,
  envolver(async (req, res) => {
    const venta = await ticketsDeVenta(pool, id.parse(req.params.id));
    if (!venta) throw new ErrorApp(404, 'Esa venta no existe');
    res.json({ numero: venta.numero, texto_cliente: venta.texto_cliente, texto_caja: venta.texto_caja, venta });
  })
);

router.post(
  '/ventas/:id/anular',
  atencionODueno,
  envolver(async (req, res) => {
    const { motivo } = z.object({ motivo: texto(3, 200) }).parse(req.body);
    const venta = await anularVenta(req.usuario, id.parse(req.params.id), motivo);
    res.json({ venta });
  })
);

// ---------------- Pedidos por llamada ----------------

router.get(
  '/pedidos',
  atencionODueno,
  envolver(async (req, res) => {
    const [pedidos] = await pool.query(
      `SELECT pl.venta_id, pl.codigo, pl.cliente_nombre, pl.telefono, pl.estado, pl.pago_confirmado_en,
              pl.listo_en, pl.entregado_en, v.numero, v.total, v.qr_referencia, v.creado_en
         FROM pedidos_llamada pl JOIN ventas v ON v.id = pl.venta_id JOIN jornadas j ON j.id = v.jornada_id
        WHERE j.fecha = CURDATE() AND pl.estado IN ('recibido','pagado','preparando','listo')
        ORDER BY v.creado_en`
    );
    res.json({ pedidos });
  })
);

const SIGUIENTE = { pagado: ['preparando', 'listo', 'entregado'], preparando: ['listo', 'entregado'], listo: ['entregado'] };

router.patch(
  '/pedidos/:id/estado',
  atencionODueno,
  envolver(async (req, res) => {
    const { estado } = z.object({ estado: z.enum(['preparando', 'listo', 'entregado']) }).parse(req.body);
    const ventaId = id.parse(req.params.id);
    const pedido = await transaccion(req.usuario.id, async (cx) => {
      const p = uno((await cx.query('SELECT venta_id, estado FROM pedidos_llamada WHERE venta_id = ? FOR UPDATE', [ventaId]))[0]);
      if (!p) throw new ErrorApp(404, 'Ese pedido no existe');
      if (!(SIGUIENTE[p.estado] || []).includes(estado)) {
        throw new ErrorApp(409, `Un pedido "${p.estado}" no puede pasar a "${estado}"`);
      }
      await cx.query(
        `UPDATE pedidos_llamada SET estado = ?,
                listo_en = IF(? = 'listo', NOW(), listo_en),
                entregado_en = IF(? = 'entregado', NOW(), entregado_en)
          WHERE venta_id = ?`,
        [estado, estado, estado, ventaId]
      );
      return uno((await cx.query('SELECT venta_id, codigo, cliente_nombre, estado FROM pedidos_llamada WHERE venta_id = ?', [ventaId]))[0]);
    });
    res.json({ pedido });
  })
);

module.exports = router;

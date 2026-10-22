// Crear y anular ventas. Todo ocurre en UNA transacción con la jornada bloqueada:
// se revisa el stock, se guarda la venta y la base de datos descuenta piezas y calcula totales.
const { z, texto } = require('../util/validacion');
const { ErrorApp } = require('../util/errores');
const { transaccion, uno } = require('../db');
const { jornadaAbiertaHoy, sesionEncargada } = require('./jornada');
const { stockPiezas, stockGaseosas } = require('./stock');
const { ticketsDeVenta } = require('./tickets');

const idj = z.number().int().positive();

const itemPlato = z.object({
  tipo: z.literal('plato'),
  presa_id: idj,
  aumento_id: idj.optional(),
  sin_aumento: z.boolean().optional(),
  acompanamientos: z.array(idj).max(10).optional(), // si no se envía: todos los activos
});
const itemPorcion = z.object({
  tipo: z.literal('porcion'),
  acompanamiento_id: idj,
  cantidad: z.number().int().min(1).max(50).default(1),
});
const itemGaseosa = z.object({
  tipo: z.literal('gaseosa'),
  gaseosa_id: idj,
  cantidad: z.number().int().min(1).max(50).default(1),
});

const esquemaVenta = z
  .object({
    canal: z.enum(['mesa', 'llevar', 'llamada']).default('mesa'),
    forma_pago: z.enum(['efectivo', 'qr']),
    qr_referencia: texto(1, 40).optional(),
    atendida_por: idj.optional(),
    llamada: z.object({ cliente_nombre: texto(2, 120), telefono: texto(5, 20).optional() }).optional(),
    items: z.array(z.discriminatedUnion('tipo', [itemPlato, itemPorcion, itemGaseosa])).min(1).max(40),
  })
  .superRefine((d, ctx) => {
    if (d.canal === 'llamada') {
      if (!d.llamada) ctx.addIssue({ code: 'custom', path: ['llamada'], message: 'Escribe el nombre completo del cliente' });
      if (d.forma_pago !== 'qr') ctx.addIssue({ code: 'custom', path: ['forma_pago'], message: 'Los pedidos por llamada se pagan por QR' });
      if (!d.qr_referencia) ctx.addIssue({ code: 'custom', path: ['qr_referencia'], message: 'Anota el número del comprobante del QR' });
    }
  });

const minusculas = (s) => s.toLowerCase();

async function crearVenta(usuario, datos) {
  return transaccion(usuario.id, async (cx) => {
    // 1) Bloquear la jornada: las ventas se hacen de a una, así el stock nunca se cruza.
    const jornada = await jornadaAbiertaHoy(cx, true);
    const encargada = await sesionEncargada(cx, jornada.id);

    // 2) ¿Quién tomó el pedido? (por defecto, quien está en el sistema)
    let atendidaPor = usuario.id;
    if (datos.atendida_por && datos.atendida_por !== usuario.id) {
      const otra = uno(
        (
          await cx.query(
            `SELECT e.id FROM empleados e
              WHERE e.id = ? AND e.activo = 1 AND e.rol IN ('atencion','dueno')
                AND EXISTS (SELECT 1 FROM asistencias a WHERE a.empleado_id = e.id AND a.entrada IS NOT NULL AND a.salida IS NULL)`,
            [datos.atendida_por]
          )
        )[0]
      );
      if (!otra) throw new ErrorApp(422, 'Esa persona no está trabajando ahora (no marcó su llegada)');
      atendidaPor = otra.id;
    }

    // 3) Catálogo y stock actuales
    const [presas] = await cx.query("SELECT id, nombre, activo FROM tipos_pieza WHERE categoria = 'presa'");
    const [relaciones] = await cx.query(
      `SELECT pa.presa_id, t.id, t.nombre, t.activo
         FROM presa_aumento pa JOIN tipos_pieza t ON t.id = pa.aumento_id ORDER BY t.orden`
    );
    const [acomps] = await cx.query('SELECT id, nombre, activo, precio_porcion FROM acompanamientos ORDER BY orden');
    const stockP = await stockPiezas(cx, jornada.id);

    const idsGas = [...new Set(datos.items.filter((i) => i.tipo === 'gaseosa').map((i) => i.gaseosa_id))];
    const stockG = await stockGaseosas(cx, idsGas);
    const [gaseosas] = idsGas.length
      ? await cx.query('SELECT id, marca, tamano, activo FROM gaseosas WHERE id IN (?)', [idsGas])
      : [[]];

    const descontar = (mapa, id, n = 1) => mapa.set(id, (mapa.get(id) || 0) - n);
    const avisos = [];
    const plan = [];

    // 4) Revisar cada línea del pedido (sin guardar nada todavía)
    for (const item of datos.items) {
      if (item.tipo === 'plato') {
        const presa = presas.find((p) => p.id === item.presa_id);
        if (!presa || !presa.activo) throw new ErrorApp(422, 'Esa presa no existe o está desactivada');
        if ((stockP.get(presa.id) || 0) < 1) {
          throw new ErrorApp(409, `No quedan ${minusculas(presa.nombre)}`, { codigo: 'SIN_STOCK', producto: presa.nombre });
        }
        descontar(stockP, presa.id);

        const posibles = relaciones.filter((r) => r.presa_id === presa.id && r.activo);
        let aumento = null;
        if (item.aumento_id !== undefined) {
          aumento = posibles.find((r) => r.id === item.aumento_id);
          if (!aumento) throw new ErrorApp(422, 'Ese aumento no va con esa presa');
          if ((stockP.get(aumento.id) || 0) < 1) {
            throw new ErrorApp(409, `No quedan ${minusculas(aumento.nombre)}`, { codigo: 'SIN_STOCK', producto: aumento.nombre });
          }
        } else if (!item.sin_aumento && posibles.length) {
          const conStock = posibles.filter((r) => (stockP.get(r.id) || 0) >= 1);
          if (conStock.length === 1) aumento = conStock[0];
          else if (conStock.length > 1) {
            throw new ErrorApp(422, `Elige el aumento: ${conStock.map((r) => minusculas(r.nombre)).join(' o ')}`, {
              codigo: 'ELEGIR_AUMENTO',
              opciones: conStock.map((r) => ({ id: r.id, nombre: r.nombre })),
            });
          } else {
            avisos.push(`Se vendió ${minusculas(presa.nombre)} sin aumento porque ya no quedan`);
          }
        }
        if (aumento) descontar(stockP, aumento.id);

        const pedidos = [...new Set(item.acompanamientos ?? acomps.filter((a) => a.activo).map((a) => a.id))];
        for (const idAc of pedidos) {
          const ac = acomps.find((a) => a.id === idAc);
          if (!ac || !ac.activo) throw new ErrorApp(422, 'Ese acompañamiento no existe o está desactivado');
        }
        plan.push({ tipo: 'plato', presa, aumento, acomps: pedidos });
      } else if (item.tipo === 'porcion') {
        const ac = acomps.find((a) => a.id === item.acompanamiento_id);
        if (!ac || !ac.activo) throw new ErrorApp(422, 'Esa porción no existe o está desactivada');
        if (ac.precio_porcion === null) {
          throw new ErrorApp(422, `La porción de ${minusculas(ac.nombre)} todavía no tiene precio. Pídele al dueño que lo registre.`);
        }
        plan.push({ tipo: 'porcion', acompanamiento: ac, cantidad: item.cantidad });
      } else {
        const g = gaseosas.find((x) => x.id === item.gaseosa_id);
        if (!g || !g.activo) throw new ErrorApp(422, 'Esa gaseosa no existe o está desactivada');
        const quedan = stockG.get(g.id) || 0;
        if (quedan < item.cantidad) {
          throw new ErrorApp(409, `No quedan suficientes ${g.marca} ${g.tamano} (quedan ${Math.max(quedan, 0)})`, {
            codigo: 'SIN_STOCK',
            producto: `${g.marca} ${g.tamano}`,
          });
        }
        descontar(stockG, g.id, item.cantidad);
        plan.push({ tipo: 'gaseosa', gaseosa: g, cantidad: item.cantidad });
      }
    }

    // 5) Guardar. La base descuenta el stock, congela precios, aplica el recargo y calcula el total.
    const [rv] = await cx.query(
      `INSERT INTO ventas (jornada_id, numero, sesion_caja_id, atendida_por, canal, forma_pago, qr_referencia)
       VALUES (?, 0, ?, ?, ?, ?, ?)`,
      [jornada.id, encargada.id, atendidaPor, datos.canal, datos.forma_pago, datos.qr_referencia ?? null]
    );
    const ventaId = rv.insertId;

    for (const p of plan) {
      if (p.tipo === 'plato') {
        const [ri] = await cx.query(
          "INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id, aumento_id) VALUES (?, 'plato', ?, ?)",
          [ventaId, p.presa.id, p.aumento ? p.aumento.id : null]
        );
        if (p.acomps.length) {
          await cx.query('INSERT INTO venta_item_acomp (venta_item_id, acompanamiento_id) VALUES ?', [
            p.acomps.map((idAc) => [ri.insertId, idAc]),
          ]);
        }
      } else if (p.tipo === 'porcion') {
        await cx.query(
          "INSERT INTO venta_items (venta_id, tipo, acompanamiento_id, cantidad) VALUES (?, 'porcion', ?, ?)",
          [ventaId, p.acompanamiento.id, p.cantidad]
        );
      } else {
        await cx.query(
          "INSERT INTO venta_items (venta_id, tipo, gaseosa_id, cantidad) VALUES (?, 'gaseosa', ?, ?)",
          [ventaId, p.gaseosa.id, p.cantidad]
        );
      }
    }

    // 6) Pedido por llamada: código corto para entregárselo al cliente
    if (datos.canal === 'llamada') {
      const { numero } = uno((await cx.query('SELECT numero FROM ventas WHERE id = ?', [ventaId]))[0]);
      await cx.query(
        "INSERT INTO pedidos_llamada (venta_id, codigo, cliente_nombre, telefono, estado, pago_confirmado_en) VALUES (?, ?, ?, ?, 'pagado', NOW())",
        [ventaId, `P-${String(numero).padStart(2, '0')}`, datos.llamada.cliente_nombre, datos.llamada.telefono ?? null]
      );
    }

    const venta = await ticketsDeVenta(cx, ventaId);
    return { venta, avisos };
  });
}

/** Anular: el stock vuelve solo (con registro) y queda en la bitácora. */
async function anularVenta(usuario, ventaId, motivo) {
  return transaccion(usuario.id, async (cx) => {
    const venta = uno(
      (
        await cx.query(
          `SELECT v.id, v.estado, s.estado AS estado_sesion, j.estado AS estado_jornada
             FROM ventas v
             JOIN sesiones_caja s ON s.id = v.sesion_caja_id
             JOIN jornadas j ON j.id = v.jornada_id
            WHERE v.id = ? FOR UPDATE`,
          [ventaId]
        )
      )[0]
    );
    if (!venta) throw new ErrorApp(404, 'Esa venta no existe');
    if (venta.estado === 'anulada') throw new ErrorApp(409, 'Esa venta ya estaba anulada');
    if (venta.estado_jornada !== 'abierta') {
      throw new ErrorApp(409, 'Ese día ya está cerrado. El dueño debe reabrirlo para anular ventas.');
    }
    if (usuario.rol !== 'dueno' && venta.estado_sesion !== 'abierta') {
      throw new ErrorApp(403, 'Esa venta ya se cerró en caja. Pídele al dueño que la anule.');
    }
    await cx.query(
      "UPDATE ventas SET estado = 'anulada', anulada_por = ?, anulada_en = NOW(), motivo_anulacion = ? WHERE id = ?",
      [usuario.id, motivo, ventaId]
    );
    await cx.query("UPDATE pedidos_llamada SET estado = 'cancelado' WHERE venta_id = ?", [ventaId]);
    return ticketsDeVenta(cx, ventaId);
  });
}

module.exports = { esquemaVenta, crearVenta, anularVenta };

// Datos y texto de los DOS tickets de cada venta: uno para el cliente y otro para la caja/servicio.
const config = require('../config');
const { bs } = require('../util/validacion');

const ANCHO = 42; // caracteres por línea en papel de 80 mm

async function datosTicket(conexion, ventaId) {
  const [[venta]] = await conexion.query(
    `SELECT v.id, v.numero, v.canal, v.forma_pago, v.qr_referencia, v.total, v.estado, v.creado_en,
            j.fecha, ea.nombre AS atendida_por, ec.nombre AS cajera,
            pl.codigo AS codigo_llamada, pl.cliente_nombre
       FROM ventas v
       JOIN jornadas j ON j.id = v.jornada_id
       JOIN empleados ea ON ea.id = v.atendida_por
       JOIN sesiones_caja s ON s.id = v.sesion_caja_id
       JOIN empleados ec ON ec.id = s.empleado_id
       LEFT JOIN pedidos_llamada pl ON pl.venta_id = v.id
      WHERE v.id = ?`,
    [ventaId]
  );
  if (!venta) return null;

  const [items] = await conexion.query(
    `SELECT vi.id, vi.tipo, vi.cantidad, vi.precio_base, vi.recargo, vi.subtotal,
            p.nombre AS presa, a.nombre AS aumento, ac.nombre AS porcion, g.marca, g.tamano
       FROM venta_items vi
       LEFT JOIN tipos_pieza p ON p.id = vi.tipo_pieza_id
       LEFT JOIN tipos_pieza a ON a.id = vi.aumento_id
       LEFT JOIN acompanamientos ac ON ac.id = vi.acompanamiento_id
       LEFT JOIN gaseosas g ON g.id = vi.gaseosa_id
      WHERE vi.venta_id = ? ORDER BY vi.id`,
    [ventaId]
  );

  const idsPlatos = items.filter((i) => i.tipo === 'plato').map((i) => i.id);
  const incluidos = new Map();
  if (idsPlatos.length) {
    const [filas] = await conexion.query(
      `SELECT via.venta_item_id, ac.nombre
         FROM venta_item_acomp via JOIN acompanamientos ac ON ac.id = via.acompanamiento_id
        WHERE via.venta_item_id IN (?) ORDER BY ac.orden`,
      [idsPlatos]
    );
    for (const f of filas) {
      if (!incluidos.has(f.venta_item_id)) incluidos.set(f.venta_item_id, []);
      incluidos.get(f.venta_item_id).push(f.nombre);
    }
  }
  const [activos] = await conexion.query('SELECT nombre FROM acompanamientos WHERE activo = 1 ORDER BY orden');

  const lineas = items.map((i) => {
    let descripcion;
    let detalle = null;
    if (i.tipo === 'plato') {
      const acomps = incluidos.get(i.id) || [];
      descripcion = i.aumento ? `${i.presa} + ${i.aumento.toLowerCase()}` : i.presa;
      if (acomps.length === 1) detalle = `Pura ${acomps[0].toLowerCase()}`;
      else if (acomps.length === 0) detalle = 'Solo pollo';
      else {
        const sin = activos.map((a) => a.nombre).filter((n) => !acomps.includes(n));
        detalle = acomps.map((n) => n.toLowerCase()).join(', ') + (sin.length ? ` (sin ${sin.map((n) => n.toLowerCase()).join(', ')})` : '');
      }
    } else if (i.tipo === 'porcion') {
      descripcion = `Porción de ${i.porcion.toLowerCase()}`;
    } else {
      descripcion = `${i.marca} ${i.tamano}`;
    }
    return {
      descripcion,
      detalle,
      cantidad: i.cantidad,
      precio_unitario: (Number(i.precio_base) + Number(i.recargo)).toFixed(2),
      recargo: i.recargo,
      subtotal: i.subtotal,
    };
  });

  return {
    venta_id: venta.id,
    numero: venta.numero,
    canal: venta.canal,
    fecha_hora: venta.creado_en,
    fecha: venta.fecha,
    forma_pago: venta.forma_pago,
    qr_referencia: venta.qr_referencia,
    total: venta.total,
    estado: venta.estado,
    atendida_por: venta.atendida_por,
    cajera: venta.cajera,
    llamada: venta.codigo_llamada ? { codigo: venta.codigo_llamada, cliente: venta.cliente_nombre } : null,
    items: lineas,
  };
}

const centrar = (t) => ' '.repeat(Math.max(0, Math.floor((ANCHO - t.length) / 2))) + t;
const dosColumnas = (izq, der) => {
  const espacio = Math.max(1, ANCHO - izq.length - der.length);
  return izq + ' '.repeat(espacio) + der;
};
const linea = '-'.repeat(ANCHO);
const canalTexto = { mesa: 'MESA', llevar: 'PARA LLEVAR', llamada: 'PEDIDO POR LLAMADA' };

/** Texto listo para imprimir (tipo: 'cliente' o 'caja'). */
function textoTicket(t, tipo) {
  const salida = [];
  const hora = String(t.fecha_hora).slice(0, 16);
  if (tipo === 'cliente') {
    salida.push(centrar(config.negocioNombre.toUpperCase()), centrar(`Pedido N° ${t.numero}`), centrar(hora), linea);
    for (const i of t.items) {
      salida.push(dosColumnas(`${i.cantidad} ${i.descripcion}`, bs(i.subtotal).replace('Bs ', '')));
      if (i.detalle) salida.push(`   ${i.detalle}`);
    }
    salida.push(linea, dosColumnas('TOTAL', bs(t.total)), `Pago: ${t.forma_pago === 'qr' ? 'QR' : 'Efectivo'}`);
    if (t.llamada) salida.push(`Cliente: ${t.llamada.cliente}`, `Código: ${t.llamada.codigo}`);
    salida.push(linea, centrar('¡Gracias por su compra!'));
  } else {
    salida.push(centrar('COPIA CAJA / SERVICIO'), centrar(`PEDIDO N° ${t.numero}`), centrar(canalTexto[t.canal] || t.canal), centrar(hora), linea);
    for (const i of t.items) {
      salida.push(`${i.cantidad} x ${i.descripcion}`);
      if (i.detalle) salida.push(`     ${i.detalle}`);
    }
    salida.push(linea);
    if (t.llamada) salida.push(`Cliente: ${t.llamada.cliente}`, `Código: ${t.llamada.codigo}`);
    salida.push(`Atendió: ${t.atendida_por}`, `Caja: ${t.cajera}`, dosColumnas('Total', bs(t.total)));
  }
  return salida.join('\n');
}

async function ticketsDeVenta(conexion, ventaId) {
  const datos = await datosTicket(conexion, ventaId);
  if (!datos) return null;
  return { ...datos, texto_cliente: textoTicket(datos, 'cliente'), texto_caja: textoTicket(datos, 'caja') };
}

module.exports = { datosTicket, textoTicket, ticketsDeVenta };

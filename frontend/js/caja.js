// Pantallas de quien atiende: empezar turno, vender, pedidos, ventas del día, pérdidas, gastos y cerrar mi caja.
// Regla de oro: casi todo se hace TOCANDO botones. Solo se escribe un nombre (pedido por llamada).
import { h, poner, estado, GET, POST, PATCH, DEL, bs, num, hora, aviso, falla, intentar, modal, confirmar, preguntar, pedirNumero, elegirUno, imprimir, MOTIVOS } from './nucleo.js';

let refrescarYo = async () => {};
export const enlazar = (fn) => { refrescarYo = fn; };
const otra = (el, f) => { el.replaceChildren(); return f(el); };

// ------------------------------------------------------------------ EMPEZAR MI TURNO (marca llegada + abre caja)
const BILLETES_RAPIDOS = [50, 100, 200, 300, 500];
const turnoSegunHora = (turnos) => {
  const ahora = new Date(Date.now() - 4 * 3600 * 1000);
  const min = ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
  const aMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const dentro = turnos.filter((t) => min >= aMin(t.hora_inicio) - 60 && min < aMin(t.hora_fin));
  return (dentro.length ? dentro : turnos).slice().sort((a, b) => Math.abs(aMin(a.hora_inicio) - min) - Math.abs(aMin(b.hora_inicio) - min))[0]?.id;
};

async function tarjetaEmpezar(el, alTerminar) {
  const info = await GET('/caja/estado');
  const turnos = info.elegir_turno;
  let turnoId = turnos ? turnoSegunHora(turnos) : undefined;
  const seraEncargada = !info.encargada_actual;
  const esperado = num(info.fondo_esperado);

  const abrir = async (fondo) => {
    const cuerpo = {};
    if (turnoId) cuerpo.turno_id = turnoId;
    if (seraEncargada) cuerpo.fondo_recibido = fondo;
    try {
      const r = await POST('/caja/abrir', cuerpo);
      aviso(r.mensaje);
      await refrescarYo();
      alTerminar();
    } catch (e) { falla(e); }
  };
  const contar = async () => {
    const f = await pedirNumero('¿Cuánto efectivo hay en la caja?', { atajos: BILLETES_RAPIDOS.map((v) => ({ texto: `${v}`, valor: v })), intro: 'Cuenta el dinero que recibes y tócalo aquí.' });
    if (f !== null) abrir(f);
  };
  const dibujar = () => {
    el.replaceChildren(h('div', { class: 'tarjeta col' },
      h('h1', { style: 'margin:0' }, '¡Hola, ' + estado.usuario.nombre + '!'),
      h('p', { class: 'suave', style: 'margin:0' }, 'Toca el botón para empezar. Se anota tu llegada y se abre tu caja.'),
      turnos && h('div', {}, h('label', {}, '¿En qué turno trabajas hoy?'),
        h('div', { class: 'grid tres' }, turnos.map((t) => h('button', { class: `opcion corta ${t.id === turnoId ? 'activa' : ''}`, onclick: () => { turnoId = t.id; dibujar(); } }, h('span', {}, t.nombre, h('small', {}, `${t.hora_inicio} a ${t.hora_fin}`)))))),
      seraEncargada
        ? [info.relevo_pendiente && h('div', { class: 'aviso alerta' }, `${info.relevo_pendiente.entrego} te entrega Bs ${num(info.relevo_pendiente.monto_entregado)} en caja.`),
          esperado > 0
            ? [h('div', { class: 'aviso' }, `Tú guardarás el dinero. ¿Hay ${bs(esperado)} en la caja?`),
              h('div', { class: 'grid dos' },
                h('button', { class: 'btn am grande', onclick: () => abrir(String(esperado)) }, `✓ Sí, ${bs(esperado)}`),
                h('button', { class: 'btn sec grande', onclick: contar }, 'Hay otro monto'))]
            : [h('div', { class: 'aviso' }, 'Tú guardarás el dinero de la caja.'), h('button', { class: 'btn grande bloque', onclick: contar }, '💵 Contar el efectivo y empezar')]]
        : [h('div', { class: 'aviso' }, `${info.encargada_actual.nombre} guarda el dinero. Tú apoyas en caja.`), h('button', { class: 'btn grande bloque', onclick: () => abrir() }, '▶ Empezar a atender')]));
  };
  dibujar();
}

// ------------------------------------------------------------------ ABRIR POLLOS (sin salir de la venta)
async function abrirPollos(alTerminar) {
  const { pollos_crudos } = await GET('/pollos');
  if (num(pollos_crudos) <= 0) {
    return modal('No hay pollos crudos', h('div', { class: 'col' }, h('div', { class: 'aviso alerta' }, 'En el sistema no hay pollos crudos anotados. Avisa al dueño para que anote la compra.'), h('button', { class: 'btn', onclick: (e) => e.target.closest('.sombra-fondo').remove() }, 'Entendido')));
  }
  const n = await pedirNumero('¿Cuántos pollos vas a abrir?', { decimal: false, unidad: 'pollos', intro: `Hay ${pollos_crudos} pollos crudos.`, atajos: [2, 3, 4, 5, 6, 8, 10].filter((x) => x <= pollos_crudos).map((v) => ({ texto: String(v), valor: v })) });
  if (n === null) return;
  if (await intentar(() => POST('/pollos/abrir', { cantidad: Number(n) }), `Listo: ${n} pollos abiertos`)) alTerminar();
}

// ------------------------------------------------------------------ VENDER
const nuevaVenta = () => ({ items: [], canal: 'mesa', pago: 'efectivo', cliente: '', telefono: '', qr: '', pagoCon: '' });
const venta = nuevaVenta();

const presaDe = (m, id) => m.presas.find((p) => p.id === id);
const enCarrito = (clave, id) => venta.items.filter((i) => i[clave] === id).reduce((a, i) => a + (i.cantidad || 1), 0);
const nombreGaseosa = (g) => `${g.marca} ${g.tamano}`;

function recargoPlato(m, it) {
  const activos = m.acompanamientos.filter((a) => a.activo).map((a) => a.id);
  const sel = activos.filter((id) => it.acomp.has(id));
  if (sel.length !== 1) return 0;
  const regla = m.reglas.find((r) => r.activo && r.acompanamiento_unico_id === sel[0]);
  return regla ? num(regla.recargo) : 0;
}
const precioPlato = (m, it) => num(presaDe(m, it.presa_id).precio) + recargoPlato(m, it);
const precioLinea = (m, it) => {
  if (it.tipo === 'plato') return precioPlato(m, it);
  if (it.tipo === 'porcion') return num(m.acompanamientos.find((x) => x.id === it.acompanamiento_id).precio_porcion) * it.cantidad;
  return num(m.gaseosas.find((x) => x.id === it.gaseosa_id).precio) * it.cantidad;
};
const totalCarrito = (m) => venta.items.reduce((a, it) => a + precioLinea(m, it), 0);

export async function pantallaVender(el) {
  if (!estado.caja) { await tarjetaEmpezar(el, () => otra(el, pantallaVender)); return; }
  const m = await GET('/menu');
  const dibujar = () => el.replaceChildren(...contenidoVender(m, dibujar, () => otra(el, pantallaVender)));
  dibujar();
}

function contenidoVender(m, dibujar, recargar) {
  const agregarPlato = async (p) => {
    const activos = p.aumentos.filter((a) => a.activo);
    let aumento_id;
    let sin_aumento = false;
    if (activos.length > 1) {
      const eleccion = await elegirUno(`${p.nombre}: ¿qué aumento lleva?`, [
        ...activos.map((a) => ({ valor: a.id, texto: a.nombre, detalle: `quedan ${a.stock}`, desactivado: a.stock <= 0 })),
        { valor: 0, texto: 'Sin aumento' }]);
      if (eleccion === null) return;
      if (eleccion === 0) sin_aumento = true; else aumento_id = eleccion;
    }
    venta.items.push({ tipo: 'plato', presa_id: p.id, aumento_id, sin_aumento, acomp: new Set(m.acompanamientos.filter((a) => a.activo).map((a) => a.id)) });
    dibujar();
  };
  const sumar = (tipo, clave, id, tope) => {
    const ya = venta.items.find((i) => i.tipo === tipo && i[clave] === id);
    if (ya) { if (ya.cantidad < tope) ya.cantidad++; else return aviso('No hay más en stock', 'mal'); }
    else venta.items.push({ tipo, [clave]: id, cantidad: 1 });
    dibujar();
  };

  const hayPollo = m.jornada && m.presas.some((p) => p.stock > 0);
  const aviso0 = !hayPollo && h('div', { class: 'tarjeta amarilla col' },
    h('b', {}, '🐔 Todavía no hay pollos abiertos hoy'),
    h('span', { class: 'suave' }, 'Abre los pollos del día para poder vender.'),
    h('button', { class: 'btn am grande', onclick: () => abrirPollos(recargar) }, 'Abrir pollos'));

  const insignia = (n) => n > 0 && h('span', { class: 'en-pedido' }, n);
  const presas = h('div', { class: 'grid' }, m.presas.filter((p) => p.activo).map((p) => {
    const en = enCarrito('presa_id', p.id);
    const quedan = p.stock - en;
    return h('button', { class: `opcion plato ${quedan <= 0 ? 'agotado' : ''}`, disabled: quedan <= 0, onclick: () => agregarPlato(p) },
      insignia(en), p.nombre, h('span', { class: 'precio' }, bs(p.precio)), quedan <= 0 ? h('small', {}, 'Agotado') : quedan <= 3 ? h('span', { class: 'bajo' }, `quedan ${quedan}`) : h('small', {}, `quedan ${quedan}`));
  }));

  const porciones = m.acompanamientos.filter((a) => a.activo && a.precio_porcion !== null);
  const bloquePorciones = porciones.length > 0 && [h('h2', {}, 'Porciones aparte'), h('div', { class: 'grid' }, porciones.map((a) => h('button', { class: 'opcion porcion', onclick: () => sumar('porcion', 'acompanamiento_id', a.id, 50) },
    insignia(enCarrito('acompanamiento_id', a.id)), `Porción de ${a.nombre.toLowerCase()}`, h('span', { class: 'precio' }, bs(a.precio_porcion)))))];

  const bloqueGaseosas = m.gaseosas.length > 0 && [h('h2', {}, 'Gaseosas'), h('div', { class: 'grid' }, m.gaseosas.map((g) => {
    const en = enCarrito('gaseosa_id', g.id);
    const quedan = g.stock - en;
    return h('button', { class: `opcion gaseosa ${quedan <= 0 ? 'agotado' : ''}`, disabled: quedan <= 0, onclick: () => sumar('gaseosa', 'gaseosa_id', g.id, g.stock) },
      insignia(en), nombreGaseosa(g), h('span', { class: 'precio' }, bs(g.precio)), quedan <= 0 ? h('small', {}, 'Agotado') : quedan <= 3 ? h('span', { class: 'bajo' }, `quedan ${quedan}`) : h('small', {}, `quedan ${quedan}`));
  }))];

  const total = totalCarrito(m);
  const cantidad = venta.items.reduce((a, i) => a + (i.cantidad || 1), 0);
  const menu = h('div', {}, aviso0, h('h2', { style: 'margin-top:0' }, 'Platos'), presas, bloquePorciones, bloqueGaseosas);
  const pedido = h('div', { class: 'pos-pedido', id: 'pedido' }, pedidoVista(m, dibujar));
  const barra = cantidad > 0 && h('div', { class: 'barra-cobro' }, h('button', { class: 'btn', onclick: () => document.getElementById('pedido')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, h('span', {}, `🧾 Ver pedido (${cantidad})`), h('b', {}, bs(total))));
  if (barra && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(([e]) => { barra.style.display = e.isIntersecting ? 'none' : ''; }, { threshold: 0.35 });
    setTimeout(() => { if (pedido.isConnected) obs.observe(pedido); }, 0);
  }
  return [h('div', { class: 'pos' }, menu, pedido), barra].filter(Boolean);
}

function pedidoVista(m, dibujar) {
  if (venta.items.length === 0) return h('div', { class: 'vacio-pedido' }, h('span', { class: 'grande' }, '👆'), 'Toca un plato o una gaseosa para empezar el pedido.');
  const total = totalCarrito(m);
  const lineas = venta.items.map((it, idx) => {
    const quitar = () => { venta.items.splice(idx, 1); dibujar(); };
    if (it.tipo === 'plato') {
      const p = presaDe(m, it.presa_id);
      const aum = it.aumento_id ? m.aumentos.find((a) => a.id === it.aumento_id)?.nombre : null;
      const recargo = recargoPlato(m, it);
      return h('div', { class: 'item' },
        h('div', { class: 'cab' }, h('span', { class: 'nombre' }, p.nombre + (aum ? ` + ${aum.toLowerCase()}` : '')), h('b', { class: 'mono' }, bs(precioPlato(m, it))), h('button', { class: 'quitar', onclick: quitar, 'aria-label': `Quitar ${p.nombre}` }, '✕')),
        h('div', { class: 'acomps' }, m.acompanamientos.filter((a) => a.activo).map((a) => h('button', {
          class: `acomp ${it.acomp.has(a.id) ? 'si' : ''}`,
          onclick: () => { if (it.acomp.has(a.id)) { if (it.acomp.size > 1) it.acomp.delete(a.id); else return aviso('Deja al menos un acompañamiento', 'mal'); } else it.acomp.add(a.id); dibujar(); },
        }, (it.acomp.has(a.id) ? '✓ ' : '') + a.nombre)), recargo > 0 && h('span', { class: 'chip alerta', style: 'align-self:center' }, `Pura papa +${bs(recargo)}`)));
    }
    const nombre = it.tipo === 'porcion' ? `Porción de ${m.acompanamientos.find((a) => a.id === it.acompanamiento_id).nombre.toLowerCase()}` : nombreGaseosa(m.gaseosas.find((x) => x.id === it.gaseosa_id));
    const tope = it.tipo === 'gaseosa' ? m.gaseosas.find((x) => x.id === it.gaseosa_id).stock : 50;
    return h('div', { class: 'item' }, h('div', { class: 'cab' }, h('span', { class: 'nombre' }, nombre),
      h('div', { class: 'contador' },
        h('button', { onclick: () => { it.cantidad--; if (it.cantidad <= 0) venta.items.splice(idx, 1); dibujar(); }, 'aria-label': 'Menos' }, '−'), h('b', {}, it.cantidad),
        h('button', { onclick: () => { if (it.cantidad < tope) { it.cantidad++; dibujar(); } else aviso('No hay más en stock', 'mal'); }, 'aria-label': 'Más' }, '+')),
      h('b', { class: 'mono' }, bs(precioLinea(m, it)))));
  });

  const llamada = venta.canal === 'llamada';
  if (llamada) venta.pago = 'qr';
  const paga = num(String(venta.pagoCon).replace(',', '.'));
  const efectivo = venta.pago === 'efectivo' && !llamada;
  const billetes = [10, 20, 50, 100, 200].filter((b) => b >= total).slice(0, 3);

  const botonesTres = (lista, actual, poner_) => h('div', { class: `grid ${lista.length === 3 ? 'tres' : 'dos'}` }, lista.map(([k, t]) => h('button', { class: `opcion corta ${actual === k ? 'activa' : ''}`, onclick: () => poner_(k) }, t)));
  const pedirTexto = async (titulo, clave, opciones) => { const r = await pedirNumero(titulo, { decimal: false, unidad: '', largo: 14, valor: venta[clave], ...opciones }); if (r !== null) { venta[clave] = r; dibujar(); } };

  const cuerpo = h('div', { class: 'col pedido-cuerpo' },
    h('h2', { style: 'margin:0' }, 'Pedido'),
    lineas,
    h('div', {}, h('label', {}, '¿Dónde come?'), botonesTres([['mesa', '🍽 Aquí'], ['llevar', '🛍 Llevar'], ['llamada', '📞 Llamada']], venta.canal, (k) => { venta.canal = k; dibujar(); })),
    llamada && h('div', { class: 'col tarjeta amarilla', style: 'margin:0' },
      h('div', {}, h('label', {}, 'Nombre y apellido del cliente'), h('input', { value: venta.cliente, oninput: (e) => { venta.cliente = e.target.value; }, autocomplete: 'off', placeholder: 'Ejemplo: María Flores' })),
      h('button', { class: `valor-boton ${venta.telefono ? '' : 'vacio'}`, onclick: () => pedirTexto('Teléfono del cliente', 'telefono', { intro: 'Opcional. Si no lo tienes, toca Cancelar.' }) }, h('span', {}, venta.telefono ? `📱 ${venta.telefono}` : '📱 Teléfono (opcional)'), h('span', { class: 'lapiz' }, '⌨')),
      h('button', { class: `valor-boton ${venta.qr ? '' : 'vacio'}`, onclick: () => pedirTexto('Número del comprobante del QR', 'qr', { intro: 'Revisa en el celular del local que el pago llegó.' }) }, h('span', {}, venta.qr ? `🧾 Comprobante ${venta.qr}` : '🧾 Número del comprobante (obligatorio)'), h('span', { class: 'lapiz' }, '⌨'))),
    !llamada && h('div', {}, h('label', {}, '¿Cómo paga?'), botonesTres([['efectivo', '💵 Efectivo'], ['qr', '📲 QR']], venta.pago, (k) => { venta.pago = k; dibujar(); })),
    venta.pago === 'qr' && !llamada && h('button', { class: `valor-boton ${venta.qr ? '' : 'vacio'}`, onclick: () => pedirTexto('Número del comprobante del QR', 'qr') }, h('span', {}, venta.qr ? `🧾 Comprobante ${venta.qr}` : '🧾 Anotar comprobante (opcional)'), h('span', { class: 'lapiz' }, '⌨')),
    efectivo && h('div', {}, h('label', {}, '¿Con cuánto paga?'),
      h('div', { class: 'atajos', style: 'margin-top:0' },
        h('button', { class: `opcion ${paga === total && venta.pagoCon !== '' ? 'activa' : ''}`, onclick: () => { venta.pagoCon = String(total); dibujar(); } }, 'Justo'),
        billetes.map((b) => h('button', { class: `opcion ${paga === b ? 'activa' : ''}`, onclick: () => { venta.pagoCon = String(b); dibujar(); } }, `Bs ${b}`)),
        h('button', { class: `opcion ${venta.pagoCon !== '' && paga !== total && !billetes.includes(paga) ? 'activa' : ''}`, onclick: async () => { const r = await pedirNumero('¿Con cuánto paga el cliente?', { valor: venta.pagoCon, atajos: [10, 20, 50, 100, 200].map((v) => ({ texto: String(v), valor: v })) }); if (r !== null) { venta.pagoCon = r; dibujar(); } } }, 'Otro')),
      venta.pagoCon !== '' && (paga >= total ? h('div', { class: 'cambio', style: 'margin-top:10px' }, paga === total ? 'Pago justo, sin cambio' : `Devolver ${bs(paga - total)}`) : h('div', { class: 'cambio falta', style: 'margin-top:10px' }, `Todavía faltan ${bs(total - paga)}`))),
    null);
  const pie = h('div', { class: 'pedido-pie' },
    h('div', { class: 'total-grande' }, h('span', {}, 'TOTAL'), h('b', { class: 'mono' }, bs(total))),
    h('div', { class: 'grid', style: 'grid-template-columns:1fr 2fr' },
      h('button', { class: 'btn sec', onclick: async () => { if (await confirmar('¿Vaciar el pedido?', 'Se borra todo lo que tocaste.', 'Sí, vaciar', true)) { Object.assign(venta, nuevaVenta()); dibujar(); } } }, 'Vaciar'),
      h('button', { class: 'btn grande', disabled: efectivo && venta.pagoCon !== '' && paga < total, onclick: (e) => cobrar(m, dibujar, e.currentTarget, total, efectivo && venta.pagoCon !== '' ? paga - total : null) }, 'COBRAR')));
  return h('div', { class: 'pedido-caja' }, cuerpo, pie);
}

async function cobrar(m, dibujar, boton, total, cambio) {
  const llamada = venta.canal === 'llamada';
  if (llamada) {
    if (venta.cliente.trim().split(/\s+/).length < 2) return aviso('Escribe el nombre y apellido del cliente', 'mal');
    if (!venta.qr.trim()) return aviso('Falta el número del comprobante del QR', 'mal');
  }
  const cuerpo = {
    canal: venta.canal, forma_pago: llamada ? 'qr' : venta.pago,
    items: venta.items.map((it) => {
      if (it.tipo === 'plato') {
        const activos = m.acompanamientos.filter((a) => a.activo).map((a) => a.id);
        const o = { tipo: 'plato', presa_id: it.presa_id };
        if (it.aumento_id) o.aumento_id = it.aumento_id;
        if (it.sin_aumento) o.sin_aumento = true;
        if (activos.some((id) => !it.acomp.has(id))) o.acompanamientos = activos.filter((id) => it.acomp.has(id));
        return o;
      }
      return it.tipo === 'porcion' ? { tipo: 'porcion', acompanamiento_id: it.acompanamiento_id, cantidad: it.cantidad } : { tipo: 'gaseosa', gaseosa_id: it.gaseosa_id, cantidad: it.cantidad };
    }),
  };
  if (venta.qr.trim()) cuerpo.qr_referencia = venta.qr.trim();
  if (llamada) {
    cuerpo.llamada = { cliente_nombre: venta.cliente.trim() };
    if (venta.telefono.trim().length >= 5) cuerpo.llamada.telefono = venta.telefono.trim();
  }
  boton.disabled = true;
  try {
    const r = await POST('/ventas', cuerpo);
    Object.assign(venta, nuevaVenta());
    Object.assign(m, await GET('/menu'));
    dibujar();
    ventaHecha(r.venta, r.avisos, cambio);
  } catch (e) {
    boton.disabled = false;
    falla(e);
    if (e.datos?.codigo === 'SIN_STOCK' || e.datos?.codigo === 'ELEGIR_AUMENTO') { Object.assign(m, await GET('/menu')); dibujar(); }
  }
}

/** Pantalla grande de "venta lista": lo único que hay que hacer es devolver el cambio y tocar "Nueva venta". */
function ventaHecha(v, avisos = [], cambio = null) {
  const m = modal('', h('div', { class: 'col hecho' },
    h('div', { class: 'gigante' }, '✅'),
    h('h1', { style: 'margin:0' }, `Venta ${v.numero} lista`),
    h('div', { class: 'grande-num' }, bs(v.total)),
    cambio !== null && cambio > 0 && h('div', {}, h('div', { class: 'suave', style: 'font-weight:800' }, 'DEVOLVER AL CLIENTE'), h('div', { class: 'cambio-gigante' }, bs(cambio))),
    avisos.map((a) => h('div', { class: 'aviso alerta' }, typeof a === 'string' ? a : a.mensaje || '')),
    h('button', { class: 'btn grande bloque', onclick: () => m.cerrar() }, 'Nueva venta'),
    h('button', { class: 'btn sec bloque', onclick: () => { m.cerrar(); mostrarTickets(v); } }, 'Ver o imprimir tickets')), { cerrable: false });
}

export function mostrarTickets(v) {
  const m = modal(`Venta ${v.numero} · ${bs(v.total)}`, h('div', { class: 'col' },
    h('h3', {}, 'Ticket del cliente'), h('pre', { class: 'ticket' }, v.texto_cliente),
    h('h3', {}, 'Ticket de caja'), h('pre', { class: 'ticket' }, v.texto_caja),
    h('div', { class: 'grid dos' },
      h('button', { class: 'btn', onclick: () => imprimir([v.texto_cliente, v.texto_caja]) }, '🖨 Imprimir'),
      h('button', { class: 'btn sec', onclick: () => m.cerrar() }, 'Listo'))));
}

// ------------------------------------------------------------------ PEDIDOS POR LLAMADA
const SIGUIENTE = { pagado: [['preparando', '👨‍🍳 Preparando'], ['listo', '✅ Listo']], recibido: [['preparando', '👨‍🍳 Preparando'], ['listo', '✅ Listo']], preparando: [['listo', '✅ Listo']], listo: [['entregado', '🤝 Entregado al cliente']] };
export async function pantallaPedidos(el) {
  const { pedidos } = await GET('/pedidos');
  poner(el, h('h1', {}, 'Pedidos por llamada'));
  if (!pedidos.length) poner(el, h('div', { class: 'tarjeta vacio-pedido' }, h('span', { class: 'grande' }, '📞'), 'No hay pedidos pendientes.'));
  for (const p of pedidos) {
    poner(el, h('div', { class: 'tarjeta col' },
      h('div', { class: 'fila sep' }, h('b', { style: 'font-size:1.2rem' }, `${p.codigo} · ${p.cliente_nombre}`), h('span', { class: `chip ${p.estado === 'listo' ? 'ok' : 'alerta'}` }, p.estado)),
      h('div', { class: 'suave' }, `Venta ${p.numero} · ${bs(p.total)} · QR ${p.qr_referencia || '—'}${p.telefono ? ' · Tel. ' + p.telefono : ''}`),
      h('div', { class: 'grid dos' }, (SIGUIENTE[p.estado] || []).map(([k, t]) => h('button', { class: 'btn grande', onclick: async () => { if (await intentar(() => PATCH(`/pedidos/${p.venta_id}/estado`, { estado: k }))) otra(el, pantallaPedidos); } }, t)))));
  }
}

// ------------------------------------------------------------------ VENTAS DEL DÍA
const MOTIVOS_ANULAR = [['equivocacion', 'Me equivoqué al tocar'], ['cliente', 'El cliente se arrepintió'], ['cobro', 'Error en el cobro'], ['otro', 'Otro motivo']];
export async function pantallaVentas(el) {
  const { ventas } = await GET('/ventas');
  const validas = ventas.filter((v) => v.estado === 'valida');
  const total = validas.reduce((a, v) => a + num(v.total), 0);
  poner(el, h('h1', {}, 'Ventas de hoy'),
    h('div', { class: 'tarjeta azul fila sep' }, h('span', { style: 'font-weight:800' }, `${validas.length} ventas`), h('b', { class: 'grande-num', style: 'color:#ffc400' }, bs(total))));
  if (!ventas.length) { poner(el, h('div', { class: 'tarjeta vacio-pedido' }, h('span', { class: 'grande' }, '🧾'), 'Todavía no hay ventas.')); return; }
  poner(el, ventas.map((v) => h('div', { class: 'tarjeta', style: v.estado === 'anulada' ? 'opacity:.55' : '' },
    h('div', { class: 'fila sep' },
      h('div', {}, h('b', { style: v.estado === 'anulada' ? 'text-decoration:line-through' : '' }, `N° ${v.numero} · ${hora(v.creado_en)}`), h('div', { class: 'suave' }, `${v.cliente_nombre ? 'Llamada: ' + v.cliente_nombre : v.canal === 'llevar' ? 'Para llevar' : 'Aquí'} · ${v.forma_pago === 'qr' ? 'QR' : 'Efectivo'}${v.estado === 'anulada' ? ' · ANULADA' : ''}`)),
      h('b', { class: 'grande-num mono', style: 'font-size:1.5rem' }, bs(v.total))),
    h('div', { class: 'fila', style: 'margin-top:8px' },
      h('button', { class: 'btn sec chico', onclick: async () => { const r = await intentar(() => GET(`/ventas/${v.id}/ticket`)); if (r) mostrarTickets(r.venta); } }, 'Ver ticket'),
      v.estado === 'valida' && h('button', { class: 'btn mal chico', onclick: async () => {
        const k = await elegirUno(`Anular la venta ${v.numero}`, MOTIVOS_ANULAR.map(([valor, texto]) => ({ valor, texto })), { intro: '¿Por qué se anula? Las piezas vuelven al stock y queda anotado quién la anuló.' });
        if (k === null) return;
        const motivo = MOTIVOS_ANULAR.find((x) => x[0] === k)[1];
        if (await intentar(() => POST(`/ventas/${v.id}/anular`, { motivo }), 'Venta anulada')) otra(el, pantallaVentas);
      } }, 'Anular')))));
}

// ------------------------------------------------------------------ PÉRDIDAS
const perdida = { motivo: null, cant: new Map(), nota: '' };
const ICONO_MOTIVO = { consumo_personal: '🍴', quemado_o_caido: '🔥', regalo: '🎁', otro: '✏️' };
export async function pantallaPerdidas(el) {
  if (!estado.caja && estado.usuario.rol !== 'dueno') { await tarjetaEmpezar(el, () => otra(el, pantallaPerdidas)); return; }
  const [{ piezas }, menu, { perdidas }] = await Promise.all([GET('/piezas/hoy'), GET('/menu'), GET('/perdidas')]);
  const dibujar = () => {
    const lineas = [];
    const contador = (clave, nombre, tope) => {
      const n = perdida.cant.get(clave) || 0;
      return h('div', { class: 'linea' }, h('span', { style: 'font-weight:800' }, nombre, h('small', { class: 'suave' }, `  (quedan ${tope})`)),
        h('div', { class: 'contador' }, h('button', { onclick: () => { perdida.cant.set(clave, Math.max(0, n - 1)); dibujar(); } }, '−'), h('b', {}, n), h('button', { onclick: () => { if (n < tope) { perdida.cant.set(clave, n + 1); dibujar(); } } }, '+')));
    };
    for (const p of piezas.filter((x) => x.restante > 0)) lineas.push(contador(`p${p.id}`, p.nombre, p.restante));
    for (const g of menu.gaseosas.filter((x) => x.stock > 0)) lineas.push(contador(`g${g.id}`, nombreGaseosa(g), g.stock));
    const hay = [...perdida.cant.values()].some((n) => n > 0);
    el.replaceChildren(
      h('h1', {}, 'Anotar pérdidas'),
      h('p', { class: 'suave' }, 'Pollo que se quemó, se cayó o que comió el personal. Solo se anota la cantidad.'),
      h('div', { class: 'tarjeta col' },
        h('label', {}, '1. ¿Qué pasó?'),
        h('div', { class: 'grid' }, Object.entries(MOTIVOS).map(([k, t]) => h('button', { class: `opcion corta ${perdida.motivo === k ? 'activa' : ''}`, onclick: () => { perdida.motivo = k; dibujar(); } }, `${ICONO_MOTIVO[k] || ''} ${t}`))),
        perdida.motivo === 'otro' && h('input', { placeholder: 'Explica el motivo (opcional)', value: perdida.nota, oninput: (e) => { perdida.nota = e.target.value; } }),
        h('label', {}, '2. ¿Cuántos?'),
        lineas.length ? lineas : h('p', { class: 'suave' }, 'No hay piezas ni gaseosas en stock para anotar.'),
        h('button', { class: 'btn grande bloque', disabled: !hay || !perdida.motivo, onclick: async () => {
          const items = [...perdida.cant].filter(([, n]) => n > 0).map(([k, n]) => (k[0] === 'p' ? { pieza_id: Number(k.slice(1)), cantidad: n } : { gaseosa_id: Number(k.slice(1)), cantidad: n }));
          const cuerpo = { motivo: perdida.motivo, items };
          if (perdida.motivo === 'otro') cuerpo.nota = perdida.nota.trim() || 'Sin detalle';
          if (await intentar(() => POST('/perdidas', cuerpo), 'Pérdida anotada')) { perdida.cant.clear(); perdida.motivo = null; perdida.nota = ''; otra(el, pantallaPerdidas); }
        } }, 'Guardar pérdida')),
      h('h2', {}, 'Anotado hoy'),
      !perdidas.filter((x) => !x.anulada).length ? h('p', { class: 'suave' }, 'Nada anotado todavía.') : h('div', { class: 'tarjeta' }, perdidas.filter((x) => !x.anulada).map((x) => h('div', { class: 'linea' }, h('span', {}, `${x.cantidad} × ${x.producto} — ${MOTIVOS[x.motivo]}`, h('small', { class: 'suave' }, ` · ${x.registrado_por} ${hora(x.creado_en)}`)),
        estado.usuario.rol === 'dueno' && h('button', { class: 'btn sec chico', onclick: async () => { if (await confirmar('Quitar esta pérdida', 'La pieza vuelve al stock.', 'Quitar', true) && await intentar(() => DEL(`/perdidas/${x.id}`), 'Quitada')) otra(el, pantallaPerdidas); } }, 'Quitar')))));
  };
  dibujar();
}

// ------------------------------------------------------------------ GASTOS
const CONCEPTOS = [['🔥', 'Carbón'], ['🛢', 'Aceite'], ['⛽', 'Gas'], ['🚕', 'Transporte'], ['🛍', 'Bolsas y envases'], ['🥔', 'Papas y verduras'], ['🧽', 'Limpieza'], ['🧊', 'Hielo'], ['✏️', 'Otro']];
export async function pantallaGastos(el) {
  if (!estado.caja && estado.usuario.rol !== 'dueno') { await tarjetaEmpezar(el, () => otra(el, pantallaGastos)); return; }
  const { gastos } = await GET('/gastos');
  const vivos = gastos.filter((g) => !g.anulado);
  const anotar = async (nombre) => {
    const campos = [];
    if (nombre === 'Otro') campos.push({ nombre: 'concepto', etiqueta: '¿En qué se gastó?', ayuda: 'Ejemplo: reparar la freidora' });
    campos.push({ nombre: 'monto', etiqueta: 'Monto (Bs)', tipo: 'dinero', atajos: [5, 10, 20, 50, 100, 200].map((v) => ({ texto: String(v), valor: v })) });
    campos.push({ nombre: 'de_caja', etiqueta: 'Se pagó con el efectivo de la caja', tipo: 'check', valor: true });
    const d = await preguntar(nombre === 'Otro' ? 'Otro gasto' : `Gasto: ${nombre}`, campos, 'Anotar gasto');
    if (!d) return;
    if (await intentar(() => POST('/gastos', { concepto: (d.concepto || nombre).trim(), monto: d.monto, de_caja: !!d.de_caja }), 'Gasto anotado')) otra(el, pantallaGastos);
  };
  poner(el, h('h1', {}, 'Gastos del día'),
    h('div', { class: 'tarjeta' }, h('label', { style: 'margin-top:0' }, '¿En qué se gastó? Toca una opción'),
      h('div', { class: 'grid' }, CONCEPTOS.map(([i, t]) => h('button', { class: 'opcion corta', onclick: () => anotar(t) }, h('span', {}, h('span', { style: 'font-size:1.6rem;display:block' }, i), t))))),
    h('div', { class: 'tarjeta azul fila sep' }, h('span', { style: 'font-weight:800' }, 'Total gastado hoy'), h('b', { class: 'grande-num', style: 'color:#ffc400' }, bs(vivos.reduce((a, g) => a + num(g.monto), 0)))),
    vivos.length > 0 && h('div', { class: 'tarjeta' }, vivos.map((g) => h('div', { class: 'linea' }, h('span', {}, g.concepto, h('small', { class: 'suave' }, ` · ${g.registrado_por} ${hora(g.creado_en)}${g.pagado_de_caja ? '' : ' · no salió de caja'}`)), h('b', { class: 'mono' }, bs(g.monto)),
      h('button', { class: 'btn sec chico', onclick: async () => { if (await confirmar('Anular gasto', `¿Anular "${g.concepto}" por ${bs(g.monto)}?`, 'Anular', true) && await intentar(() => DEL(`/gastos/${g.id}`), 'Gasto anulado')) otra(el, pantallaGastos); } }, 'Anular')))));
}

// ------------------------------------------------------------------ MI CAJA (cierre con informe y contador de billetes)
const DENOMINACIONES = [[200, 'Billete 200'], [100, 'Billete 100'], [50, 'Billete 50'], [20, 'Billete 20'], [10, 'Billete 10'], [5, 'Moneda 5'], [2, 'Moneda 2'], [1, 'Moneda 1'], [0.5, 'Moneda 0,50']];
const MOTIVOS_DIF = ['Error al dar el cambio', 'Faltó anotar un gasto', 'Se dio de más a un cliente', 'No sé qué pasó'];

export async function pantallaMiCaja(el) {
  if (!estado.caja) {
    if (estado.asistencia) return poner(el, h('div', { class: 'tarjeta col' }, h('h1', {}, 'Tu caja ya está cerrada'), h('button', { class: 'btn grande bloque', onclick: () => salirDeTurno(el) }, '👋 Marcar mi salida')));
    return tarjetaEmpezar(el, () => otra(el, pantallaMiCaja));
  }
  const inf = await GET('/caja/informe');
  const fila = (t, v, fuerte) => h('div', { class: 'linea' }, h('span', { class: fuerte ? '' : 'suave', style: fuerte ? 'font-weight:900' : '' }, t), h('b', { class: 'mono', style: fuerte ? 'font-size:1.3rem' : '' }, v));
  const cuenta = new Map(); // denominación -> cantidad
  let contadoManual = null;
  let motivo = '';
  const contado = () => (contadoManual !== null ? num(contadoManual) : [...cuenta].reduce((a, [d, n]) => a + d * n, 0));
  const hayConteo = () => contadoManual !== null || [...cuenta.values()].some((n) => n > 0);

  const dibujar = () => {
    const dif = contado() - num(inf.efectivo_esperado);
    const cierra = async () => {
      const cuerpo = {};
      if (inf.es_encargada) cuerpo.efectivo_contado = contado().toFixed(2);
      if (motivo) cuerpo.motivo = motivo;
      const r = await intentar(() => POST('/caja/cerrar', cuerpo));
      if (!r) return;
      await refrescarYo();
      el.replaceChildren(h('div', { class: 'tarjeta col hecho' }, h('div', { class: 'gigante' }, num(r.diferencia) === 0 ? '✅' : '📝'), h('h1', { style: 'margin:0' }, 'Caja cerrada'),
        h('div', { class: `aviso ${num(r.diferencia) === 0 ? 'ok' : 'alerta'}` }, r.mensaje),
        h('button', { class: 'btn grande bloque', onclick: () => salirDeTurno(el) }, '👋 Marcar mi salida'),
        h('button', { class: 'btn sec bloque', onclick: () => { location.hash = '#/vender'; } }, 'Seguir atendiendo más tarde')));
    };
    el.replaceChildren(h('h1', {}, 'Mi caja'),
      h('div', { class: 'tarjeta' },
        h('div', { class: 'suave' }, `${inf.nombre} · abierta desde las ${hora(inf.inicio)} · ${inf.es_encargada ? 'Encargada del dinero' : 'Apoyo en caja'}`),
        fila('Ventas hechas', inf.ventas_cantidad), fila('Cobrado en QR', bs(inf.ventas_qr)),
        inf.es_encargada && [fila('Efectivo con el que empezó', bs(inf.fondo_inicial)), fila('Cobrado en efectivo', bs(inf.ventas_efectivo)), fila('Gastos pagados de caja', '− ' + bs(inf.gastos_caja)), fila('Debería haber en caja', bs(inf.efectivo_esperado), true)]),
      inf.es_encargada
        ? h('div', { class: 'tarjeta col' },
          h('h2', { style: 'margin:0' }, 'Cuenta tu dinero'),
          h('p', { class: 'suave', style: 'margin:0' }, 'Toca + por cada billete o moneda que hay en la caja. El total se suma solo.'),
          h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr))' }, DENOMINACIONES.map(([d, t]) => {
            const n = cuenta.get(d) || 0;
            return h('div', { class: 'item', style: 'margin:0' }, h('div', { class: 'cab' }, h('b', {}, t),
              h('div', { class: 'contador' }, h('button', { onclick: () => { contadoManual = null; cuenta.set(d, Math.max(0, n - 1)); dibujar(); } }, '−'), h('b', {}, n), h('button', { onclick: () => { contadoManual = null; cuenta.set(d, n + 1); dibujar(); } }, '+'))));
          })),
          h('button', { class: 'btn sec', onclick: async () => { const r = await pedirNumero('Total del efectivo que hay', { valor: contadoManual ?? '', atajos: [] }); if (r !== null) { contadoManual = r; dibujar(); } } }, '⌨ Ya conté: escribir el total'),
          h('div', { class: 'total-grande' }, h('span', {}, 'HAY EN CAJA'), h('b', { class: 'mono' }, bs(contado()))),
          hayConteo() && (Math.abs(dif) < 0.005
            ? h('div', { class: 'aviso ok' }, '✓ La caja cuadra perfecto.')
            : [h('div', { class: 'aviso alerta' }, `${dif < 0 ? 'Faltan' : 'Sobran'} ${bs(Math.abs(dif))}. ¿Qué pasó?`),
              h('div', { class: 'grid' }, MOTIVOS_DIF.map((t) => h('button', { class: `opcion corta ${motivo === t ? 'activa' : ''}`, onclick: () => { motivo = t; dibujar(); } }, t)))]),
          h('button', { class: 'btn grande bloque', disabled: !hayConteo() || (Math.abs(dif) >= 0.005 && !motivo), onclick: cierra }, 'Cerrar mi caja'))
        : h('div', { class: 'tarjeta col' }, h('p', { style: 'margin:0' }, 'Tú solo apoyaste en caja: no tienes que contar dinero.'), h('button', { class: 'btn grande bloque', onclick: cierra }, 'Terminar mi caja')));
  };
  dibujar();
}

async function salirDeTurno(el) {
  const r = await intentar(() => POST('/asistencia/mi-salida'));
  if (!r) return;
  aviso(r.mensaje);
  await refrescarYo();
  el.replaceChildren(h('div', { class: 'tarjeta col hecho' }, h('div', { class: 'gigante' }, '👋'), h('h1', { style: 'margin:0' }, r.mensaje), h('button', { class: 'btn grande bloque', onclick: () => document.getElementById('btn-salir')?.click() }, 'Salir del sistema')));
}

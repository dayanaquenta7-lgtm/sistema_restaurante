// Ayudas comunes: pedir datos al servidor, crear elementos sin riesgo, avisos y ventanas.
export const estado = { usuario: null, asistencia: null, caja: null };

/** Crea un elemento: h('button', {class:'btn', onclick: fn}, 'Texto', otroElemento). Los textos NUNCA se interpretan como HTML. */
export function h(etiqueta, attrs, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const poner = (x) => {
    if (Array.isArray(x)) x.forEach(poner);
    else if (x !== null && x !== undefined && x !== false) el.append(x instanceof Node ? x : document.createTextNode(String(x)));
  };
  hijos.forEach(poner);
  return el;
}

/** Agrega varios elementos (o listas de elementos) a una pantalla, ignorando los vacíos. */
export const poner = (el, ...xs) => el.append(...xs.flat(Infinity).filter((x) => x !== false && x !== null && x !== undefined));

export class ErrorApi extends Error {
  constructor(estadoHttp, datos) { super(datos?.error || 'Error de conexión'); this.estado = estadoHttp; this.datos = datos || {}; }
}

export async function api(metodo, ruta, cuerpo) {
  let r;
  try {
    r = await fetch('/api' + ruta, { method: metodo, headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined, credentials: 'same-origin' });
  } catch {
    throw new ErrorApi(0, { error: 'No se puede hablar con el sistema. Revisa que el programa esté encendido en la computadora del local.', codigo: 'SIN_RED' });
  }
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    if (r.status === 401 && ruta !== '/auth/pin' && ruta !== '/auth/dueno') document.dispatchEvent(new CustomEvent('sesion-vencida'));
    const msg = datos?.detalles?.length ? { ...datos, error: `${datos.error}: ${datos.detalles.map((d) => d.mensaje).join('; ')}` } : datos;
    throw new ErrorApi(r.status, msg);
  }
  return datos;
}
export const GET = (r) => api('GET', r);
export const POST = (r, c = {}) => api('POST', r, c);
export const PATCH = (r, c) => api('PATCH', r, c);
export const PUT = (r, c) => api('PUT', r, c);
export const DEL = (r) => api('DELETE', r);

// ---- formatos
export const num = (v) => Number(v || 0);
export function bs(v) {
  const n = num(v);
  const [e, d] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}Bs ${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${d === '00' ? '' : ',' + d}`;
}
export const hora = (s) => (s ? String(s).slice(11, 16) : '—');
export const fechaCorta = (s) => {
  if (!s) return '—';
  const [a, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};
export const hoyISO = () => {
  const d = new Date(Date.now() - 4 * 3600 * 1000); // hora de Bolivia
  return d.toISOString().slice(0, 10);
};
export const sumaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const MOTIVOS = { consumo_personal: 'Lo comió el personal', quemado_o_caido: 'Se quemó o se cayó', regalo: 'Regalo', otro: 'Otro motivo' };

// ---- avisos
let temporizador;
export function aviso(texto, tipo = 'ok') {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast ${tipo}`, role: 'status' }, texto);
  document.body.append(t);
  clearTimeout(temporizador);
  temporizador = setTimeout(() => t.remove(), tipo === 'ok' ? 2600 : 5000);
}
export const falla = (e) => aviso(e?.message || 'Algo salió mal', 'mal');

/** Ejecuta una acción mostrando errores en claro. Devuelve undefined si falla. */
export async function intentar(fn, exito) {
  try {
    const r = await fn();
    if (exito) aviso(exito);
    return r === undefined ? true : r;
  } catch (e) {
    falla(e);
    return undefined;
  }
}

// ---- ventanas
export function modal(titulo, contenido, { cerrable = true } = {}) {
  const cerrar = () => fondo.remove();
  const fondo = h('div', { class: 'sombra-fondo', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (cerrable && e.target === fondo) cerrar(); } },
    h('div', { class: 'modal' },
      h('div', { class: 'fila sep' }, h('h1', {}, titulo), cerrable && h('button', { class: 'btn sec chico', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕')),
      contenido));
  document.body.append(fondo);
  return { cerrar, el: fondo };
}

export function confirmar(titulo, texto, textoBoton = 'Sí, continuar', peligro = false) {
  return new Promise((resolver) => {
    const m = modal(titulo, h('div', { class: 'col' },
      h('p', {}, texto),
      h('div', { class: 'fila' },
        h('button', { class: `btn ${peligro ? 'mal' : ''}`, onclick: () => { m.cerrar(); resolver(true); } }, textoBoton),
        h('button', { class: 'btn sec', onclick: () => { m.cerrar(); resolver(false); } }, 'Cancelar'))), { cerrable: false });
  });
}

/** Teclado numérico en pantalla (para no escribir con el teclado del aparato).
 *  Devuelve el número como texto ("12.5") o null si se cancela.
 *  opciones: { valor, decimal=true, unidad='Bs', atajos:[{texto, valor}], intro, oculto, largo } */
export function pedirNumero(titulo, { valor = '', decimal = true, unidad = 'Bs', atajos = [], intro, oculto = false, largo = 8, listo = 'Listo' } = {}) {
  return new Promise((resolver) => {
    let v = String(valor ?? '').replace(',', '.');
    const pantalla = h('div', { class: 'pantallita', 'aria-live': 'polite' });
    const ver = () => {
      const texto = v === '' ? '0' : oculto ? '•'.repeat(v.length) : v.replace('.', ',');
      pantalla.replaceChildren(unidad ? h('small', {}, unidad) : '', texto);
      pantalla.style.opacity = v === '' ? '.55' : '1';
    };
    const tecla = (t) => {
      if (t === '⌫') v = v.slice(0, -1);
      else if (t === '.') { if (decimal && !v.includes('.')) v = (v === '' ? '0' : v) + '.'; }
      else if (v.length < largo && !(v.includes('.') && v.split('.')[1].length >= 2) && !(v === '0' && !decimal)) v = (v === '0' ? '' : v) + t;
      ver();
    };
    const cerrar = (r) => { m.cerrar(); resolver(r); };
    const aceptar = () => { if (v === '' || v === '.') return aviso('Toca los números', 'mal'); cerrar(v.endsWith('.') ? v.slice(0, -1) : v); };
    const cuerpo = h('div', { class: 'col' },
      intro && h('p', { class: 'suave', style: 'margin:0' }, intro),
      pantalla,
      atajos.length > 0 && h('div', { class: 'atajos' }, atajos.map((a) => h('button', { type: 'button', class: 'opcion', onclick: () => { v = String(a.valor); ver(); if (a.directo) aceptar(); } }, a.texto ?? a.valor))),
      h('div', { class: 'teclado' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? ',' : 'C', '0', '⌫'].map((t) => h('button', { type: 'button', class: t === '⌫' || t === 'C' ? 'rojo' : '', 'aria-label': t === '⌫' ? 'Borrar' : t, onclick: () => (t === 'C' ? ((v = ''), ver()) : tecla(t === ',' ? '.' : t)) }, t))),
      h('div', { class: 'grid dos' }, h('button', { type: 'button', class: 'btn sec', onclick: () => cerrar(null) }, 'Cancelar'), h('button', { type: 'button', class: 'btn am', onclick: aceptar }, `✓ ${listo}`)));
    const m = modal(titulo, cuerpo, { cerrable: false });
    ver();
  });
}

/** Elegir una opción tocando un botón. opciones: [{valor, texto, detalle}] → devuelve el valor o null. */
export function elegirUno(titulo, opciones, { intro, cancelar = 'Cancelar' } = {}) {
  return new Promise((resolver) => {
    const cerrar = (r) => { m.cerrar(); resolver(r); };
    const m = modal(titulo, h('div', { class: 'col' },
      intro && h('p', { class: 'suave', style: 'margin:0' }, intro),
      opciones.map((o) => h('button', { type: 'button', class: 'opcion', disabled: o.desactivado, onclick: () => cerrar(o.valor) }, o.texto, o.detalle && h('small', {}, o.detalle))),
      cancelar && h('button', { type: 'button', class: 'btn sec', onclick: () => cerrar(null) }, cancelar)), { cerrable: false });
  });
}

/** Pide uno o varios datos con botones: los números con teclado en pantalla, las opciones como fichas.
 *  Solo los nombres y notas se escriben. campos: [{nombre, etiqueta, tipo, valor, opciones, ayuda, atajos}] */
export function preguntar(titulo, campos, textoBoton = 'Guardar', intro) {
  return new Promise((resolver) => {
    const vals = {};
    const refs = {};
    for (const c of campos) vals[c.nombre] = c.tipo === 'check' ? !!c.valor : c.tipo === 'select' ? (c.valor ?? c.opciones[0]?.valor ?? '') : (c.valor ?? '');
    const dibujarCampo = (c) => {
      const caja = refs[c.nombre];
      let cont;
      if (c.tipo === 'dinero' || c.tipo === 'entero' || c.tipo === 'pin') {
        const v = vals[c.nombre];
        const mostrado = v === '' ? '' : c.tipo === 'pin' ? '•'.repeat(String(v).length) : c.tipo === 'dinero' ? `Bs ${String(v).replace('.', ',')}` : String(v);
        cont = h('button', { type: 'button', class: `valor-boton ${v === '' ? 'vacio' : ''}`, onclick: async () => {
          const r = await pedirNumero(c.etiqueta, { valor: v, decimal: c.tipo === 'dinero', unidad: c.tipo === 'dinero' ? 'Bs' : '', atajos: c.atajos || [], oculto: c.tipo === 'pin', largo: c.tipo === 'pin' ? 6 : 8, intro: c.ayuda });
          if (r !== null) { vals[c.nombre] = r; dibujarCampo(c); }
        } }, h('span', {}, mostrado || 'Toca para poner'), h('span', { class: 'lapiz' }, '⌨'));
      } else if (c.tipo === 'select') {
        cont = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(130px,1fr))' }, c.opciones.map((o) => h('button', { type: 'button', class: `opcion corta ${String(vals[c.nombre]) === String(o.valor) ? 'activa' : ''}`, onclick: () => { vals[c.nombre] = o.valor; dibujarCampo(c); } }, o.texto)));
      } else if (c.tipo === 'check') {
        cont = h('button', { type: 'button', class: `opcion corta ${vals[c.nombre] ? 'activa' : ''}`, onclick: () => { vals[c.nombre] = !vals[c.nombre]; dibujarCampo(c); } }, vals[c.nombre] ? '✓ Sí' : 'No');
      } else if (c.tipo === 'texto-largo') {
        cont = h('textarea', { rows: 2, oninput: (e) => { vals[c.nombre] = e.target.value; } }, vals[c.nombre]);
      } else {
        cont = h('input', { type: c.tipo || 'text', value: vals[c.nombre], placeholder: c.ayuda || '', autocomplete: 'off', oninput: (e) => { vals[c.nombre] = e.target.value; } });
      }
      caja.replaceChildren(h('label', {}, c.etiqueta), cont);
    };
    const form = h('form', { class: 'col', onsubmit: (e) => {
      e.preventDefault();
      for (const c of campos) if (c.requerido !== false && c.tipo !== 'check' && String(vals[c.nombre]).trim() === '') return aviso(`Falta: ${c.etiqueta}`, 'mal');
      const out = {};
      for (const c of campos) out[c.nombre] = vals[c.nombre];
      m.cerrar(); resolver(out);
    } },
      intro && h('p', { class: 'suave', style: 'margin:0' }, intro),
      campos.map((c) => { refs[c.nombre] = h('div', {}); dibujarCampo(c); return refs[c.nombre]; }),
      h('div', { class: 'grid dos' },
        h('button', { class: 'btn sec', type: 'button', onclick: () => { m.cerrar(); resolver(null); } }, 'Cancelar'),
        h('button', { class: 'btn', type: 'submit' }, textoBoton)));
    const m = modal(titulo, form, { cerrable: false });
  });
}

/** Convierte lo que se escribe ("1.500,50" o "12") en un monto con punto decimal. */
export function aMonto(texto) {
  let t = String(texto).trim().replace(/\s|Bs/gi, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) throw new Error('Escribe un monto válido, por ejemplo 150 o 12,50');
  return t;
}
export function aEntero(texto, etiqueta = 'cantidad') {
  const t = String(texto).trim();
  if (!/^\d{1,6}$/.test(t)) throw new Error(`Escribe un número entero en ${etiqueta}`);
  return Number(t);
}

export function imprimir(textos) {
  document.getElementById('zona-impresion')?.remove();
  const zona = h('div', { id: 'zona-impresion' }, textos.map((t) => h('pre', { class: 'ticket salto' }, t)));
  document.body.append(zona);
  window.print();
  setTimeout(() => zona.remove(), 500);
}

// ---- tiempo real: cuando otro dispositivo cambia algo, esta pantalla se actualiza
let fuente;
export function escucharCambios(fn) {
  fuente?.close();
  let espera;
  fuente = new EventSource('/api/eventos');
  fuente.onmessage = () => { clearTimeout(espera); espera = setTimeout(fn, 250); };
}
export function dejarDeEscuchar() { fuente?.close(); fuente = null; }

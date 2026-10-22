// Tablet fija del local: cada persona marca su llegada y su salida solo con su PIN.
import { h } from './nucleo.js';

const raiz = document.getElementById('kiosko');
// Si el sistema usa TABLET_KEY, se guarda una sola vez abriendo /asistencia.html?clave=XXXX en la tablet
const params = new URLSearchParams(location.search);
try { if (params.get('clave')) { localStorage.setItem('tablet-clave', params.get('clave')); history.replaceState(null, '', location.pathname); } } catch { /* sin almacenamiento */ }
const clave = (() => { try { return localStorage.getItem('tablet-clave') || ''; } catch { return ''; } })();

let pin = '';
let ocupado = false;
let temporizador;
const reloj = h('div', { class: 'reloj mono' });
const puntos = h('div', { class: 'puntos' });
const mensaje = h('div', { 'aria-live': 'assertive' });
const turnosCaja = h('div', { class: 'grid', style: 'max-width:520px;margin:10px auto' });

function tic() { reloj.textContent = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' }); }
setInterval(tic, 10000); tic();
const dibujarPuntos = () => puntos.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'lleno' : '' })));

function decir(texto, tipo) {
  clearTimeout(temporizador);
  mensaje.replaceChildren(texto ? h('div', { class: `mensaje-grande aviso ${tipo}` }, texto) : '');
  if (texto) temporizador = setTimeout(() => { mensaje.replaceChildren(); turnosCaja.replaceChildren(); }, tipo === 'ok' ? 5000 : 8000);
}

async function marcar(turno_id) {
  if (ocupado) return;
  ocupado = true;
  const cuerpo = { pin }; if (turno_id) cuerpo.turno_id = turno_id;
  try {
    const r = await fetch('/api/asistencia/marcar', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-tablet-key': clave } : {}) }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { decir(d.mensaje, 'ok'); turnosCaja.replaceChildren(); pin = ''; }
    else if (d.codigo === 'ELEGIR_TURNO') {
      decir(d.error, 'alerta');
      turnosCaja.replaceChildren(...d.turnos.map((t) => h('button', { class: 'opcion', onclick: () => marcar(t.id) }, t.nombre, h('small', {}, `${t.hora_inicio} a ${t.hora_fin}`))));
      ocupado = false; return;
    } else { decir(d.detalles?.length ? 'El PIN son de 4 a 6 números' : d.error || 'No se pudo marcar', 'mal'); pin = ''; turnosCaja.replaceChildren(); }
  } catch { decir('No hay conexión con el sistema. Avisa al dueño.', 'mal'); pin = ''; }
  ocupado = false; dibujarPuntos();
}

const teclado = h('div', { class: 'teclado' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((t) => h('button', { type: 'button', onclick: () => {
  if (t === '✓') { if (pin.length >= 4) marcar(); else decir('El PIN tiene de 4 a 6 números', 'mal'); return; }
  decir(''); turnosCaja.replaceChildren();
  if (t === '⌫') pin = pin.slice(0, -1); else if (pin.length < 6) pin += t;
  dibujarPuntos();
} }, t)));

dibujarPuntos();
raiz.append(h('h1', {}, 'Marca tu asistencia'), reloj, h('p', { class: 'suave' }, 'Escribe tu PIN y toca ✓. La primera vez del día es tu llegada; la siguiente, tu salida.'), puntos, teclado, mensaje, turnosCaja,
  h('a', { href: '/', class: 'suave', style: 'margin-top:20px' }, 'Ir al sistema'));

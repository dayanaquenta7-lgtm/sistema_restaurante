// Arranque de la aplicación: inicio de sesión, menú inferior y cambio de pantallas.
import { h, estado, GET, POST, aviso, falla, escucharCambios, dejarDeEscuchar, ErrorApi } from './nucleo.js';
import * as caja from './caja.js';
import * as dueno from './dueno.js';

const raiz = document.getElementById('app');
let negocio = 'Super Pollitos El Rey';
fetch('/api/salud').then((r) => r.json()).then((d) => { if (d?.negocio) { negocio = d.negocio; document.title = negocio; } }).catch(() => {});
let cargando = 0;

const refrescarYo = async () => {
  try { const me = await GET('/auth/me'); estado.usuario = me.usuario; estado.asistencia = me.asistencia_abierta; estado.caja = me.caja_abierta; }
  catch { estado.usuario = null; }
};
const textoCaja = () => (estado.caja ? (estado.caja.es_encargada ? 'Encargada de caja' : 'Apoyo en caja') : estado.usuario?.rol === 'dueno' ? 'Dueño' : 'Turno sin empezar');
function actualizarCabecera() { const q = document.getElementById('quien'); if (q && estado.usuario) q.replaceChildren(h('b', {}, estado.usuario.nombre), h('br'), textoCaja()); }
caja.enlazar(async () => { await refrescarYo(); actualizarCabecera(); });

const PANTALLAS = {
  inicio: { t: 'Inicio', i: '🏠', f: dueno.pantallaInicio, roles: ['dueno'] },
  vender: { t: 'Vender', i: '🧾', f: caja.pantallaVender, roles: ['atencion', 'dueno'], vivo: true },
  pedidos: { t: 'Pedidos', i: '📞', f: caja.pantallaPedidos, roles: ['atencion', 'dueno'] },
  ventas: { t: 'Ventas', i: '📋', f: caja.pantallaVentas, roles: ['atencion', 'dueno'] },
  perdidas: { t: 'Pérdidas', i: '🍗', f: caja.pantallaPerdidas, roles: ['atencion', 'dueno'] },
  gastos: { t: 'Gastos', i: '🛒', f: caja.pantallaGastos, roles: ['atencion', 'dueno'] },
  micaja: { t: 'Mi caja', i: '💰', f: caja.pantallaMiCaja, roles: ['atencion', 'dueno'] },
  pollos: { t: 'Pollos', i: '🐔', f: dueno.pantallaPollos, roles: ['dueno'] },
  personal: { t: 'Personal', i: '👥', f: dueno.pantallaPersonal, roles: ['dueno'] },
  sueldos: { t: 'Sueldos', i: '💵', f: dueno.pantallaSueldos, roles: ['dueno'] },
  dia: { t: 'Día', i: '📒', f: dueno.pantallaDia, roles: ['dueno'] },
  mas: { t: 'Más', i: '⚙️', f: (el) => dueno.pantallaMas(el, { salir }), roles: ['dueno'] },
  precios: { t: 'Precios', i: '🏷️', f: dueno.pantallaPrecios, roles: ['dueno'], padre: 'mas' },
  reglas: { t: 'Reglas', i: '📏', f: dueno.pantallaReglas, roles: ['dueno'], padre: 'mas' },
  bitacora: { t: 'Bitácora', i: '🔍', f: dueno.pantallaBitacora, roles: ['dueno'], padre: 'mas' },
};
const NAV = { dueno: ['inicio', 'vender', 'pollos', 'personal', 'sueldos', 'dia', 'mas'], atencion: ['vender', 'pedidos', 'ventas', 'perdidas', 'gastos', 'micaja'] };

async function salir() {
  try { await POST('/auth/salir'); } catch { /* da igual */ }
  dejarDeEscuchar(); estado.usuario = null; location.hash = '#/'; dibujar();
}

// ---------------------------------------------------------------- Inicio de sesión
function pantallaLogin() {
  dejarDeEscuchar();
  let pin = '';
  let modoDueno = false;
  const puntos = h('div', { class: 'puntos', 'aria-live': 'polite' });
  const dibujarPuntos = () => puntos.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'lleno' : '' })));
  const entrar = async (ruta, cuerpo) => {
    try { await POST(ruta, cuerpo); await refrescarYo(); location.hash = estado.usuario.rol === 'dueno' ? '#/inicio' : '#/vender'; dibujar(); }
    catch (e) { falla(e); pin = ''; dibujarPuntos(); }
  };
  const tecla = (t) => {
    if (t === '⌫') pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += t;
    dibujarPuntos();
    if (pin.length === 6) entrar('/auth/pin', { pin });
  };
  const teclado = h('div', { class: 'teclado' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((t) => h('button', { type: 'button', class: t === '⌫' ? 'rojo' : t === '✓' ? 'ok' : '', 'aria-label': t === '⌫' ? 'Borrar' : t === '✓' ? 'Entrar' : t, onclick: () => (t === '✓' ? (pin.length >= 4 ? entrar('/auth/pin', { pin }) : aviso('El PIN tiene de 4 a 6 números', 'mal')) : tecla(t)) }, t)));
  const formDueno = h('form', { class: 'col oculto', style: 'width:100%;max-width:380px;margin:12px auto;text-align:left', onsubmit: (e) => { e.preventDefault(); entrar('/auth/dueno', { nombre: e.currentTarget.nombre.value.trim(), clave: e.currentTarget.clave.value }); } },
    h('div', {}, h('label', {}, 'Nombre'), h('input', { name: 'nombre', autocomplete: 'username', required: true })), h('div', {}, h('label', {}, 'Contraseña'), h('input', { name: 'clave', type: 'password', autocomplete: 'current-password', required: true })), h('button', { class: 'btn am grande', type: 'submit' }, 'Entrar'));
  const bloquePin = h('div', {}, h('p', { class: 'suave', style: 'margin:0' }, 'Toca tu PIN'), puntos, teclado);
  dibujarPuntos();
  raiz.replaceChildren(h('div', { class: 'entrada' },
    h('div', { class: 'insignia' }, '🍗'), h('h1', {}, negocio), h('div', { class: 'lema' }, 'El sabor único del rey'),
    bloquePin, formDueno,
    h('div', { class: 'fila', style: 'justify-content:center;margin-top:10px' },
      h('button', { class: 'btn sec chico', onclick: () => { modoDueno = !modoDueno; formDueno.classList.toggle('oculto', !modoDueno); bloquePin.classList.toggle('oculto', modoDueno); } }, modoDueno ? 'Volver al PIN' : 'Soy el dueño'),
      h('a', { class: 'btn sec chico', href: '/asistencia.html', style: 'text-decoration:none;display:inline-flex;align-items:center' }, 'Tablet de asistencia'))));
}

// ---------------------------------------------------------------- Estructura con menú
async function dibujar() {
  if (!estado.usuario) await refrescarYo();
  if (!estado.usuario) return pantallaLogin();
  const clave = (location.hash.replace(/^#\//, '') || '').split('?')[0];
  const rol = estado.usuario.rol;
  const porDefecto = rol === 'dueno' ? 'inicio' : 'vender';
  const pantalla = PANTALLAS[clave];
  if (!pantalla || !pantalla.roles.includes(rol)) { location.hash = '#/' + porDefecto; return; }

  const activa = pantalla.padre || clave;
  const contenido = h('div', { class: 'contenedor', id: 'contenido' });
  raiz.replaceChildren(
    h('header', { class: 'barra' }, h('span', { class: 'marca' }, h('span', { class: 'logo' }, '🍗'), h('span', {}, negocio, h('small', {}, 'El sabor único del rey'))),
      h('span', { class: 'quien', id: 'quien' }, h('b', {}, estado.usuario.nombre), h('br'), textoCaja()),
      h('button', { class: 'btn sec chico', id: 'btn-salir', onclick: salir }, 'Salir')),
    contenido,
    h('nav', { class: 'nav' }, NAV[rol].map((k) => h('a', { href: '#/' + k, class: k === activa ? 'activo' : '' }, h('span', { class: 'ico' }, PANTALLAS[k].i), PANTALLAS[k].t))));
  if (pantalla.padre) contenido.append(h('a', { href: '#/' + pantalla.padre, class: 'btn sec chico', style: 'text-decoration:none;display:inline-block;margin-bottom:8px' }, '‹ Volver'));
  await cargarPantalla(contenido, pantalla);
  escucharCambios(() => alCambiar(contenido, pantalla));
}

async function cargarPantalla(contenido, pantalla) {
  const mio = ++cargando;
  const lugar = h('div', {});
  contenido.append(lugar);
  try { await pantalla.f(lugar); }
  catch (e) { if (mio === cargando && e.estado !== 401) { lugar.replaceChildren(h('div', { class: 'aviso mal' }, e.message || 'No se pudo cargar esta pantalla'), h('button', { class: 'btn', onclick: () => dibujar() }, 'Reintentar')); } }
}

/** Otro dispositivo cambió algo: se actualiza esta pantalla, sin molestar a quien está escribiendo. */
async function alCambiar(contenido, pantalla) {
  if (document.querySelector('.sombra-fondo') || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
  const lugar = contenido.lastElementChild;
  const nuevo = h('div', {});
  const mio = ++cargando;
  try { await pantalla.f(nuevo); if (mio === cargando && lugar?.isConnected) lugar.replaceWith(nuevo); } catch { /* se queda como está */ }
  await refrescarYo(); actualizarCabecera();
}

document.addEventListener('sesion-vencida', () => { if (estado.usuario) { estado.usuario = null; aviso('Tu sesión terminó. Entra de nuevo.', 'mal'); pantallaLogin(); } });
window.addEventListener('hashchange', dibujar);
dibujar();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

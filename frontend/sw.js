// Service worker: guarda las pantallas para que abran rápido. Los DATOS (/api) nunca se guardan:
// sin conexión no se puede vender, para no perder el control del dinero y del stock.
const VERSION = 'v2';
const ARCHIVOS = ['/', '/asistencia.html', '/css/app.css', '/js/main.js', '/js/nucleo.js', '/js/caja.js', '/js/dueno.js', '/js/asistencia.js', '/img/icono.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Primero la red (así siempre ves la última versión); si no hay red, lo guardado.
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); } return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});

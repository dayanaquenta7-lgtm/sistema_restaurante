// PDF 06 — Pruebas del CRUD de gaseosas (casos correctos y casos negativos A–E).
// Se ejecuta con:  npm test   (usa la base de pruebas "broasteria_test", nunca la real)
process.env.DB_NAME = process.env.DB_NAME_PRUEBA || `${process.env.DB_NAME || 'broasteria'}_test`;
process.env.LIMITE_INTENTOS = '1000';
process.env.PIN_SECRET = process.env.PIN_SECRET || 'frase-secreta-solo-para-pruebas-locales';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../src/app');
const { pool } = require('../src/db');
const { migrar } = require('../src/migrar');
const { hmacPin, hashClave } = require('../src/util/seguridad');

let servidor;
let base;

function cliente() {
  let cookie = '';
  const pedir = async (metodo, ruta, cuerpo) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no es JSON */ }
    return { estado: r.status, json, cabeceras: r.headers };
  };
  return { get: (r) => pedir('GET', r), post: (r, c) => pedir('POST', r, c ?? {}), put: (r, c) => pedir('PUT', r, c), patch: (r, c) => pedir('PATCH', r, c), del: (r) => pedir('DELETE', r) };
}

const ok = (r, estado = 200) => assert.equal(r.estado, estado, JSON.stringify(r.json));

test.before(async () => {
  await migrar();
  await pool.query("INSERT INTO empleados (nombre, cargo, rol, pin_hmac, clave_hash) VALUES ('Don Pedro', 'Dueño', 'dueno', ?, ?)", [hmacPin('9999'), await hashClave('clave-del-dueno')]);
  await pool.query("INSERT INTO empleados (nombre, cargo, rol, pin_hmac) VALUES ('Sandra', 'Cajera', 'atencion', ?)", [hmacPin('1111')]);
  servidor = crearApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  await new Promise((r) => servidor.close(r));
  await pool.end();
});

const dueno = cliente();
const anonimo = cliente();
const cajera = cliente();
let idPrueba;

test('salud: el servidor responde y confirma la conexión a la base', async () => {
  const r = await anonimo.get('/api/salud');
  ok(r);
  assert.equal(r.json.base_de_datos, 'conectada');
  // Helmet: cabeceras de seguridad presentes y sin delatar Express
  assert.ok(r.cabeceras.get('x-content-type-options'));
  assert.ok(r.cabeceras.get('content-security-policy'));
  assert.equal(r.cabeceras.get('x-powered-by'), null);
});

test('seguridad: sin sesión 401 y con rol de caja 403', async () => {
  assert.equal((await anonimo.get('/api/gaseosas')).estado, 401);
  ok(await cajera.post('/api/auth/pin', { pin: '1111' }));
  assert.equal((await cajera.post('/api/gaseosas', { marca: 'Coca-Cola', tamano: '2 L', precio: 12 })).estado, 403);
});

test('CREATE: crear gaseosa válida → 201', async () => {
  ok(await dueno.post('/api/auth/dueno', { nombre: 'Don Pedro', clave: 'clave-del-dueno' }));
  const r = await dueno.post('/api/gaseosas', { marca: 'Gaseosa de prueba', tamano: '500 ml', precio: 5.5 });
  ok(r, 201);
  assert.equal(r.json.gaseosa.marca, 'Gaseosa de prueba');
  assert.equal(r.json.gaseosa.precio, '5.50');
  assert.equal(r.json.gaseosa.stock, 0);
  idPrueba = r.json.id;
  assert.equal(idPrueba, r.json.gaseosa.id);
});

test('READ: listar → 200 y consultar una existente → 200', async () => {
  const lista = await dueno.get('/api/gaseosas');
  ok(lista);
  assert.ok(lista.json.gaseosas.some((g) => g.id === idPrueba));
  const una = await dueno.get(`/api/gaseosas/${idPrueba}`);
  ok(una);
  assert.equal(una.json.gaseosa.tamano, '500 ml');
});

test('UPDATE: actualizar existente → 200 y el cambio queda en la base', async () => {
  const r = await dueno.put(`/api/gaseosas/${idPrueba}`, { marca: 'Gaseosa actualizada', tamano: '600 ml', precio: 7 });
  ok(r);
  assert.equal(r.json.gaseosa.precio, '7.00');
  // No basta el mensaje de éxito: se vuelve a consultar
  const otra = await dueno.get(`/api/gaseosas/${idPrueba}`);
  assert.equal(otra.json.gaseosa.marca, 'Gaseosa actualizada');
  assert.equal(otra.json.gaseosa.tamano, '600 ml');
  // Y directamente en MySQL (equivale a revisar con Workbench / pgAdmin)
  const [[fila]] = await pool.query('SELECT marca, precio FROM gaseosas WHERE id = ?', [idPrueba]);
  assert.deepEqual({ ...fila }, { marca: 'Gaseosa actualizada', precio: '7.00' });
  const [[bit]] = await pool.query("SELECT COUNT(*) AS n FROM bitacora WHERE entidad = 'gaseosas' AND entidad_id = ? AND accion = 'editar'", [String(idPrueba)]);
  assert.ok(bit.n >= 1, 'el cambio queda en la bitácora');
});

test('Caso A: precio negativo → 400', async () => {
  const r = await dueno.post('/api/gaseosas', { marca: 'Producto', tamano: '1 L', precio: -10 });
  ok(r, 400);
  assert.equal(r.json.codigo, 'DATOS_INVALIDOS');
  ok(await dueno.post('/api/gaseosas', { marca: 'Producto', tamano: '1 L', precio: 0 }), 400);
});

test('Caso B: nombre (marca) demasiado corto → 400', async () => {
  ok(await dueno.post('/api/gaseosas', { marca: 'A', tamano: '1 L', precio: 10 }), 400);
  ok(await dueno.post('/api/gaseosas', { tamano: '1 L', precio: 10 }), 400);
});

test('Caso C: identificador inválido → 400', async () => {
  for (const malo of ['abc', '-1', '0', '1.5']) {
    const r = await dueno.get(`/api/gaseosas/${malo}`);
    ok(r, 400);
    assert.equal(r.json.codigo, 'ID_INVALIDO');
  }
  ok(await dueno.put('/api/gaseosas/abc', { marca: 'Coca', tamano: '1 L', precio: 1 }), 400);
  ok(await dueno.del('/api/gaseosas/abc'), 400);
});

test('Caso D: producto inexistente → 404', async () => {
  ok(await dueno.get('/api/gaseosas/999999'), 404);
  ok(await dueno.put('/api/gaseosas/999999', { marca: 'Coca', tamano: '1 L', precio: 1 }), 404);
  ok(await dueno.del('/api/gaseosas/999999'), 404);
});

test('Caso E: actualización incorrecta → 400 y NO cambia el registro', async () => {
  ok(await dueno.put(`/api/gaseosas/${idPrueba}`, { marca: 'X', tamano: '', precio: -3 }), 400);
  const r = await dueno.get(`/api/gaseosas/${idPrueba}`);
  assert.equal(r.json.gaseosa.marca, 'Gaseosa actualizada');
  assert.equal(r.json.gaseosa.precio, '7.00');
});

test('JSON mal formado → 400 y errores sin detalles internos', async () => {
  const r = await fetch(`${base}/api/salud`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo' });
  assert.equal(r.status, 400);
  const texto = await r.text();
  assert.ok(!/password|DB_PASSWORD|SELECT|stack/i.test(texto));
});

test('restricción UNIQUE: misma marca y tamaño → 409', async () => {
  ok(await dueno.post('/api/gaseosas', { marca: 'Fanta', tamano: '2 L', precio: 12 }), 201);
  ok(await dueno.post('/api/gaseosas', { marca: 'Fanta', tamano: '2 L', precio: 12 }), 409);
});

test('DELETE con historial → 409 (se pide desactivar, no se pierde la historia)', async () => {
  const r = await dueno.post('/api/gaseosas', { marca: 'Sprite', tamano: '1 L', precio: 8 });
  ok(r, 201);
  ok(await dueno.post('/api/gaseosas/ingreso', { items: [{ gaseosa_id: r.json.id, cantidad: 6 }] }), 201);
  const d = await dueno.del(`/api/gaseosas/${r.json.id}`);
  ok(d, 409);
  assert.equal(d.json.codigo, 'EN_USO');
  ok(await dueno.patch(`/api/gaseosas/${r.json.id}`, { activo: false }));
  ok(await dueno.get(`/api/gaseosas/${r.json.id}`));
});

test('DELETE: eliminar existente → 200 y luego consultar → 404', async () => {
  const r = await dueno.del(`/api/gaseosas/${idPrueba}`);
  ok(r);
  assert.equal(r.json.gaseosa.id, idPrueba);
  ok(await dueno.get(`/api/gaseosas/${idPrueba}`), 404);
  const [[fila]] = await pool.query('SELECT COUNT(*) AS n FROM gaseosas WHERE id = ?', [idPrueba]);
  assert.equal(fila.n, 0);
  const [[bit]] = await pool.query("SELECT COUNT(*) AS n FROM bitacora WHERE entidad = 'gaseosas' AND entidad_id = ? AND accion = 'eliminar'", [String(idPrueba)]);
  assert.equal(bit.n, 1);
});

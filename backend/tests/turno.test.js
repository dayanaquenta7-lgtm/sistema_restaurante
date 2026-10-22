// Prueba del flujo "Empezar mi turno": la llegada se marca sola al abrir la caja y la salida desde la pantalla.
// Se ejecuta con:  npm test
process.env.DB_NAME = process.env.DB_NAME_PRUEBA || `${process.env.DB_NAME || 'broasteria'}_test`;
process.env.LIMITE_INTENTOS = '1000';
process.env.ESPERA_SALIDA_SEG = '0';
process.env.PIN_SECRET = process.env.PIN_SECRET || 'frase-secreta-solo-para-pruebas-locales';
delete process.env.TABLET_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../src/app');
const { pool } = require('../src/db');
const { hmacPin, hashClave } = require('../src/util/seguridad');

let servidor;
let base;

/** Un "dispositivo": guarda su propia cookie de sesión. */
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
    return { estado: r.status, json };
  };
  return { get: (r) => pedir('GET', r), post: (r, c) => pedir('POST', r, c ?? {}), patch: (r, c) => pedir('PATCH', r, c), put: (r, c) => pedir('PUT', r, c), del: (r) => pedir('DELETE', r) };
}

const ok = (r, estado = 200) => assert.equal(r.estado, estado, JSON.stringify(r.json));
const dinero = (v) => Number(v).toFixed(2);

test.before(async () => {
  await pool.query("INSERT INTO empleados (nombre, cargo, rol, pin_hmac, clave_hash) VALUES ('Don Pedro', 'Dueño', 'dueno', ?, ?)", [hmacPin('9999'), await hashClave('clave-del-dueno')]);
  servidor = crearApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  await new Promise((r) => servidor.close(r));
  await pool.end();
});

const dueno = cliente();
const luz = cliente();

test('el dueño puede atender sin marcar asistencia', async () => {
  ok(await dueno.post('/api/auth/dueno', { nombre: 'Don Pedro', clave: 'clave-del-dueno' }));
  const est = await dueno.get('/api/caja/estado');
  ok(est); assert.equal(est.json.elegir_turno, null);
  ok(await dueno.post('/api/caja/abrir', { fondo_recibido: 100 }), 201);
  ok(await dueno.post('/api/caja/cerrar', { efectivo_contado: 100 }));
});

test('empezar turno: marca la llegada y abre la caja en un solo paso', async () => {
  ok(await dueno.post('/api/empleados', { nombre: 'Luz', rol: 'atencion', pin: '4444', tipo_pago: 'diario', monto_pago: 100 }), 201);
  ok(await luz.post('/api/auth/pin', { pin: '4444' }));

  let r = await luz.get('/api/caja/estado');
  ok(r); assert.equal(r.json.ya_marco_llegada, false); assert.equal(r.json.elegir_turno.length, 3);

  r = await luz.post('/api/caja/abrir', { fondo_recibido: 50 });
  assert.equal(r.estado, 409); assert.equal(r.json.codigo, 'ELEGIR_TURNO'); assert.equal(r.json.turnos.length, 3);

  const turnoId = r.json.turnos[0].id;
  r = await luz.post('/api/caja/abrir', { fondo_recibido: 50, turno_id: turnoId });
  ok(r, 201); assert.equal(r.json.es_encargada, true); assert.ok(r.json.llegada.hora);

  r = await luz.get('/api/caja/estado');
  assert.equal(r.json.ya_marco_llegada, true); assert.equal(r.json.elegir_turno, null);
  assert.equal((await dueno.get('/api/asistencia/hoy')).json.asistencias.filter((a) => a.nombre === 'Luz').length, 1);
});

test('terminar el turno: primero cierra la caja y luego marca la salida desde su pantalla', async () => {
  let r = await luz.post('/api/asistencia/mi-salida');
  assert.equal(r.estado, 409); assert.equal(r.json.codigo, 'CAJA_ABIERTA');
  ok(await luz.post('/api/caja/cerrar', { efectivo_contado: 50 }));
  await pool.query('UPDATE asistencias SET entrada = entrada - INTERVAL 2 SECOND WHERE salida IS NULL');
  r = await luz.post('/api/asistencia/mi-salida');
  ok(r); assert.equal(r.json.accion, 'salida');
  r = await luz.post('/api/asistencia/mi-salida');
  assert.equal(r.estado, 409); assert.equal(r.json.codigo, 'SIN_ENTRADA');
});

// Prueba de un día completo contra una base de datos de PRUEBAS (nunca la real).
// Se ejecuta con:  npm test   (recrea la base "<DB_NAME>_test" antes de empezar)
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
const sandra = cliente();
const ana = cliente();
const tablet = cliente();
const ids = {};

test('seguridad: sin sesión no se entra y los datos se validan', async () => {
  const anonimo = cliente();
  assert.equal((await anonimo.get('/api/menu')).estado, 401);
  assert.equal((await anonimo.post('/api/ventas', {})).estado, 401);
  assert.equal((await anonimo.post('/api/auth/dueno', { nombre: 'Don Pedro', clave: 'mala' })).estado, 401);
  assert.equal((await anonimo.post('/api/auth/pin', { pin: 'abc' })).estado, 400);
  const r = await anonimo.post('/api/auth/dueno', { nombre: 'Don Pedro', clave: 'clave-del-dueno' });
  ok(r);
  assert.equal((await anonimo.get('/api/auth/me')).json.usuario.rol, 'dueno');
});

test('el dueño registra personal, turnos y gaseosas', async () => {
  ok(await dueno.post('/api/auth/dueno', { nombre: 'Don Pedro', clave: 'clave-del-dueno' }));
  const turnos = (await dueno.get('/api/turnos')).json.turnos;
  assert.equal(turnos.length, 3);
  ids.manana = turnos.find((t) => t.nombre === 'Mañana').id;

  let r = await dueno.post('/api/empleados', { nombre: 'Sandra', rol: 'atencion', pin: '1111', tipo_pago: 'mensual', monto_pago: 3000, turno_habitual_id: ids.manana });
  ok(r, 201); ids.sandra = r.json.id;
  r = await dueno.post('/api/empleados', { nombre: 'Ana', rol: 'atencion', pin: '2222', tipo_pago: 'diario', monto_pago: 100 });
  ok(r, 201); ids.ana = r.json.id;
  r = await dueno.post('/api/empleados', { nombre: 'Rosa', cargo: 'Cocina', rol: 'solo_asistencia', pin: '3333', tipo_pago: 'por_turno', monto_pago: 60, turno_habitual_id: ids.manana });
  ok(r, 201); ids.rosa = r.json.id;
  assert.equal((await dueno.post('/api/empleados', { nombre: 'Repetido', pin: '1111', monto_pago: 1 })).estado, 409);

  r = await dueno.post('/api/gaseosas', { marca: 'Coca-Cola', tamano: '2 L', precio: 12 });
  ok(r, 201); ids.coca = r.json.id;
  ok(await dueno.post('/api/gaseosas/ingreso', { items: [{ gaseosa_id: ids.coca, cantidad: 12 }] }), 201);
});

test('permisos: el personal no ve lo del dueño', async () => {
  ok(await sandra.post('/api/auth/pin', { pin: '1111' }));
  assert.equal((await sandra.get('/api/empleados')).estado, 403);
  assert.equal((await sandra.get('/api/registro-dia')).estado, 403);
  assert.equal((await sandra.post('/api/jornada/cerrar', { fondo_manana: 0 })).estado, 403);
  assert.equal((await sandra.post('/api/auth/dueno', { nombre: 'Sandra', clave: 'x' })).estado, 401);
  // el que solo marca asistencia no entra al sistema
  assert.equal((await cliente().post('/api/auth/pin', { pin: '3333' })).estado, 403);
});

test('asistencia en la tablet: entrada y salida solo con el PIN', async () => {
  assert.equal((await tablet.post('/api/asistencia/marcar', { pin: '0000' })).estado, 401);
  let r = await tablet.post('/api/asistencia/marcar', { pin: '1111' });
  ok(r); assert.equal(r.json.accion, 'entrada');
  r = await tablet.post('/api/asistencia/marcar', { pin: '2222' });
  assert.equal(r.estado, 409); assert.equal(r.json.codigo, 'ELEGIR_TURNO');
  r = await tablet.post('/api/asistencia/marcar', { pin: '2222', turno_id: ids.manana });
  ok(r); assert.equal(r.json.accion, 'entrada');
  ok(await tablet.post('/api/asistencia/marcar', { pin: '3333' }));
});

test('pollos: compra, apertura y piezas del día', async () => {
  ok(await dueno.post('/api/pollos/compra', { cantidad: 10, costo_total: 800 }), 201);
  assert.equal((await dueno.get('/api/pollos')).json.pollos_crudos, 10);
  assert.equal((await sandra.post('/api/pollos/compra', { cantidad: 1 })).estado, 403);
  const r = await sandra.post('/api/pollos/abrir', { cantidad: 3 });
  ok(r, 201);
  assert.equal(r.json.pollos_crudos, 7);
  const pierna = r.json.piezas.find((p) => p.nombre === 'Pierna');
  assert.equal(pierna.restante, 6); // 3 pollos × 2 piernas
  assert.equal((await sandra.post('/api/pollos/abrir', { cantidad: 99 })).estado, 422);
});

test('no se vende sin caja abierta; la caja exige contar el fondo', async () => {
  const menu = (await sandra.get('/api/menu')).json;
  ids.pierna = menu.presas.find((p) => p.nombre === 'Pierna').id;
  ids.ala = menu.presas.find((p) => p.nombre === 'Ala').id;
  const venta = { forma_pago: 'efectivo', items: [{ tipo: 'plato', presa_id: ids.pierna }] };
  assert.equal((await sandra.post('/api/ventas', venta)).json.codigo, 'SIN_ENCARGADA');
  assert.equal((await sandra.post('/api/caja/abrir', {})).json.codigo, 'FALTA_FONDO');
  const r = await sandra.post('/api/caja/abrir', { fondo_recibido: 100 });
  ok(r, 201); assert.equal(r.json.es_encargada, true);
});

test('ventas: plato, pura papa, gaseosa y pedido por llamada con QR', async () => {
  const menu = (await sandra.get('/api/menu')).json;
  const arroz = menu.acompanamientos.find((a) => a.nombre === 'Arroz').id;
  const platano = menu.acompanamientos.find((a) => a.nombre === 'Plátano').id;
  const papa = menu.acompanamientos.find((a) => a.nombre === 'Papa').id;

  // plato normal (15) + gaseosa (12) = 27
  let r = await sandra.post('/api/ventas', { forma_pago: 'efectivo', items: [{ tipo: 'plato', presa_id: ids.pierna }, { tipo: 'gaseosa', gaseosa_id: ids.coca, cantidad: 1 }] });
  ok(r, 201);
  assert.equal(dinero(r.json.venta.total), '27.00');
  ids.venta1 = r.json.venta.venta_id;

  // pura papa: 15 + 1
  r = await sandra.post('/api/ventas', { forma_pago: 'efectivo', items: [{ tipo: 'plato', presa_id: ids.ala, sin_aumento: true, acompanamientos: [papa] }] });
  ok(r, 201);
  assert.equal(dinero(r.json.venta.total), '16.00');

  // puro arroz: precio normal
  r = await sandra.post('/api/ventas', { forma_pago: 'efectivo', items: [{ tipo: 'plato', presa_id: ids.ala, aumento_id: 7, acompanamientos: [arroz, platano] }] });
  ok(r, 201);
  assert.equal(dinero(r.json.venta.total), '15.00');

  // pedido por llamada: sin nombre o sin QR no pasa
  const llamada = { canal: 'llamada', forma_pago: 'qr', items: [{ tipo: 'plato', presa_id: ids.pierna }] };
  assert.equal((await sandra.post('/api/ventas', llamada)).estado, 400);
  r = await sandra.post('/api/ventas', { ...llamada, qr_referencia: 'QR-0001', llamada: { cliente_nombre: 'Juan Pérez Mamani' } });
  ok(r, 201);
  ids.pedido = r.json.venta.venta_id;
  assert.equal((await sandra.get('/api/pedidos')).json.pedidos.length, 1);
  ok(await sandra.patch(`/api/pedidos/${ids.pedido}/estado`, { estado: 'listo' }));
  assert.equal((await sandra.patch(`/api/pedidos/${ids.pedido}/estado`, { estado: 'preparando' })).estado, 409);
  ok(await sandra.patch(`/api/pedidos/${ids.pedido}/estado`, { estado: 'entregado' }));

  // tickets: cliente y caja
  r = await sandra.get(`/api/ventas/${ids.venta1}/ticket`);
  ok(r);
});

test('stock: no se puede vender lo que no hay y anular devuelve la pieza', async () => {
  // quedan 6 piernas - 2 vendidas (venta1 + llamada) = 4
  const comprar = (n) => ({ forma_pago: 'efectivo', items: Array.from({ length: n }, () => ({ tipo: 'plato', presa_id: ids.pierna })) });
  const r = await sandra.post('/api/ventas', comprar(5));
  assert.equal(r.estado, 409); assert.equal(r.json.codigo, 'SIN_STOCK');
  // la venta rechazada no dejó nada a medias
  assert.equal((await sandra.get('/api/piezas/hoy')).json.piezas.find((p) => p.nombre === 'Pierna').restante, 4);
  ok(await sandra.post('/api/ventas', comprar(4)), 201);
  const venta = (await sandra.post('/api/ventas', comprar(1)));
  assert.equal(venta.estado, 409);

  const lista = (await sandra.get('/api/ventas')).json.ventas;
  const ultima = lista.find((v) => dinero(v.total) === '60.00');
  ok(await sandra.post(`/api/ventas/${ultima.id}/anular`, { motivo: 'Cliente se arrepintió' }));
  assert.equal((await sandra.post(`/api/ventas/${ultima.id}/anular`, { motivo: 'otra vez' })).estado, 409);
  assert.equal((await sandra.get('/api/piezas/hoy')).json.piezas.find((p) => p.nombre === 'Pierna').restante, 4);
});

test('pérdidas (solo cantidad) y gastos', async () => {
  let r = await sandra.post('/api/perdidas', { motivo: 'consumo_personal', items: [{ pieza_id: ids.ala, cantidad: 2 }] });
  ok(r, 201);
  assert.equal((await sandra.post('/api/perdidas', { motivo: 'regalo', items: [{ pieza_id: ids.ala, cantidad: 50 }] })).estado, 409);
  assert.equal((await sandra.post('/api/perdidas', { motivo: 'otro', items: [{ pieza_id: ids.ala, cantidad: 1 }] })).estado, 400);
  r = await sandra.post('/api/gastos', { concepto: 'Carbón', monto: 20 });
  ok(r, 201); ids.gasto = r.json.id;
  r = await sandra.post('/api/gastos', { concepto: 'Servilletas', monto: 5 });
  ok(await sandra.del(`/api/gastos/${r.json.id}`));
  assert.equal((await ana.get('/api/gastos')).estado, 401);
});

test('relevo de caja: Ana apoya y luego Sandra cierra con el conteo correcto', async () => {
  ok(await ana.post('/api/auth/pin', { pin: '2222' }));
  const a = await ana.post('/api/caja/abrir', {});
  ok(a, 201); assert.equal(a.json.es_encargada, false);

  // Ana no puede cerrar el día ni ver sueldos
  assert.equal((await ana.get('/api/planillas')).estado, 403);

  // Sandra cierra: debe contar (fondo 100 + efectivo - gastos)
  const informe = (await sandra.get('/api/caja/informe')).json;
  const esperado = Number(informe.efectivo_esperado);
  // ventas efectivo: 27 + 16 + 15 + 60(anulada no cuenta) → 58; gasto 20; fondo 100 → 138
  assert.equal(esperado, 138);
  assert.equal((await sandra.post('/api/caja/cerrar', {})).json.codigo, 'FALTA_CONTADO');
  const c = await sandra.post('/api/caja/cerrar', { efectivo_contado: 130, motivo: 'Faltó un cambio' });
  ok(c);
  assert.equal(Number(c.json.diferencia), -8);

  // el dueño ve el cierre con nombre y diferencia
  const ses = (await dueno.get('/api/caja/sesiones')).json.sesiones;
  const s = ses.find((x) => x.nombre === 'Sandra');
  assert.equal(Number(s.diferencia), -8);
  assert.equal(s.motivo_diferencia, 'Faltó un cambio');
});

test('el día no se cierra con cajas abiertas; luego cierra y se arma el registro', async () => {
  // la base exige salida > entrada: se adelanta un poco la hora de entrada para que la prueba no dependa del reloj
  await pool.query('UPDATE asistencias SET entrada = entrada - INTERVAL 2 SECOND WHERE salida IS NULL');
  let r = await dueno.post('/api/jornada/cerrar', { fondo_manana: 100, pollos_manana: 7 });
  assert.equal(r.estado, 409); assert.equal(r.json.codigo, 'CAJAS_ABIERTAS');

  // Ana (que quedó con la caja de apoyo) marca su salida: su sesión se cierra sola
  const sal = await tablet.post('/api/asistencia/marcar', { pin: '2222' });
  ok(sal); assert.equal(sal.json.accion, 'salida');

  // pollos: el dueño cuenta 6 pero el sistema decía 7 → queda la diferencia anotada
  r = await dueno.post('/api/jornada/cerrar', { fondo_manana: 100, pollos_manana: 6 });
  ok(r);
  assert.equal(r.json.diferencia_pollos, -1);
  assert.equal(r.json.pollos_para_manana, 6);

  // ya cerrado: no se vende ni se anota nada
  assert.equal((await sandra.post('/api/gastos', { concepto: 'Cualquier gasto', monto: 1 })).estado, 409);
  assert.equal((await dueno.post('/api/jornada/cerrar', { fondo_manana: 1 })).estado, 409);

  const reg = (await dueno.get('/api/registro-dia')).json;
  assert.equal(dinero(reg.resumen.venta_total), '73.00');
  assert.equal(dinero(reg.resumen.venta_qr), '15.00');
  assert.equal(dinero(reg.resumen.venta_efectivo), '58.00');
  assert.equal(dinero(reg.resumen.gastos), '20.00');
  assert.equal(Number(reg.resumen.pollos_usados), 3);
  assert.equal(Number(reg.resumen.presas_perdidas), 2);
  assert.equal(reg.cuadre.cuadra, false); // 30 presas - 6 vendidas ... quedan presas sin vender (sin explicar)
  assert.ok(reg.frases.length >= 4);
});

test('planilla: lo estimado es exactamente lo que queda al cerrar', async () => {
  const [[{ d }]] = await pool.query('SELECT CURDATE() AS d');
  const periodo = `desde=${d}&hasta=${d}`;
  const est = (await dueno.get(`/api/planillas/estimar?${periodo}`)).json;
  assert.equal(est.empleados.length, 3); // Sandra, Ana y Rosa (el dueño no cobra)

  // adelanto de Rosa
  ok(await dueno.post('/api/ajustes-sueldo', { empleado_id: ids.rosa, tipo: 'adelanto', monto: 10, nota: 'Adelanto' }), 201);
  const est2 = (await dueno.get(`/api/planillas/estimar?${periodo}`)).json;
  const rosa = est2.empleados.find((e) => e.nombre === 'Rosa');
  assert.equal(dinero(rosa.adelantos), '10.00');
  assert.equal(dinero(rosa.total_pagar), '50.00'); // 1 turno × 60 - 10
  const sandraFila = est2.empleados.find((e) => e.nombre === 'Sandra');
  assert.equal(dinero(sandraFila.monto_base), '100.00'); // 3000 × 1 / 30

  let r = await dueno.post('/api/planillas', { desde: d, hasta: d });
  ok(r, 201); ids.planilla = r.json.id;
  assert.equal((await dueno.post('/api/planillas', { desde: d, hasta: d })).estado, 409); // se cruza
  ok(await dueno.post(`/api/planillas/${ids.planilla}/cerrar`));

  const cerrada = (await dueno.get(`/api/planillas/${ids.planilla}`)).json;
  assert.equal(cerrada.vista_previa, false);
  assert.equal(dinero(cerrada.total), dinero(est2.total));
  for (const f of est2.empleados) {
    const c = cerrada.detalles.find((x) => x.empleado_id === f.empleado_id);
    assert.equal(dinero(c.total_pagar), dinero(f.total_pagar), f.nombre);
  }
  // los montos quedan congelados aunque cambie el sueldo
  ok(await dueno.patch(`/api/empleados/${ids.rosa}`, { monto_pago: 500 }));
  const congelada = (await dueno.get(`/api/planillas/${ids.planilla}`)).json;
  assert.equal(dinero(congelada.detalles.find((x) => x.empleado_id === ids.rosa).monto_pago), '60.00');
  // no se puede borrar un adelanto ya descontado, ni poner uno dentro de una planilla cerrada
  const lista = (await dueno.get('/api/ajustes-sueldo')).json.ajustes;
  assert.equal((await dueno.del(`/api/ajustes-sueldo/${lista[0].id}`)).estado, 409);
  assert.equal((await dueno.post('/api/ajustes-sueldo', { empleado_id: ids.rosa, tipo: 'bono', monto: 5 })).estado, 409);
  const boleta = await dueno.get(`/api/planillas/${ids.planilla}/boleta/${ids.rosa}`);
  ok(boleta);
});

test('reglas, bitácora y reabrir el día', async () => {
  let r = await dueno.put('/api/configuracion', { tolerancia_minutos: 15, descuento_por_minuto_atraso: '0.5' });
  ok(r);
  assert.equal(r.json.reglas.find((x) => x.clave === 'tolerancia_minutos').valor, '15');
  assert.equal((await dueno.put('/api/configuracion', { tolerancia_minutos: -3 })).estado, 422);
  assert.equal((await dueno.put('/api/configuracion', { inventada: 1 })).estado, 422);

  ok(await dueno.post('/api/jornada/reabrir', { motivo: 'Faltó anotar un gasto' }));
  ok(await sandra.post('/api/gastos', { concepto: 'Aceite', monto: 30, de_caja: false }), 201);

  const bit = (await dueno.get('/api/bitacora?limite=500')).json.registros;
  const acciones = new Set(bit.map((b) => b.accion));
  for (const a of ['cerrar_dia', 'reabrir_dia', 'cerrar_planilla', 'editar']) assert.ok(acciones.has(a), `falta ${a} en la bitácora`);
  assert.equal((await sandra.get('/api/bitacora')).estado, 403);

  // la bitácora no se puede alterar ni desde la base de datos
  await assert.rejects(pool.query('DELETE FROM bitacora'));
  await assert.rejects(pool.query("UPDATE bitacora SET accion = 'x'"));
});

// Pantallas del dueño: inicio, pollos y gaseosas, personal, sueldos, registro del día, reglas y bitácora.
import { h, poner, estado, GET, POST, PATCH, PUT, DEL, bs, num, hora, fechaCorta, hoyISO, sumaDias, aviso, falla, intentar, modal, confirmar, preguntar, aMonto, aEntero, imprimir, MOTIVOS } from './nucleo.js';

const recargar = (el, fn) => { el.replaceChildren(); return fn(el); };
const fila = (t, v, fuerte) => h('div', { class: 'linea' }, h('span', { class: fuerte ? '' : 'suave' }, t), h('b', { class: 'mono' }, v));
const tabla = (cols, filas, numericas = []) => h('div', { class: 'tabla-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c, i) => h('th', { class: numericas.includes(i) ? 'n' : '' }, c)))), h('tbody', {}, filas.map((f) => h('tr', {}, f.map((c, i) => h('td', { class: numericas.includes(i) ? 'n' : '' }, c)))))));
const semaforo = { verde: 'ok', amarillo: 'alerta', rojo: 'mal' };
const TIPOS_PAGO = [{ valor: 'mensual', texto: 'Sueldo mensual' }, { valor: 'diario', texto: 'Pago por día' }, { valor: 'por_turno', texto: 'Pago por turno' }];
const textoPago = { mensual: 'por mes', diario: 'por día', por_turno: 'por turno' };

// ------------------------------------------------------------------ INICIO
export async function pantallaInicio(el) {
  const d = await GET('/dueno/inicio');
  poner(el, h('h1', {}, 'Buen día'),
    h('div', { class: 'tarjeta col' }, d.frases.map((f) => h('div', { style: 'font-size:1.15rem;font-weight:600' }, f))),
    d.alertas.map((a) => h('div', { class: `aviso ${a.nivel === 'rojo' ? 'mal' : 'alerta'}` }, a.mensaje)),
    h('div', { class: 'grid ancho' },
      [['#/pollos', '🐔', 'Pollos y gaseosas', `${d.pollos_crudos} pollos crudos`], ['#/personal', '👥', 'Personal', `${d.personal_adentro} trabajando ahora`], ['#/sueldos', '💵', 'Sueldos', 'Ver y cerrar planilla'], ['#/dia', '📒', 'Registro del día', `Vendido hoy ${bs(d.vendido_hoy)}`], ['#/vender', '🧾', 'Vender', `${d.cajas_abiertas} caja(s) abierta(s)`], ['#/mas', '⚙️', 'Más', 'Precios, reglas, bitácora']]
        .map(([href, ico, t, s]) => h('a', { href, class: 'panel' }, h('span', { class: 'ico' }, ico), h('span', {}, h('b', {}, t), h('small', {}, s))))));
}

// ------------------------------------------------------------------ POLLOS Y GASEOSAS
export async function pantallaPollos(el) {
  const [pollos, { piezas }, { gaseosas }] = await Promise.all([GET('/pollos'), GET('/piezas/hoy'), GET('/gaseosas')]);
  const otra = () => recargar(el, pantallaPollos);

  const pedirCantidad = (titulo, etiqueta, ruta, extra, ok) => async () => {
    const campos = [{ nombre: 'n', etiqueta, tipo: 'entero', atajos: [1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((v) => ({ texto: String(v), valor: v })) }, ...(extra || [])];
    const d = await preguntar(titulo, campos);
    if (!d) return;
    let cuerpo;
    try { cuerpo = ruta.armar(d); } catch (e) { return falla(e); }
    if (await intentar(() => POST(ruta.url, cuerpo), ok)) otra();
  };

  poner(el, h('h1', {}, 'Pollos y gaseosas'),
    h('div', { class: 'tarjeta' },
      h('div', { class: 'fila sep' }, h('div', {}, h('div', { class: 'suave' }, 'Pollos crudos guardados'), h('div', { class: 'grande-num' }, pollos.pollos_crudos)),
        h('span', { class: 'chip' }, '1 pollo = 10 presas')),
      h('div', { class: 'grid', style: 'margin-top:10px' },
        h('button', { class: 'btn', onclick: pedirCantidad('Llegaron pollos', '¿Cuántos pollos llegaron?', { url: '/pollos/compra', armar: (d) => { const o = { cantidad: aEntero(d.n) }; if (d.costo.trim()) o.costo_total = aMonto(d.costo); return o; } }, [{ nombre: 'costo', etiqueta: 'Costo total en Bs (opcional)', tipo: 'dinero', requerido: false }], 'Pollos registrados') }, 'Llegaron pollos'),
        h('button', { class: 'btn', onclick: pedirCantidad('Abrir pollos', '¿Cuántos pollos vas a abrir ahora?', { url: '/pollos/abrir', armar: (d) => ({ cantidad: aEntero(d.n) }) }, null, 'Pollos abiertos: ya están en las presas del día') }, 'Abrir pollos'),
        h('button', { class: 'btn sec', onclick: pedirCantidad('Contar pollos crudos', '¿Cuántos pollos crudos contaste?', { url: '/pollos/conteo', armar: (d) => ({ contados: aEntero(d.n) }) }, null, 'Conteo guardado') }, 'Contar pollos'),
        h('button', { class: 'btn sec', onclick: pedirCantidad('Pollo echado a perder', '¿Cuántos pollos crudos se echaron a perder?', { url: '/pollos/merma', armar: (d) => ({ cantidad: aEntero(d.n), nota: d.nota.trim() }) }, [{ nombre: 'nota', etiqueta: '¿Qué pasó?' }], 'Anotado') }, 'Se echó a perder'))),
    h('h2', {}, 'Presas de hoy'),
    piezas.length ? h('div', { class: 'tarjeta' }, tabla(['Pieza', 'Abiertas', 'Vendidas', 'Perdidas', 'Quedan'], piezas.map((p) => [p.nombre + (p.categoria === 'aumento' ? ' (aumento)' : ''), p.abiertas, p.vendidas, p.perdidas, h('b', {}, p.restante)]), [1, 2, 3, 4])) : h('p', { class: 'suave' }, 'Todavía no se abrieron pollos hoy.'),
    h('div', { class: 'fila sep' }, h('h2', {}, 'Gaseosas'), h('button', { class: 'btn chico', onclick: async () => {
      const d = await preguntar('Nueva gaseosa', [{ nombre: 'marca', etiqueta: 'Marca', ayuda: 'Ejemplo: Coca-Cola' }, { nombre: 'tamano', etiqueta: 'Tamaño', ayuda: 'Ejemplo: 2 litros, 500 ml, personal' }, { nombre: 'precio', etiqueta: 'Precio de venta (Bs)', tipo: 'dinero' }]);
      if (!d) return; let precio; try { precio = aMonto(d.precio); } catch (e) { return falla(e); }
      if (await intentar(() => POST('/gaseosas', { marca: d.marca.trim(), tamano: d.tamano.trim(), precio }), 'Gaseosa registrada')) otra();
    } }, '+ Nueva')),
    h('div', { class: 'tarjeta' }, gaseosas.length === 0 ? h('p', { class: 'suave' }, 'Aún no registraste gaseosas. Toca "+ Nueva".') : gaseosas.map((g) => h('div', { class: 'linea', style: g.activo ? '' : 'opacity:.5' },
      h('span', {}, h('b', {}, `${g.marca} ${g.tamano}`), h('small', { class: 'suave' }, ` · ${bs(g.precio)}`)),
      h('span', { class: 'fila' }, h('span', { class: `chip ${semaforo[g.semaforo]}` }, `${g.stock} en stock`),
        h('button', { class: 'btn sec chico', onclick: async () => {
          const d = await preguntar(`${g.marca} ${g.tamano}`, [{ nombre: 'marca', etiqueta: 'Marca', valor: g.marca }, { nombre: 'tamano', etiqueta: 'Tamaño', valor: g.tamano }, { nombre: 'precio', etiqueta: 'Precio de venta (Bs)', tipo: 'dinero', valor: g.precio }, { nombre: 'minimo', etiqueta: 'Avisar cuando queden', tipo: 'entero', valor: g.stock_minimo }, { nombre: 'activo', etiqueta: 'Se vende', tipo: 'check', valor: g.activo }]);
          if (!d) return; let cuerpo; try { cuerpo = { marca: d.marca.trim(), tamano: d.tamano.trim(), precio: aMonto(d.precio), stock_minimo: aEntero(d.minimo), activo: d.activo }; } catch (e) { return falla(e); }
          if (await intentar(() => PUT(`/gaseosas/${g.id}`, cuerpo), 'Guardado')) otra();
        } }, 'Editar'),
        h('button', { class: 'btn mal chico', title: 'Eliminar', 'aria-label': 'Eliminar', onclick: async () => {
          if (!(await confirmar('Eliminar gaseosa', `¿Eliminar "${g.marca} ${g.tamano}"? Solo se puede si nunca tuvo ingresos ni ventas; si ya tiene historial, desactívala con "Editar".`, 'Sí, eliminar', true))) return;
          if (await intentar(() => DEL(`/gaseosas/${g.id}`), 'Gaseosa eliminada')) otra();
        } }, '🗑')))),
      gaseosas.some((g) => g.activo) && h('div', { class: 'fila', style: 'margin-top:10px' },
        h('button', { class: 'btn', onclick: () => listaConteo('Llegaron gaseosas', 'Escribe cuántas llegaron de cada una (deja en blanco las que no llegaron)', gaseosas.filter((g) => g.activo), 'ingreso', otra) }, 'Llegaron gaseosas'),
        h('button', { class: 'btn sec', onclick: () => listaConteo('Contar lo que queda', 'Escribe cuántas hay de cada una (deja en blanco las que no contaste)', gaseosas.filter((g) => g.activo), 'conteo', otra) }, 'Contar lo que queda'))));
}

function listaConteo(titulo, intro, gaseosas, modo, alTerminar) {
  const entradas = gaseosas.map((g) => ({ g, input: h('input', { inputmode: 'numeric', placeholder: modo === 'conteo' ? String(g.stock) : '0', autocomplete: 'off', style: 'max-width:110px' }) }));
  const m = modal(titulo, h('div', { class: 'col' }, h('p', { class: 'suave' }, intro),
    entradas.map(({ g, input }) => h('div', { class: 'linea' }, h('span', {}, `${g.marca} ${g.tamano}`, modo === 'conteo' && h('small', { class: 'suave' }, `  (sistema: ${g.stock})`)), input)),
    h('button', { class: 'btn grande', onclick: async () => {
      let items;
      try {
        items = entradas.filter((e) => e.input.value.trim() !== '').map((e) => (modo === 'ingreso' ? { gaseosa_id: e.g.id, cantidad: aEntero(e.input.value) } : { gaseosa_id: e.g.id, contado: aEntero(e.input.value) }));
      } catch (e) { return falla(e); }
      if (!items.length) return aviso('No escribiste ninguna cantidad', 'mal');
      if (modo === 'ingreso') items = items.filter((i) => i.cantidad > 0);
      const r = await intentar(() => POST(`/gaseosas/${modo}`, { items }), 'Guardado');
      if (r) { m.cerrar(); if (modo === 'conteo' && r.diferencias?.length) aviso(`Se corrigió el stock de ${r.diferencias.length} gaseosa(s)`); alTerminar(); }
    } }, 'Guardar')));
}

// ------------------------------------------------------------------ PERSONAL
const lunesDe = (iso) => { const d = new Date(iso + 'T12:00:00Z'); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
let semanaPlan = null;

export async function pantallaPersonal(el) {
  const [{ empleados }, { turnos }, { asistencias }] = await Promise.all([GET('/empleados'), GET('/turnos'), GET('/asistencia/hoy')]);
  const otra = () => recargar(el, pantallaPersonal);
  const opcTurno = [{ valor: '', texto: 'Sin turno fijo (pregunta al marcar)' }, ...turnos.filter((t) => t.activo).map((t) => ({ valor: t.id, texto: `${t.nombre} (${t.hora_inicio}–${t.hora_fin})` }))];

  const formEmpleado = async (e) => {
    const nuevo = !e;
    const campos = [
      { nombre: 'nombre', etiqueta: 'Nombre', valor: e?.nombre },
      { nombre: 'cargo', etiqueta: 'Cargo (cajera, cocina…)', valor: e?.cargo || '', requerido: false },
      { nombre: 'rol', etiqueta: '¿Qué puede hacer en el sistema?', tipo: 'select', valor: e?.rol || 'atencion', opciones: e?.rol === 'dueno' ? [{ valor: 'dueno', texto: 'Dueño' }] : [{ valor: 'atencion', texto: 'Atiende en caja (entra con PIN)' }, { valor: 'solo_asistencia', texto: 'Solo marca asistencia (cocina, etc.)' }] },
      ...(nuevo ? [{ nombre: 'pin', etiqueta: 'PIN de 4 a 6 números (cada persona uno distinto)', tipo: 'pin' }] : []),
      { nombre: 'tipo_pago', etiqueta: 'Cómo se le paga', tipo: 'select', valor: e?.tipo_pago || 'mensual', opciones: TIPOS_PAGO },
      { nombre: 'monto', etiqueta: 'Monto en Bs (sueldo mensual, por día o por turno)', tipo: 'dinero', valor: e?.monto_pago },
      { nombre: 'turno', etiqueta: 'Turno habitual', tipo: 'select', valor: e?.turno_habitual_id ?? '', opciones: opcTurno },
      ...(nuevo ? [] : e.rol === 'dueno' ? [] : [{ nombre: 'activo', etiqueta: 'Trabaja actualmente', tipo: 'check', valor: e.activo }]),
    ];
    const d = await preguntar(nuevo ? 'Nuevo empleado' : `Editar a ${e.nombre}`, campos);
    if (!d) return;
    let cuerpo;
    try {
      cuerpo = { nombre: d.nombre.trim(), cargo: d.cargo.trim() || (nuevo ? undefined : null), tipo_pago: d.tipo_pago, monto_pago: aMonto(d.monto), turno_habitual_id: d.turno === '' ? (nuevo ? undefined : null) : Number(d.turno) };
      if (e?.rol !== 'dueno') cuerpo.rol = d.rol;
      if (nuevo) cuerpo.pin = d.pin; else if (e.rol !== 'dueno') cuerpo.activo = d.activo;
    } catch (x) { return falla(x); }
    if (await intentar(() => (nuevo ? POST('/empleados', cuerpo) : PATCH(`/empleados/${e.id}`, cuerpo)), 'Guardado')) otra();
  };

  poner(el, h('div', { class: 'fila sep' }, h('h1', {}, 'Personal'), h('button', { class: 'btn', onclick: () => formEmpleado(null) }, '+ Nuevo empleado')),
    empleados.map((e) => h('div', { class: 'tarjeta', style: e.activo ? '' : 'opacity:.55' },
      h('div', { class: 'fila sep' }, h('b', {}, e.nombre), h('span', { class: 'fila' }, e.adentro ? h('span', { class: 'chip ok' }, 'Trabajando ahora') : e.vino_hoy ? h('span', { class: 'chip' }, 'Ya vino hoy') : null, !e.activo && h('span', { class: 'chip mal' }, 'Inactivo'))),
      h('div', { class: 'suave' }, `${e.cargo || (e.rol === 'dueno' ? 'Dueño' : e.rol === 'solo_asistencia' ? 'Solo asistencia' : 'Atención')}${e.rol === 'dueno' ? '' : ` · ${bs(e.monto_pago)} ${textoPago[e.tipo_pago]}`}${e.turno_habitual ? ` · Turno ${e.turno_habitual}` : ''}`),
      h('div', { class: 'fila', style: 'margin-top:8px' }, h('button', { class: 'btn sec chico', onclick: () => formEmpleado(e) }, 'Editar'),
        h('button', { class: 'btn sec chico', onclick: async () => {
          const d = await preguntar(`Nuevo PIN para ${e.nombre}`, [{ nombre: 'pin', etiqueta: 'PIN de 4 a 6 números', tipo: 'pin' }], 'Cambiar PIN', 'El PIN anterior deja de funcionar.');
          if (d) await intentar(() => POST(`/empleados/${e.id}/pin`, { pin: d.pin }), 'PIN cambiado');
        } }, 'Cambiar PIN')))),
    h('h2', {}, 'Asistencia de hoy'),
    asistencias.length ? h('div', { class: 'tarjeta' }, tabla(['Nombre', 'Turno', 'Entró', 'Salió', 'Atraso'], asistencias.map((a) => [a.nombre, a.turno, a.estado === 'falta' ? h('span', { class: 'chip mal' }, a.falta_justificada ? 'Falta justificada' : 'Falta') : hora(a.entrada), hora(a.salida), a.minutos_atraso > 0 ? `${a.minutos_atraso} min` : '—']))) : h('p', { class: 'suave' }, 'Nadie marcó asistencia todavía.'),
    h('button', { class: 'btn sec', onclick: async () => {
      const personas = empleados.filter((e) => e.activo && e.rol !== 'dueno');
      const d = await preguntar('Anotar una falta', [
        { nombre: 'empleado', etiqueta: 'Persona', tipo: 'select', opciones: personas.map((p) => ({ valor: p.id, texto: p.nombre })) },
        { nombre: 'turno', etiqueta: 'Turno', tipo: 'select', opciones: turnos.filter((t) => t.activo).map((t) => ({ valor: t.id, texto: t.nombre })) },
        { nombre: 'fecha', etiqueta: 'Día', tipo: 'date', valor: hoyISO() },
        { nombre: 'justificada', etiqueta: 'Falta justificada (no se descuenta)', tipo: 'check', valor: false },
      ], 'Anotar falta');
      if (d && await intentar(() => POST('/asistencia/falta', { empleado_id: Number(d.empleado), turno_id: Number(d.turno), fecha: d.fecha, justificada: d.justificada }), 'Falta anotada')) otra();
    } }, 'Anotar una falta'),
    h('h2', {}, 'Plan de la semana (opcional)'), h('p', { class: 'suave' }, 'Si anotas quién trabaja cada día, el sistema marca solo la falta de quien no vino.'),
    h('div', { id: 'plan' }));
  await dibujarPlan(el.querySelector('#plan'), empleados.filter((e) => e.activo && e.rol !== 'dueno'), turnos.filter((t) => t.activo));
}

async function dibujarPlan(caja, personas, turnos) {
  semanaPlan = semanaPlan || lunesDe(hoyISO());
  const dias = Array.from({ length: 7 }, (_, i) => sumaDias(semanaPlan, i));
  const { plan } = await GET(`/asistencia/plan?desde=${dias[0]}&hasta=${dias[6]}`);
  const actual = new Map(plan.map((p) => [`${p.empleado_id}|${p.fecha}`, p.turno_id]));
  const cambios = new Map();
  const nombresDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  caja.replaceChildren(h('div', { class: 'tarjeta' },
    h('div', { class: 'fila sep' }, h('button', { class: 'btn sec chico', onclick: () => { semanaPlan = sumaDias(semanaPlan, -7); dibujarPlan(caja, personas, turnos); } }, '‹ Semana anterior'), h('b', {}, `${fechaCorta(dias[0])} al ${fechaCorta(dias[6])}`), h('button', { class: 'btn sec chico', onclick: () => { semanaPlan = sumaDias(semanaPlan, 7); dibujarPlan(caja, personas, turnos); } }, 'Semana siguiente ›')),
    h('div', { class: 'tabla-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), dias.map((d, i) => h('th', {}, `${nombresDia[i]} ${d.slice(8)}`)))),
      h('tbody', {}, personas.map((p) => h('tr', {}, h('td', {}, h('b', {}, p.nombre)), dias.map((d) => h('td', {}, h('select', { style: 'min-width:88px;min-height:40px;padding:.2rem', onchange: (e) => cambios.set(`${p.id}|${d}`, { empleado_id: p.id, fecha: d, turno_id: e.target.value === '' ? null : Number(e.target.value) }) },
        h('option', { value: '' }, 'Libre'), turnos.map((t) => h('option', { value: t.id, selected: actual.get(`${p.id}|${d}`) === t.id }, t.nombre)))))))))),
    h('button', { class: 'btn', style: 'margin-top:10px', onclick: async () => { if (!cambios.size) return aviso('No cambiaste nada'); if (await intentar(() => PUT('/asistencia/plan', { asignaciones: [...cambios.values()] }), 'Plan guardado')) dibujarPlan(caja, personas, turnos); } }, 'Guardar plan')));
}

// ------------------------------------------------------------------ SUELDOS
let periodo = null;
export async function pantallaSueldos(el) {
  const hoy = hoyISO();
  periodo = periodo || { desde: hoy.slice(0, 8) + '01', hasta: hoy };
  const otra = () => recargar(el, pantallaSueldos);
  const [est, { planillas }, { ajustes }, { empleados }] = await Promise.all([GET(`/planillas/estimar?desde=${periodo.desde}&hasta=${periodo.hasta}`), GET('/planillas'), GET('/ajustes-sueldo?pendientes=1'), GET('/empleados')]);

  poner(el, h('h1', {}, 'Sueldos'),
    h('div', { class: 'tarjeta col' },
      h('div', { class: 'fila' }, h('div', { style: 'flex:1;min-width:140px' }, h('label', {}, 'Desde'), h('input', { type: 'date', value: periodo.desde, onchange: (e) => { periodo.desde = e.target.value; otra(); } })), h('div', { style: 'flex:1;min-width:140px' }, h('label', {}, 'Hasta'), h('input', { type: 'date', value: periodo.hasta, max: hoy, onchange: (e) => { periodo.hasta = e.target.value; otra(); } }))),
      h('p', { class: 'suave' }, 'El sistema calcula con la asistencia: días trabajados, faltas, atrasos, adelantos y bonos.'),
      tabla(['Persona', 'Base', 'Faltas', 'Atrasos', 'Adelantos', 'Bonos', 'A pagar'], est.empleados.map((e) => [h('span', {}, h('b', {}, e.nombre), h('small', { class: 'suave' }, `  ${e.dias_trabajados} días · ${e.faltas} falta(s)${e.minutos_atraso > 0 ? ` · ${e.minutos_atraso} min tarde` : ''}`)), bs(e.monto_base), e.descuento_faltas > 0 ? '− ' + bs(e.descuento_faltas) : '—', e.descuento_atrasos > 0 ? '− ' + bs(e.descuento_atrasos) : '—', num(e.adelantos) > 0 ? '− ' + bs(e.adelantos) : '—', num(e.bonos) > 0 ? '+ ' + bs(e.bonos) : '—', h('b', {}, bs(e.total_pagar))]), [1, 2, 3, 4, 5, 6]),
      h('div', { class: 'fila sep' }, h('span', {}, 'Total a pagar'), h('b', { class: 'grande-num' }, bs(est.total))),
      h('button', { class: 'btn grande', onclick: async () => {
        if (!(await confirmar('Cerrar la planilla', `Se congelan los sueldos del ${fechaCorta(periodo.desde)} al ${fechaCorta(periodo.hasta)} por un total de ${bs(est.total)}. Después no se pueden cambiar.`, 'Cerrar planilla'))) return;
        const r = await intentar(() => POST('/planillas', { desde: periodo.desde, hasta: periodo.hasta }));
        if (r && await intentar(() => POST(`/planillas/${r.id}/cerrar`), 'Planilla cerrada')) otra();
      } }, 'Cerrar planilla de este periodo')),
    h('div', { class: 'fila sep' }, h('h2', {}, 'Adelantos y bonos pendientes'), h('button', { class: 'btn chico', onclick: async () => {
      const personas = empleados.filter((e) => e.activo && e.rol !== 'dueno');
      const d = await preguntar('Adelanto o bono', [
        { nombre: 'empleado', etiqueta: 'Persona', tipo: 'select', opciones: personas.map((p) => ({ valor: p.id, texto: p.nombre })) },
        { nombre: 'tipo', etiqueta: 'Qué es', tipo: 'select', opciones: [{ valor: 'adelanto', texto: 'Adelanto (se descuenta del sueldo)' }, { valor: 'bono', texto: 'Bono (se suma al sueldo)' }] },
        { nombre: 'monto', etiqueta: 'Monto (Bs)', tipo: 'dinero' }, { nombre: 'nota', etiqueta: 'Nota (opcional)', requerido: false },
        { nombre: 'de_caja', etiqueta: 'El adelanto se pagó con el efectivo de la caja', tipo: 'check', valor: false }]);
      if (!d) return; let cuerpo; try { cuerpo = { empleado_id: Number(d.empleado), tipo: d.tipo, monto: aMonto(d.monto), de_caja: d.tipo === 'adelanto' && d.de_caja }; } catch (e) { return falla(e); }
      if (d.nota.trim()) cuerpo.nota = d.nota.trim();
      if (await intentar(() => POST('/ajustes-sueldo', cuerpo), 'Anotado')) otra();
    } }, '+ Anotar')),
    ajustes.length ? h('div', { class: 'tarjeta' }, ajustes.map((a) => h('div', { class: 'linea' }, h('span', {}, `${a.nombre}: ${a.tipo} de ${bs(a.monto)}`, h('small', { class: 'suave' }, ` · ${fechaCorta(a.fecha)}${a.nota ? ' · ' + a.nota : ''}`)),
      h('button', { class: 'btn sec chico', onclick: async () => { if (await confirmar('Borrar', `¿Borrar este ${a.tipo}?`, 'Borrar', true) && await intentar(() => DEL(`/ajustes-sueldo/${a.id}`), 'Borrado')) otra(); } }, 'Borrar')))) : h('p', { class: 'suave' }, 'No hay adelantos ni bonos pendientes.'),
    h('h2', {}, 'Planillas anteriores'),
    planillas.length ? h('div', { class: 'tarjeta' }, planillas.filter((p) => p.estado === 'cerrada').map((p) => h('div', { class: 'linea' }, h('span', {}, `${fechaCorta(p.periodo_inicio)} al ${fechaCorta(p.periodo_fin)}`), h('b', { class: 'mono' }, bs(p.total)), h('button', { class: 'btn sec chico', onclick: () => detallePlanilla(p.id) }, 'Ver')))) : h('p', { class: 'suave' }, 'Todavía no cerraste ninguna.'));
}

async function detallePlanilla(id) {
  const r = await intentar(() => GET(`/planillas/${id}`));
  if (!r) return;
  modal(`Planilla ${fechaCorta(r.planilla.periodo_inicio)} al ${fechaCorta(r.planilla.periodo_fin)}`, h('div', { class: 'col' },
    tabla(['Persona', 'Días', 'Faltas', 'A pagar', ''], r.detalles.map((d) => [d.nombre, d.dias_trabajados, d.faltas, h('b', {}, bs(d.total_pagar)), h('button', { class: 'btn sec chico', onclick: () => boleta(id, d.empleado_id) }, 'Boleta')]), [1, 2, 3]),
    h('div', { class: 'fila sep' }, h('span', {}, 'Total'), h('b', { class: 'grande-num' }, bs(r.total)))));
}
async function boleta(planillaId, empleadoId) {
  const r = await intentar(() => GET(`/planillas/${planillaId}/boleta/${empleadoId}`));
  if (!r) return;
  const d = r.detalle;
  const lineas = [`BOLETA DE PAGO`, `${d.nombre}`, `Periodo: ${fechaCorta(r.planilla.periodo_inicio)} al ${fechaCorta(r.planilla.periodo_fin)}`, '-'.repeat(34),
    `Pago base:          ${bs(d.monto_base)}`, `Días trabajados:    ${d.dias_trabajados}`, `Faltas:             ${d.faltas}  (${bs(d.descuento_faltas)})`, `Atrasos:            ${d.minutos_atraso} min  (${bs(d.descuento_atrasos)})`,
    `Adelantos:          ${bs(d.adelantos)}`, `Bonos:              ${bs(d.bonos)}`, '-'.repeat(34), `TOTAL A PAGAR:      ${bs(d.total_pagar)}`, '', 'Firma: ____________________'].join('\n');
  const m = modal('Boleta', h('div', { class: 'col' }, h('pre', { class: 'ticket' }, lineas),
    r.dias.some((x) => x.estado === 'falta' || x.minutos_atraso > 0) && h('div', { class: 'suave' }, r.dias.filter((x) => x.estado === 'falta' || x.minutos_atraso > 0).map((x) => h('div', {}, `${fechaCorta(x.fecha)}: ${x.estado === 'falta' ? (x.falta_justificada ? 'falta justificada' : 'falta') : `llegó ${x.minutos_atraso} min tarde`}`))),
    h('div', { class: 'fila' }, h('button', { class: 'btn', onclick: () => imprimir([lineas]) }, 'Imprimir'), h('button', { class: 'btn sec', onclick: () => m.cerrar() }, 'Cerrar'))));
}

// ------------------------------------------------------------------ REGISTRO DEL DÍA (y cierre)
let diaVista = null;
export async function pantallaDia(el) {
  diaVista = diaVista || hoyISO();
  const otra = () => recargar(el, pantallaDia);
  let r;
  try { r = await GET(`/registro-dia?fecha=${diaVista}`); } catch (e) {
    if (e.estado !== 404) throw e;
    poner(el, selectorDia(otra), h('div', { class: 'tarjeta suave' }, 'Ese día no tiene registro (no se abrió la caja).'));
    return;
  }
  const s = r.resumen;
  const abierta = s.estado === 'abierta';
  poner(el, h('h1', {}, 'Registro del día'), selectorDia(otra),
    h('div', { class: 'tarjeta col' }, r.frases.map((f) => h('div', { style: 'font-size:1.1rem;font-weight:600' }, f))),
    h('div', { class: 'tarjeta' }, h('h3', {}, 'Cuadre del pollo'),
      fila('Presas abiertas (10 por pollo) × precio', bs(r.cuadre.deberia_ser)), fila('Vendido en platos', bs(r.cuadre.vendido_en_platos)), fila('Recargos (pura papa, etc.)', bs(r.cuadre.recargos_cobrados)),
      fila('Pérdidas y consumo del personal (valor de referencia)', bs(r.cuadre.perdidas_valoradas)),
      h('div', { class: `aviso ${r.cuadre.cuadra ? 'ok' : 'alerta'}` }, r.cuadre.cuadra ? 'Todas las presas están explicadas.' : abierta ? `Aún quedan ${r.cuadre.sin_explicar_presas} presa(s) por vender o explicar.` : `Faltan explicar ${r.cuadre.sin_explicar_presas} presa(s) (${bs(r.cuadre.sin_explicar_valor)}). Si sobraron sin vender, es pollo cocido que queda.`)),
    h('div', { class: 'tarjeta' }, h('h3', {}, 'Dinero'), fila('Vendido en efectivo', bs(s.venta_efectivo)), fila('Vendido por QR', bs(s.venta_qr)), fila('Total vendido', bs(s.venta_total), true), fila('Gastos', '− ' + bs(s.gastos)), fila('Queda del día', bs(s.queda_del_dia), true), fila('Cambio con el que empezó', bs(s.fondo_inicial)), s.fondo_para_manana !== null && fila('Cambio que quedó para mañana', bs(s.fondo_para_manana))),
    h('div', { class: 'tarjeta' }, h('h3', {}, 'Piezas'), tabla(['Pieza', 'Abiertas', 'Vendidas', 'Perdidas', 'Quedan'], r.piezas.map((p) => [p.nombre, p.abiertas, p.vendidas, p.perdidas, h('b', {}, p.restante)]), [1, 2, 3, 4])),
    r.gaseosas_vendidas.length > 0 && h('div', { class: 'tarjeta' }, h('h3', {}, 'Gaseosas vendidas'), tabla(['Gaseosa', 'Cantidad', 'Monto'], r.gaseosas_vendidas.map((g) => [`${g.marca} ${g.tamano}`, g.cantidad, bs(g.monto)]), [1, 2])),
    h('div', { class: 'tarjeta' }, h('h3', {}, 'Cajas (quién atendió)'), r.sesiones_caja.length ? tabla(['Persona', 'Horario', 'Esperado', 'Contado', 'Diferencia'], r.sesiones_caja.map((c) => [h('span', {}, h('b', {}, c.nombre), h('small', { class: 'suave' }, ` ${c.funcion}`)), c.fin ? `${hora(c.inicio)}–${hora(c.fin)}` : `desde ${hora(c.inicio)}`, c.funcion === 'Encargada' && c.estado === 'cerrada' ? bs(c.efectivo_esperado) : '—', c.funcion === 'Encargada' && c.estado === 'cerrada' ? bs(c.efectivo_contado) : '—', c.funcion === 'Encargada' && c.estado === 'cerrada' ? h('span', { class: `chip ${num(c.diferencia) === 0 ? 'ok' : 'alerta'}` }, num(c.diferencia) === 0 ? 'Cuadra' : (num(c.diferencia) < 0 ? 'Falta ' : 'Sobra ') + bs(Math.abs(num(c.diferencia))) + (c.motivo_diferencia ? ` · ${c.motivo_diferencia}` : '')) : c.estado === 'abierta' ? h('span', { class: 'chip' }, 'Abierta') : '—'])) : h('p', { class: 'suave' }, 'Nadie abrió caja.')),
    r.gastos.length > 0 && h('div', { class: 'tarjeta' }, h('h3', {}, 'Gastos'), r.gastos.map((g) => fila(`${g.concepto} (${g.registrado_por})`, bs(g.monto)))),
    r.perdidas.length > 0 && h('div', { class: 'tarjeta' }, h('h3', {}, 'Pérdidas'), r.perdidas.map((p) => fila(`${p.cantidad} × ${p.producto} — ${MOTIVOS[p.motivo]}`, p.registrado_por))),
    abierta ? h('button', { class: 'btn grande bloque', onclick: () => cerrarDia(s, otra) }, 'Cerrar el día') : h('button', { class: 'btn sec bloque', onclick: async () => {
      const d = await preguntar('Reabrir el día', [{ nombre: 'motivo', etiqueta: '¿Por qué lo reabres?' }], 'Reabrir');
      if (d && await intentar(() => POST('/jornada/reabrir', { fecha: s.fecha, motivo: d.motivo.trim() }), 'Día reabierto')) otra();
    } }, 'Reabrir este día'));
}
function selectorDia(otra) {
  return h('div', { class: 'tarjeta fila sep' }, h('button', { class: 'btn sec chico', onclick: () => { diaVista = sumaDias(diaVista, -1); otra(); } }, '‹'), h('input', { type: 'date', value: diaVista, max: hoyISO(), style: 'max-width:200px', onchange: (e) => { if (e.target.value) { diaVista = e.target.value; otra(); } } }), h('button', { class: 'btn sec chico', disabled: diaVista >= hoyISO(), onclick: () => { diaVista = sumaDias(diaVista, 1); otra(); } }, '›'));
}
async function cerrarDia(s, otra) {
  const p = await GET('/pollos');
  const d = await preguntar('Cerrar el día', [
    { nombre: 'pollos', etiqueta: 'Pollos crudos que quedan para mañana (cuéntalos)', tipo: 'entero', valor: p.pollos_crudos },
    { nombre: 'fondo', etiqueta: 'Efectivo que dejas como cambio para mañana (Bs)', tipo: 'dinero', valor: '100' },
  ], 'Cerrar el día', 'Antes de cerrar, todas las cajas deben estar cerradas. Quien no marcó asistencia teniendo turno asignado queda con falta.');
  if (!d) return;
  let cuerpo; try { cuerpo = { fecha: s.fecha, pollos_manana: aEntero(d.pollos, 'pollos'), fondo_manana: aMonto(d.fondo) }; } catch (e) { return falla(e); }
  const r = await intentar(() => POST('/jornada/cerrar', cuerpo));
  if (!r) return;
  aviso(`Día cerrado.${r.diferencia_pollos ? ` Se corrigió el stock de pollos (${r.diferencia_pollos > 0 ? '+' : ''}${r.diferencia_pollos}).` : ''}${r.faltas_generadas ? ` ${r.faltas_generadas} falta(s) anotada(s).` : ''}`);
  otra();
}

// ------------------------------------------------------------------ MÁS / REGLAS Y PRECIOS / BITÁCORA
export async function pantallaMas(el, { salir }) {
  const enlace = (href, ico, t) => h('a', { href, class: 'opcion', style: 'text-decoration:none;color:inherit;display:block' }, h('span', { style: 'font-size:1.6rem' }, ico), h('div', {}, t));
  poner(el, h('h1', {}, 'Más'), h('div', { class: 'grid ancho' }, enlace('#/precios', '🏷️', 'Precios y menú'), enlace('#/reglas', '📏', 'Reglas del personal y turnos'), enlace('#/bitacora', '🔍', 'Bitácora (quién cambió qué)'), enlace('#/pedidos', '📞', 'Pedidos por llamada'), enlace('#/ventas', '🧾', 'Ventas de hoy'), enlace('#/perdidas', '🍗', 'Anotar pérdidas'), enlace('#/gastos', '🛒', 'Gastos'), enlace('#/micaja', '💰', 'Mi caja'),
    h('button', { class: 'opcion', onclick: async () => {
      const d = await preguntar('Cambiar mi contraseña', [{ nombre: 'a', etiqueta: 'Contraseña actual', tipo: 'password' }, { nombre: 'b', etiqueta: 'Contraseña nueva (mínimo 8 caracteres)', tipo: 'password' }]);
      if (d) await intentar(() => POST('/empleados/mi-clave', { clave_actual: d.a, clave_nueva: d.b }), 'Contraseña cambiada');
    } }, h('span', { style: 'font-size:1.6rem' }, '🔑'), h('div', {}, 'Cambiar mi contraseña')),
    h('button', { class: 'opcion', onclick: salir }, h('span', { style: 'font-size:1.6rem' }, '🚪'), h('div', {}, 'Salir'))));
}

export async function pantallaPrecios(el) {
  const m = await GET('/menu');
  const otra = () => recargar(el, pantallaPrecios);
  poner(el, h('h1', {}, 'Precios y menú'),
    h('h2', {}, 'Presas'), h('div', { class: 'tarjeta' }, m.presas.map((p) => h('div', { class: 'linea', style: p.activo ? '' : 'opacity:.5' }, h('span', {}, h('b', {}, p.nombre), h('small', { class: 'suave' }, ` · ${p.cantidad_por_pollo} por pollo`)), h('span', { class: 'fila' }, h('b', { class: 'mono' }, bs(p.precio)),
      h('button', { class: 'btn sec chico', onclick: async () => {
        const d = await preguntar(p.nombre, [{ nombre: 'precio', etiqueta: 'Precio (Bs)', tipo: 'dinero', valor: p.precio }, { nombre: 'activo', etiqueta: 'Se vende', tipo: 'check', valor: p.activo }]);
        if (!d) return; let precio; try { precio = aMonto(d.precio); } catch (e) { return falla(e); }
        if (await intentar(() => PATCH(`/menu/piezas/${p.id}`, { precio, activo: d.activo }), 'Guardado')) otra();
      } }, 'Cambiar')))),
      h('p', { class: 'suave' }, 'Los precios nuevos valen desde la próxima venta; las ventas anteriores no cambian.')),
    h('h2', {}, 'Aumentos'), h('div', { class: 'tarjeta' }, m.aumentos.map((a) => h('div', { class: 'linea' }, h('span', {}, a.nombre, h('small', { class: 'suave' }, ` · ${a.cantidad_por_pollo} por pollo`)), h('button', { class: `btn chico ${a.activo ? '' : 'sec'}`, onclick: async () => { if (await intentar(() => PATCH(`/menu/piezas/${a.id}`, { activo: !a.activo }), 'Guardado')) otra(); } }, a.activo ? 'Se da' : 'No se da')))),
    h('h2', {}, 'Papa, arroz y plátano'), h('div', { class: 'tarjeta' }, m.acompanamientos.map((a) => h('div', { class: 'linea', style: a.activo ? '' : 'opacity:.5' }, h('span', {}, h('b', {}, a.nombre), h('small', { class: 'suave' }, a.precio_porcion === null ? ' · no se vende aparte' : ` · porción ${bs(a.precio_porcion)}`)),
      h('button', { class: 'btn sec chico', onclick: async () => {
        const d = await preguntar(a.nombre, [{ nombre: 'precio', etiqueta: 'Precio de la porción aparte (Bs). Déjalo vacío si no se vende aparte', tipo: 'dinero', valor: a.precio_porcion ?? '', requerido: false }, { nombre: 'activo', etiqueta: 'Viene en el plato', tipo: 'check', valor: a.activo }]);
        if (!d) return; let precio = null; try { if (d.precio.trim()) precio = aMonto(d.precio); } catch (e) { return falla(e); }
        if (await intentar(() => PATCH(`/menu/acompanamientos/${a.id}`, { precio_porcion: precio, activo: d.activo }), 'Guardado')) otra();
      } }, 'Cambiar')))),
    m.reglas.map((r) => h('div', { class: 'tarjeta fila sep' }, h('span', {}, h('b', {}, r.nombre), h('small', { class: 'suave' }, ` · +${bs(r.recargo)} al plato`)), h('span', { class: 'fila' }, h('button', { class: `btn chico ${r.activo ? 'ok' : 'sec'}`, onclick: async () => { if (await intentar(() => PATCH(`/menu/reglas/${r.id}`, { activo: !r.activo }), 'Guardado')) otra(); } }, r.activo ? 'Activa' : 'Apagada'),
      h('button', { class: 'btn sec chico', onclick: async () => { const d = await preguntar(r.nombre, [{ nombre: 'recargo', etiqueta: 'Recargo (Bs)', tipo: 'dinero', valor: r.recargo }]); if (!d) return; let recargo; try { recargo = aMonto(d.recargo); } catch (e) { return falla(e); } if (await intentar(() => PATCH(`/menu/reglas/${r.id}`, { recargo }), 'Guardado')) otra(); } }, 'Monto')))));
}

const ETIQUETAS_REGLA = { tolerancia_minutos: ['Minutos de tolerancia al llegar', 'min'], descuento_por_minuto_atraso: ['Descuento por cada minuto de atraso', 'Bs'], dias_mes_sueldo: ['Días que se usan para dividir un sueldo mensual', 'días'], margen_diferencia_caja: ['Diferencia de caja que se acepta sin explicar', 'Bs'], stock_minimo_gaseosa: ['Avisar cuando queden pocas gaseosas (por defecto)', 'unid.'] };
export async function pantallaReglas(el) {
  const [{ reglas }, { turnos }] = await Promise.all([GET('/configuracion'), GET('/turnos')]);
  const otra = () => recargar(el, pantallaReglas);
  const form = h('form', { class: 'tarjeta col', onsubmit: async (e) => {
    e.preventDefault();
    const cuerpo = {}; for (const r of reglas) cuerpo[r.clave] = e.currentTarget.elements[r.clave].value.replace(',', '.').trim();
    if (await intentar(() => PUT('/configuracion', cuerpo), 'Reglas guardadas')) otra();
  } }, reglas.map((r) => h('div', {}, h('label', {}, `${ETIQUETAS_REGLA[r.clave]?.[0] || r.descripcion} (${ETIQUETAS_REGLA[r.clave]?.[1] || ''})`), h('input', { name: r.clave, value: r.valor, inputmode: 'decimal' }))), h('button', { class: 'btn', type: 'submit' }, 'Guardar reglas'));
  poner(el, h('h1', {}, 'Reglas del personal'), h('p', { class: 'suave' }, 'Con descuento por minuto en 0, los atrasos se anotan pero no se descuentan.'), form,
    h('div', { class: 'fila sep' }, h('h2', {}, 'Turnos'), h('button', { class: 'btn chico', onclick: () => formTurno(null, otra) }, '+ Nuevo turno')),
    h('div', { class: 'tarjeta' }, turnos.map((t) => h('div', { class: 'linea', style: t.activo ? '' : 'opacity:.5' }, h('span', {}, h('b', {}, t.nombre), ` ${t.hora_inicio} a ${t.hora_fin}`), h('button', { class: 'btn sec chico', onclick: () => formTurno(t, otra) }, 'Editar')))));
}
async function formTurno(t, otra) {
  const d = await preguntar(t ? `Turno ${t.nombre}` : 'Nuevo turno', [{ nombre: 'nombre', etiqueta: 'Nombre', valor: t?.nombre }, { nombre: 'ini', etiqueta: 'Entrada', tipo: 'time', valor: t?.hora_inicio || '09:00' }, { nombre: 'fin', etiqueta: 'Salida', tipo: 'time', valor: t?.hora_fin || '18:00' }, ...(t ? [{ nombre: 'activo', etiqueta: 'Se usa', tipo: 'check', valor: t.activo }] : [])]);
  if (!d) return;
  const cuerpo = { nombre: d.nombre.trim(), hora_inicio: d.ini, hora_fin: d.fin }; if (t) cuerpo.activo = d.activo;
  if (await intentar(() => (t ? PATCH(`/turnos/${t.id}`, cuerpo) : POST('/turnos', cuerpo)), 'Guardado')) otra();
}

export async function pantallaBitacora(el) {
  const { registros } = await GET('/bitacora?limite=150');
  const ACCIONES = { crear: 'creó', editar: 'cambió', anular: 'anuló', borrar: 'borró', cerrar_dia: 'cerró el día', reabrir_dia: 'reabrió el día', cerrar_planilla: 'cerró la planilla', cambiar_clave: 'cambió su contraseña' };
  poner(el, h('h1', {}, 'Bitácora'), h('p', { class: 'suave' }, 'Todo cambio importante queda anotado aquí y no se puede borrar.'),
    registros.map((r) => h('div', { class: 'tarjeta' }, h('div', { class: 'fila sep' }, h('b', {}, `${r.quien || 'Sistema'} ${ACCIONES[r.accion] || r.accion}`), h('small', { class: 'suave' }, `${fechaCorta(r.fecha_hora)} ${hora(r.fecha_hora)}`)),
      h('div', { class: 'suave' }, `${r.entidad}${r.entidad_id ? ' #' + r.entidad_id : ''}`),
      (r.valor_anterior || r.valor_nuevo) && h('details', {}, h('summary', {}, 'Ver detalle'), r.valor_anterior && h('pre', { class: 'ticket' }, 'Antes: ' + JSON.stringify(r.valor_anterior, null, 1)), r.valor_nuevo && h('pre', { class: 'ticket' }, 'Después: ' + JSON.stringify(r.valor_nuevo, null, 1))))));
}

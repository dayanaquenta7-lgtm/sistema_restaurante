// El "Registro del día": lo que el dueño quiere ver, calculado por el sistema.
const { pool, uno } = require('../db');
const { ErrorApp } = require('../util/errores');
const { bs } = require('../util/validacion');

const num = (v) => Number(v || 0);
const plural = (n, uno_, varios) => `${n} ${n === 1 ? uno_ : varios}`;

async function registroDia(fecha) {
  const resumen = uno((await pool.query('SELECT * FROM v_registro_dia WHERE fecha = ?', [fecha]))[0]);
  if (!resumen) throw new ErrorApp(404, 'No hay registro de ese día');
  const jid = resumen.jornada_id;

  const [piezas] = await pool.query(
    `SELECT c.tipo_pieza_id, c.nombre, c.categoria, c.precio, c.abiertas, c.vendidas, c.perdidas, c.ajustes, c.restante
       FROM v_cuadre_piezas c JOIN tipos_pieza p ON p.id = c.tipo_pieza_id
      WHERE c.jornada_id = ? ORDER BY p.orden`,
    [jid]
  );

  const valoracion = uno(
    (
      await pool.query(
        `SELECT COALESCE(SUM(abiertas * precio), 0)  AS deberia_ser,
                COALESCE(SUM(vendidas * precio), 0)  AS vendidas_valor,
                COALESCE(SUM(perdidas * precio), 0)  AS perdidas_valor,
                COALESCE(SUM(restante * precio), 0)  AS sin_explicar_valor
           FROM v_cuadre_piezas WHERE jornada_id = ? AND categoria = 'presa'`,
        [jid]
      )
    )[0]
  );

  const [sesiones] = await pool.query('SELECT * FROM v_sesiones_caja_admin WHERE fecha = ? ORDER BY inicio', [fecha]);
  const [gastos] = await pool.query(
    `SELECT g.id, g.concepto, g.monto, g.creado_en, e.nombre AS registrado_por
       FROM gastos g LEFT JOIN empleados e ON e.id = g.registrado_por
      WHERE g.jornada_id = ? AND g.anulado = 0 ORDER BY g.id`,
    [jid]
  );
  const [perdidas] = await pool.query(
    `SELECT pe.id, pe.motivo, pe.cantidad, pe.nota, pe.creado_en,
            COALESCE(t.nombre, CONCAT(g.marca, ' ', g.tamano)) AS producto, e.nombre AS registrado_por
       FROM perdidas pe
       LEFT JOIN tipos_pieza t ON t.id = pe.tipo_pieza_id
       LEFT JOIN gaseosas g ON g.id = pe.gaseosa_id
       LEFT JOIN empleados e ON e.id = pe.registrado_por
      WHERE pe.jornada_id = ? AND pe.anulada = 0 ORDER BY pe.id`,
    [jid]
  );
  const [gaseosasVendidas] = await pool.query(
    `SELECT g.marca, g.tamano, SUM(vi.cantidad) AS cantidad, SUM(vi.subtotal) AS monto
       FROM venta_items vi
       JOIN ventas v ON v.id = vi.venta_id
       JOIN gaseosas g ON g.id = vi.gaseosa_id
      WHERE v.jornada_id = ? AND v.estado = 'valida' AND vi.tipo = 'gaseosa'
      GROUP BY g.id, g.marca, g.tamano ORDER BY g.marca, g.tamano`,
    [jid]
  );
  const cierreCaja = uno(
    (
      await pool.query(
        `SELECT COALESCE(SUM(diferencia), 0) AS diferencia_total, COUNT(*) AS cierres
           FROM sesiones_caja WHERE jornada_id = ? AND es_encargada = 1 AND estado = 'cerrada'`,
        [jid]
      )
    )[0]
  );
  const relevos = uno(
    (
      await pool.query(
        `SELECT COUNT(*) AS con_diferencia FROM traspasos_caja t
           JOIN sesiones_caja s ON s.id = t.sesion_entrega_id
          WHERE s.jornada_id = ? AND t.estado = 'con_diferencia'`,
        [jid]
      )
    )[0]
  );

  const sinExplicar = piezas.filter((p) => p.categoria === 'presa').reduce((a, p) => a + num(p.restante), 0);
  const recargos = num(resumen.ventas_platos) - num(valoracion.vendidas_valor);

  const cuadre = {
    deberia_ser: valoracion.deberia_ser, // todas las presas abiertas × su precio
    vendido_en_platos: valoracion.vendidas_valor,
    recargos_cobrados: recargos.toFixed(2), // p. ej. "pura papa"
    perdidas_valoradas: valoracion.perdidas_valor, // solo para el cuadre; no es dinero que entró ni salió
    sin_explicar_presas: sinExplicar,
    sin_explicar_valor: valoracion.sin_explicar_valor,
    cuadra: sinExplicar === 0,
  };

  const dif = num(cierreCaja.diferencia_total);
  const frases = [
    `Vendiste ${bs(resumen.venta_total)} (efectivo ${bs(resumen.venta_efectivo)}, QR ${bs(resumen.venta_qr)}).`,
    `Usaste ${plural(num(resumen.pollos_usados), 'pollo', 'pollos')} (${plural(num(resumen.presas_abiertas), 'presa', 'presas')}).`,
  ];
  if (num(resumen.presas_perdidas) > 0) {
    frases.push(`Se perdieron o consumió el personal ${plural(num(resumen.presas_perdidas), 'presa', 'presas')} (${bs(valoracion.perdidas_valor)}).`);
  }
  frases.push(
    sinExplicar === 0
      ? 'Todas las presas están explicadas.'
      : `Faltan explicar ${plural(sinExplicar, 'presa', 'presas')} (${bs(valoracion.sin_explicar_valor)}).`
  );
  frases.push(`Gastaste ${bs(resumen.gastos)}. Queda del día: ${bs(resumen.queda_del_dia)}.`);
  if (cierreCaja.cierres > 0) {
    frases.push(dif === 0 ? 'La caja cuadra.' : `En caja ${dif < 0 ? 'faltan' : 'sobran'} ${bs(Math.abs(dif))}.`);
  }

  return {
    resumen,
    cuadre,
    piezas,
    gaseosas_vendidas: gaseosasVendidas,
    sesiones_caja: sesiones,
    gastos,
    perdidas,
    caja: { diferencia_total: cierreCaja.diferencia_total, cierres: cierreCaja.cierres, relevos_con_diferencia: relevos.con_diferencia },
    frases,
  };
}

/** Pantalla de inicio del dueño: lo más importante en frases cortas. */
async function inicioDueno() {
  const hoy = uno((await pool.query('SELECT * FROM v_registro_dia WHERE fecha = CURDATE()'))[0]);
  const pollos = uno((await pool.query('SELECT pollos_crudos FROM v_stock_pollos'))[0]);
  const gas = (await pool.query('SELECT semaforo, stock, marca, tamano, activo FROM v_stock_gaseosas WHERE activo = 1'))[0];
  const atrasos = uno(
    (await pool.query('SELECT COUNT(*) AS n FROM asistencias WHERE fecha = CURDATE() AND minutos_atraso > 0'))[0]
  ).n;
  const adentro = uno(
    (await pool.query('SELECT COUNT(*) AS n FROM asistencias WHERE entrada IS NOT NULL AND salida IS NULL'))[0]
  ).n;
  const cajasAbiertas = uno((await pool.query("SELECT COUNT(*) AS n FROM sesiones_caja WHERE estado = 'abierta'"))[0]).n;
  const sinCerrar = (
    await pool.query("SELECT fecha FROM jornadas WHERE estado = 'abierta' AND fecha < CURDATE() ORDER BY fecha")
  )[0];
  const relevosPendientes = uno(
    (
      await pool.query(
        `SELECT COUNT(*) AS n FROM traspasos_caja t
           JOIN sesiones_caja s ON s.id = t.sesion_entrega_id
           JOIN jornadas j ON j.id = s.jornada_id
          WHERE t.estado = 'con_diferencia' AND j.fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
      )
    )[0]
  ).n;

  const totalGaseosas = gas.reduce((a, g) => a + num(g.stock), 0);
  const alertas = [];
  for (const j of sinCerrar) alertas.push({ nivel: 'amarillo', mensaje: `El día ${j.fecha} quedó sin cerrar.` });
  for (const g of gas.filter((x) => x.semaforo === 'rojo')) alertas.push({ nivel: 'rojo', mensaje: `Se acabó la gaseosa ${g.marca} ${g.tamano}.` });
  for (const g of gas.filter((x) => x.semaforo === 'amarillo')) alertas.push({ nivel: 'amarillo', mensaje: `Quedan pocas ${g.marca} ${g.tamano} (${g.stock}).` });
  if (relevosPendientes > 0) alertas.push({ nivel: 'amarillo', mensaje: `Hay ${plural(relevosPendientes, 'entrega de caja', 'entregas de caja')} con diferencia esta semana.` });

  const frases = [
    hoy ? `Hoy vendiste ${bs(hoy.venta_total)}.` : 'Hoy todavía no se abrió la caja.',
    `Quedan ${plural(num(pollos.pollos_crudos), 'pollo crudo', 'pollos crudos')} y ${plural(totalGaseosas, 'gaseosa', 'gaseosas')}.`,
    atrasos > 0 ? `${plural(atrasos, 'empleado llegó', 'empleados llegaron')} tarde hoy.` : 'Nadie llegó tarde hoy.',
  ];

  return {
    frases,
    vendido_hoy: hoy ? hoy.venta_total : '0.00',
    pollos_crudos: num(pollos.pollos_crudos),
    gaseosas_total: totalGaseosas,
    atrasos_hoy: atrasos,
    personal_adentro: adentro,
    cajas_abiertas: cajasAbiertas,
    alertas,
  };
}

module.exports = { registroDia, inicioDueno };

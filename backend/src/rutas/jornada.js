// Cierre del día, historial y "Registro del día" del dueño.
const express = require('express');
const { z, dinero, entero, fecha, texto } = require('../util/validacion');
const { pool, conUsuario, uno } = require('../db');
const { envolver, ErrorApp } = require('../util/errores');
const { soloDueno } = require('../middleware/auth');
const { registroDia, inicioDueno } = require('../servicios/registro');

const router = express.Router();

const hoy = async () => uno((await pool.query('SELECT CURDATE() AS d'))[0]).d;

router.get(
  '/dueno/inicio',
  soloDueno,
  envolver(async (req, res) => {
    res.json(await inicioDueno());
  })
);

router.get(
  '/registro-dia',
  soloDueno,
  envolver(async (req, res) => {
    const { fecha: dia } = z.object({ fecha: fecha.optional() }).parse(req.query);
    res.json(await registroDia(dia ?? (await hoy())));
  })
);

/** Lista de días anteriores (para elegir cuál ver). */
router.get(
  '/jornadas',
  soloDueno,
  envolver(async (req, res) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(366).default(31) }).parse(req.query);
    const [jornadas] = await pool.query(
      `SELECT fecha, estado, venta_total, venta_efectivo, venta_qr, gastos, queda_del_dia, pollos_usados, presas_sin_explicar
         FROM v_registro_dia ORDER BY fecha DESC LIMIT ?`,
      [limite]
    );
    res.json({ jornadas });
  })
);

/**
 * Cerrar el día. El dueño cuenta los pollos crudos que quedan para mañana (pollos_manana):
 * si el sistema creía otra cantidad, se registra un ajuste con la diferencia.
 * Las personas que tenían turno asignado y no marcaron quedan con falta.
 */
router.post(
  '/jornada/cerrar',
  soloDueno,
  envolver(async (req, res) => {
    const d = z
      .object({ fondo_manana: dinero, pollos_manana: entero(0, 100000).optional(), fecha: fecha.optional() })
      .parse(req.body);

    const j = uno(
      (
        await pool.query(
          d.fecha
            ? 'SELECT id, fecha, estado FROM jornadas WHERE fecha = ?'
            : "SELECT id, fecha, estado FROM jornadas WHERE fecha = CURDATE()",
          d.fecha ? [d.fecha] : []
        )
      )[0]
    );
    if (!j) throw new ErrorApp(404, 'Ese día no tiene registro: no se abrió la caja.');
    if (j.estado !== 'abierta') throw new ErrorApp(409, 'Ese día ya está cerrado.');

    // Los procedimientos guardan por su cuenta, así que se revisa todo ANTES de tocar nada
    const [[cajas]] = await pool.query("SELECT COUNT(*) AS n FROM sesiones_caja WHERE jornada_id = ? AND estado = 'abierta'", [j.id]);
    if (Number(cajas.n) > 0) throw new ErrorApp(409, 'Hay cajas abiertas. Ciérralas antes de cerrar el día.', { codigo: 'CAJAS_ABIERTAS' });

    const resultado = await conUsuario(req.usuario.id, async (cx) => {
      let pollosManana = null;
      let diferenciaPollos = 0;
      const sistema = Number(uno((await cx.query('SELECT pollos_crudos FROM v_stock_pollos'))[0]).pollos_crudos);
      if (d.pollos_manana !== undefined) {
        diferenciaPollos = d.pollos_manana - sistema;
        if (diferenciaPollos !== 0) {
          await cx.query(
            "INSERT INTO movimientos_pollo (jornada_id, tipo, cantidad, registrado_por, nota) VALUES (?, 'ajuste', ?, ?, 'Conteo al cerrar el día')",
            [j.id, diferenciaPollos, req.usuario.id]
          );
        }
        pollosManana = d.pollos_manana;
      } else {
        pollosManana = sistema;
      }
      await cx.query('CALL sp_cerrar_jornada(?, ?, ?, ?)', [j.id, d.fondo_manana, pollosManana, req.usuario.id]);

      // Faltas automáticas: tenían turno asignado ese día y no marcaron nada
      const [faltas] = await cx.query(
        `INSERT INTO asistencias (empleado_id, turno_id, fecha, estado, nota)
         SELECT a.empleado_id, a.turno_id, a.fecha, 'falta', 'No marcó asistencia'
           FROM asignaciones_turno a JOIN empleados e ON e.id = a.empleado_id AND e.activo = 1
          WHERE a.fecha = ? AND NOT EXISTS (
                SELECT 1 FROM asistencias s WHERE s.empleado_id = a.empleado_id AND s.fecha = a.fecha AND s.turno_id = a.turno_id)`,
        [j.fecha]
      );
      return { pollosManana, diferenciaPollos, faltas: faltas.affectedRows };
    });

    res.json({
      ok: true,
      fecha: j.fecha,
      pollos_para_manana: resultado.pollosManana,
      diferencia_pollos: resultado.diferenciaPollos,
      faltas_generadas: resultado.faltas,
    });
  })
);

router.post(
  '/jornada/reabrir',
  soloDueno,
  envolver(async (req, res) => {
    const d = z.object({ fecha: fecha.optional(), motivo: texto(3, 200) }).parse(req.body);
    const j = uno(
      (await pool.query(d.fecha ? 'SELECT id, estado FROM jornadas WHERE fecha = ?' : 'SELECT id, estado FROM jornadas WHERE fecha = CURDATE()', d.fecha ? [d.fecha] : []))[0]
    );
    if (!j) throw new ErrorApp(404, 'Ese día no existe');
    if (j.estado !== 'cerrada') throw new ErrorApp(409, 'Ese día ya está abierto');
    await conUsuario(req.usuario.id, (cx) => cx.query('CALL sp_reabrir_jornada(?, ?, ?)', [j.id, req.usuario.id, d.motivo]));
    res.json({ ok: true });
  })
);

module.exports = router;

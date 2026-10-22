-- =====================================================================
--  Parte 5: lo que necesita la API (sesiones de la app y estimado de planilla)
--  Se ejecuta DESPUÉS de 01, 02 y 03:  npm run db:crear  lo hace todo en orden.
-- =====================================================================
USE broasteria;
SET NAMES utf8mb4;
SET time_zone = '-04:00';

-- Sesiones de la aplicación (quien entró con su PIN). El token real solo vive en la
-- cookie del navegador; aquí se guarda su huella (SHA-256), nunca el token.
CREATE TABLE sesiones_app (
  token_hash  CHAR(64) NOT NULL,
  empleado_id INT UNSIGNED NOT NULL,
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en   DATETIME NOT NULL,
  ip          VARCHAR(45) NULL,
  PRIMARY KEY (token_hash),
  KEY ix_sesapp_emp (empleado_id),
  KEY ix_sesapp_exp (expira_en),
  CONSTRAINT fk_sesapp_emp FOREIGN KEY (empleado_id) REFERENCES empleados(id)
) ENGINE=InnoDB;

DELIMITER $$

-- Muestra cuánto se pagaría HOY a cada persona en un periodo, sin guardar nada.
-- Usa exactamente la misma fórmula de sp_cerrar_planilla (las pruebas comprueban que
-- el estimado y la planilla cerrada den lo mismo).
CREATE PROCEDURE sp_estimar_planilla(IN p_ini DATE, IN p_fin DATE)
BEGIN
  DECLARE v_dias_mes DECIMAL(5,2);
  DECLARE v_tarifa_min DECIMAL(8,4);
  SELECT CAST(valor AS DECIMAL(5,2)) INTO v_dias_mes   FROM configuracion WHERE clave = 'dias_mes_sueldo';
  SELECT CAST(valor AS DECIMAL(8,4)) INTO v_tarifa_min FROM configuracion WHERE clave = 'descuento_por_minuto_atraso';

  SELECT x.id AS empleado_id, x.nombre, x.tipo_pago, x.monto_pago, x.valor_dia,
         x.dias AS dias_trabajados, x.faltas, x.just AS faltas_justificadas, x.atraso AS minutos_atraso,
         x.base AS monto_base, x.desc_faltas AS descuento_faltas, x.desc_atrasos AS descuento_atrasos,
         x.adel AS adelantos, x.bon AS bonos,
         GREATEST(0, x.base - x.desc_faltas - x.desc_atrasos - x.adel + x.bon) AS total_pagar
    FROM (
      SELECT e.id, e.nombre, e.tipo_pago, e.monto_pago,
             ROUND(CASE e.tipo_pago WHEN 'mensual' THEN e.monto_pago / v_dias_mes ELSE e.monto_pago END, 2) AS valor_dia,
             COALESCE(a.dias, 0) AS dias, COALESCE(a.faltas, 0) AS faltas, COALESCE(a.just, 0) AS just,
             COALESCE(a.atraso, 0) AS atraso,
             ROUND(CASE e.tipo_pago
                     WHEN 'mensual' THEN e.monto_pago * LEAST(DATEDIFF(p_fin, p_ini) + 1, v_dias_mes) / v_dias_mes
                     ELSE COALESCE(a.dias, 0) * e.monto_pago END, 2) AS base,
             ROUND(CASE e.tipo_pago
                     WHEN 'mensual' THEN COALESCE(a.faltas, 0) * (e.monto_pago / v_dias_mes)
                     ELSE 0 END, 2) AS desc_faltas,
             ROUND(COALESCE(a.atraso, 0) * v_tarifa_min, 2) AS desc_atrasos,
             COALESCE(aj.adel, 0) AS adel, COALESCE(aj.bon, 0) AS bon
        FROM empleados e
        LEFT JOIN (
          SELECT empleado_id,
                 SUM(estado = 'presente') AS dias,
                 SUM(estado = 'falta' AND falta_justificada = 0) AS faltas,
                 SUM(estado = 'falta' AND falta_justificada = 1) AS just,
                 SUM(minutos_atraso) AS atraso
            FROM asistencias WHERE fecha BETWEEN p_ini AND p_fin GROUP BY empleado_id
        ) a ON a.empleado_id = e.id
        LEFT JOIN (
          SELECT empleado_id,
                 SUM(CASE WHEN tipo = 'adelanto' THEN monto ELSE 0 END) AS adel,
                 SUM(CASE WHEN tipo = 'bono' THEN monto ELSE 0 END) AS bon
            FROM ajustes_sueldo WHERE planilla_id IS NULL AND fecha BETWEEN p_ini AND p_fin GROUP BY empleado_id
        ) aj ON aj.empleado_id = e.id
       WHERE e.activo = 1 AND e.rol <> 'dueno'
    ) x
   ORDER BY x.nombre;
END$$

DELIMITER ;

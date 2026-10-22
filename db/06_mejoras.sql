-- =====================================================================
--  Parte 6: mejoras (se puede ejecutar muchas veces sin problema)
--  El servidor la aplica sola al arrancar, así que quien ya tiene su base
--  creada recibe las mejoras sin perder ningún dato.
-- =====================================================================
USE broasteria;
SET NAMES utf8mb4;

-- El dueño puede atender sin marcar asistencia (no cobra sueldo por planilla).
-- Los demás ya no necesitan ir a la tablet primero: el sistema marca su llegada al "Empezar mi turno".
DROP PROCEDURE IF EXISTS sp_abrir_sesion_caja;
DELIMITER $$
CREATE PROCEDURE sp_abrir_sesion_caja(IN p_empleado INT, IN p_es_encargada TINYINT,
                                      IN p_fondo_recibido DECIMAL(10,2), OUT p_sesion INT)
BEGIN
  DECLARE v_jornada INT;
  DECLARE v_esperado DECIMAL(10,2) DEFAULT NULL;
  DECLARE v_traspaso INT DEFAULT NULL;
  DECLARE v_rol VARCHAR(20);
  DECLARE v_fondo_ayer DECIMAL(10,2) DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  SELECT rol INTO v_rol FROM empleados WHERE id = p_empleado AND activo = 1;
  IF v_rol IS NULL OR v_rol = 'solo_asistencia' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Esta persona no puede atender en caja';
  END IF;
  IF v_rol <> 'dueno' AND NOT EXISTS (SELECT 1 FROM asistencias WHERE empleado_id = p_empleado AND entrada IS NOT NULL AND salida IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Primero marca tu llegada en la tablet';
  END IF;

  -- La jornada de hoy se crea sola con el fondo que se dejó ayer
  SELECT id INTO v_jornada FROM jornadas WHERE fecha = CURDATE();
  IF v_jornada IS NULL THEN
    -- (MySQL no permite leer la misma tabla dentro del INSERT: se lee primero)
    SELECT COALESCE(fondo_para_manana, 0) INTO v_fondo_ayer FROM jornadas
     WHERE estado = 'cerrada' AND fecha < CURDATE() ORDER BY fecha DESC LIMIT 1;
    INSERT INTO jornadas (fecha, fondo_inicial) VALUES (CURDATE(), v_fondo_ayer);
    SET v_jornada = LAST_INSERT_ID();
  END IF;
  IF (SELECT estado FROM jornadas WHERE id = v_jornada) <> 'abierta' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El día de hoy ya fue cerrado';
  END IF;

  IF p_es_encargada = 1 THEN
    IF EXISTS (SELECT 1 FROM sesiones_caja WHERE jornada_id = v_jornada AND estado = 'abierta' AND es_encargada = 1) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ya hay una encargada con la caja abierta: debe cerrarla primero';
    END IF;
    -- ¿Hay un relevo esperando? Si no, es la primera caja del día.
    SELECT t.id, t.monto_entregado INTO v_traspaso, v_esperado
      FROM traspasos_caja t JOIN sesiones_caja s ON s.id = t.sesion_entrega_id
     WHERE s.jornada_id = v_jornada AND t.estado = 'pendiente'
     ORDER BY t.id DESC LIMIT 1;
    IF v_traspaso IS NULL THEN
      SELECT fondo_inicial INTO v_esperado FROM jornadas WHERE id = v_jornada;
    END IF;
  END IF;

  INSERT INTO sesiones_caja (jornada_id, empleado_id, es_encargada, fondo_esperado, fondo_recibido)
  VALUES (v_jornada, p_empleado, p_es_encargada, v_esperado,
          IF(p_es_encargada = 1, p_fondo_recibido, NULL));
  SET p_sesion = LAST_INSERT_ID();

  IF v_traspaso IS NOT NULL THEN
    UPDATE traspasos_caja
       SET sesion_recibe_id = p_sesion, monto_recibido = p_fondo_recibido,
           diferencia = p_fondo_recibido - monto_entregado, recibido_en = NOW(),
           estado = IF(p_fondo_recibido = monto_entregado, 'confirmado', 'con_diferencia')
     WHERE id = v_traspaso;
  END IF;
  COMMIT;
END$$
DELIMITER ;

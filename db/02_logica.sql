-- =====================================================================
--  Parte 2: lógica que vive en la base de datos
--  (triggers y procedimientos). Garantiza que las reglas se cumplan
--  aunque la app tenga un error: el stock se descuenta solo, los
--  totales los calcula la base, los días y planillas cerrados no se
--  tocan y la bitácora no se puede alterar.
--
--  La app Node.js, antes de cada operación sensible, debe ejecutar:
--      SET @usuario_id = <id del empleado que está operando>;
--  para que la bitácora sepa quién fue.
-- =====================================================================
USE broasteria;
SET NAMES utf8mb4;
SET time_zone = '-04:00';

DELIMITER $$

-- ---------------------------------------------------------------------
-- A. BITÁCORA INALTERABLE
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_bitacora_bu BEFORE UPDATE ON bitacora FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La bitácora no se puede modificar';
END$$

CREATE TRIGGER trg_bitacora_bd BEFORE DELETE ON bitacora FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La bitácora no se puede borrar';
END$$

-- ---------------------------------------------------------------------
-- B. AUDITORÍA AUTOMÁTICA de precios, sueldos y reglas
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_empleados_au AFTER UPDATE ON empleados FOR EACH ROW
BEGIN
  IF NOT (OLD.monto_pago <=> NEW.monto_pago) OR NOT (OLD.tipo_pago <=> NEW.tipo_pago)
     OR NOT (OLD.activo <=> NEW.activo) OR NOT (OLD.rol <=> NEW.rol)
     OR NOT (OLD.turno_habitual_id <=> NEW.turno_habitual_id) OR NOT (OLD.pin_hmac <=> NEW.pin_hmac) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'editar', 'empleados', NEW.id,
      JSON_OBJECT('monto_pago', OLD.monto_pago, 'tipo_pago', OLD.tipo_pago, 'activo', OLD.activo,
                  'rol', OLD.rol, 'turno', OLD.turno_habitual_id, 'pin_cambiado', NOT (OLD.pin_hmac <=> NEW.pin_hmac)),
      JSON_OBJECT('monto_pago', NEW.monto_pago, 'tipo_pago', NEW.tipo_pago, 'activo', NEW.activo,
                  'rol', NEW.rol, 'turno', NEW.turno_habitual_id, 'pin_cambiado', NOT (OLD.pin_hmac <=> NEW.pin_hmac)));
  END IF;
END$$

CREATE TRIGGER trg_gaseosas_au AFTER UPDATE ON gaseosas FOR EACH ROW
BEGIN
  IF NOT (OLD.precio <=> NEW.precio) OR NOT (OLD.activo <=> NEW.activo) OR NOT (OLD.stock_minimo <=> NEW.stock_minimo) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'editar', 'gaseosas', NEW.id,
      JSON_OBJECT('gaseosa', CONCAT(OLD.marca, ' ', OLD.tamano), 'precio', OLD.precio, 'activo', OLD.activo, 'stock_minimo', OLD.stock_minimo),
      JSON_OBJECT('gaseosa', CONCAT(NEW.marca, ' ', NEW.tamano), 'precio', NEW.precio, 'activo', NEW.activo, 'stock_minimo', NEW.stock_minimo));
  END IF;
END$$

CREATE TRIGGER trg_tipos_pieza_au AFTER UPDATE ON tipos_pieza FOR EACH ROW
BEGIN
  IF NOT (OLD.precio <=> NEW.precio) OR NOT (OLD.activo <=> NEW.activo) OR NOT (OLD.cantidad_por_pollo <=> NEW.cantidad_por_pollo) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'editar', 'tipos_pieza', NEW.id,
      JSON_OBJECT('pieza', OLD.nombre, 'precio', OLD.precio, 'activo', OLD.activo, 'por_pollo', OLD.cantidad_por_pollo),
      JSON_OBJECT('pieza', NEW.nombre, 'precio', NEW.precio, 'activo', NEW.activo, 'por_pollo', NEW.cantidad_por_pollo));
  END IF;
END$$

CREATE TRIGGER trg_acomp_au AFTER UPDATE ON acompanamientos FOR EACH ROW
BEGIN
  IF NOT (OLD.precio_porcion <=> NEW.precio_porcion) OR NOT (OLD.activo <=> NEW.activo) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'editar', 'acompanamientos', NEW.id,
      JSON_OBJECT('nombre', OLD.nombre, 'precio_porcion', OLD.precio_porcion, 'activo', OLD.activo),
      JSON_OBJECT('nombre', NEW.nombre, 'precio_porcion', NEW.precio_porcion, 'activo', NEW.activo));
  END IF;
END$$

CREATE TRIGGER trg_reglas_au AFTER UPDATE ON reglas_precio FOR EACH ROW
BEGIN
  IF NOT (OLD.recargo <=> NEW.recargo) OR NOT (OLD.activo <=> NEW.activo) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'editar', 'reglas_precio', NEW.id,
      JSON_OBJECT('regla', OLD.nombre, 'recargo', OLD.recargo, 'activo', OLD.activo),
      JSON_OBJECT('regla', NEW.nombre, 'recargo', NEW.recargo, 'activo', NEW.activo));
  END IF;
END$$

CREATE TRIGGER trg_config_au AFTER UPDATE ON configuracion FOR EACH ROW
BEGIN
  IF NOT (OLD.valor <=> NEW.valor) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'editar', 'configuracion', NEW.clave,
      JSON_OBJECT('valor', OLD.valor), JSON_OBJECT('valor', NEW.valor));
  END IF;
END$$

CREATE TRIGGER trg_asistencias_au AFTER UPDATE ON asistencias FOR EACH ROW
BEGIN
  -- Marcar la salida es normal; corregir horas o estado queda registrado
  IF NOT (OLD.entrada <=> NEW.entrada) OR NOT (OLD.estado <=> NEW.estado)
     OR (OLD.salida IS NOT NULL AND NOT (OLD.salida <=> NEW.salida))
     OR NOT (OLD.falta_justificada <=> NEW.falta_justificada) OR NOT (OLD.minutos_atraso <=> NEW.minutos_atraso) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'corregir', 'asistencias', NEW.id,
      JSON_OBJECT('estado', OLD.estado, 'entrada', OLD.entrada, 'salida', OLD.salida,
                  'atraso', OLD.minutos_atraso, 'justificada', OLD.falta_justificada),
      JSON_OBJECT('estado', NEW.estado, 'entrada', NEW.entrada, 'salida', NEW.salida,
                  'atraso', NEW.minutos_atraso, 'justificada', NEW.falta_justificada));
  END IF;
END$$

-- ---------------------------------------------------------------------
-- C. VENTAS: validaciones, precios congelados, totales y stock automáticos
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_ventas_bi BEFORE INSERT ON ventas FOR EACH ROW
BEGIN
  DECLARE v_jor_estado VARCHAR(10);
  DECLARE v_ses_estado VARCHAR(10);
  DECLARE v_ses_enc TINYINT;
  DECLARE v_ses_jor INT;

  SELECT estado INTO v_jor_estado FROM jornadas WHERE id = NEW.jornada_id;
  IF v_jor_estado IS NULL OR v_jor_estado <> 'abierta' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El día está cerrado: no se pueden registrar ventas';
  END IF;

  SELECT estado, es_encargada, jornada_id INTO v_ses_estado, v_ses_enc, v_ses_jor
    FROM sesiones_caja WHERE id = NEW.sesion_caja_id;
  IF v_ses_estado IS NULL OR v_ses_estado <> 'abierta' OR v_ses_enc <> 1 OR v_ses_jor <> NEW.jornada_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La venta debe ir a la caja abierta de la encargada';
  END IF;

  IF NEW.numero = 0 THEN
    SET NEW.numero = (SELECT COALESCE(MAX(numero), 0) + 1 FROM ventas WHERE jornada_id = NEW.jornada_id);
  END IF;
END$$

CREATE TRIGGER trg_venta_items_bi BEFORE INSERT ON venta_items FOR EACH ROW
BEGIN
  DECLARE v_precio DECIMAL(8,2);
  DECLARE v_activo TINYINT;

  -- Validar producto activo y tomar el precio vigente si no se indicó uno
  IF NEW.tipo = 'plato' THEN
    SELECT precio, activo INTO v_precio, v_activo FROM tipos_pieza WHERE id = NEW.tipo_pieza_id AND categoria = 'presa';
    IF NEW.aumento_id IS NOT NULL AND NOT EXISTS
       (SELECT 1 FROM presa_aumento WHERE presa_id = NEW.tipo_pieza_id AND aumento_id = NEW.aumento_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ese aumento no va con esa presa';
    END IF;
  ELSEIF NEW.tipo = 'porcion' THEN
    SELECT precio_porcion, activo INTO v_precio, v_activo FROM acompanamientos WHERE id = NEW.acompanamiento_id;
  ELSE
    SELECT precio, activo INTO v_precio, v_activo FROM gaseosas WHERE id = NEW.gaseosa_id;
  END IF;

  IF v_activo IS NULL OR v_activo = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ese producto no existe o está desactivado';
  END IF;
  IF NEW.precio_base = 0 THEN
    IF v_precio IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ese producto todavía no tiene precio';
    END IF;
    SET NEW.precio_base = v_precio;
  END IF;
END$$

CREATE TRIGGER trg_venta_items_ai AFTER INSERT ON venta_items FOR EACH ROW
BEGIN
  DECLARE v_jornada INT;
  SELECT jornada_id INTO v_jornada FROM ventas WHERE id = NEW.venta_id;

  IF NEW.tipo = 'plato' THEN
    INSERT INTO movimientos_pieza (jornada_id, tipo_pieza_id, tipo, cantidad, venta_item_id, registrado_por)
    VALUES (v_jornada, NEW.tipo_pieza_id, 'venta', -1, NEW.id, @usuario_id);
    IF NEW.aumento_id IS NOT NULL THEN
      INSERT INTO movimientos_pieza (jornada_id, tipo_pieza_id, tipo, cantidad, venta_item_id, registrado_por)
      VALUES (v_jornada, NEW.aumento_id, 'venta', -1, NEW.id, @usuario_id);
    END IF;
  ELSEIF NEW.tipo = 'gaseosa' THEN
    INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, venta_item_id, registrado_por)
    VALUES (NEW.gaseosa_id, 'venta', -NEW.cantidad, NEW.id, @usuario_id);
  END IF;

  UPDATE ventas SET total = (SELECT COALESCE(SUM(subtotal), 0) FROM venta_items WHERE venta_id = NEW.venta_id)
   WHERE id = NEW.venta_id;
END$$

CREATE TRIGGER trg_venta_items_au AFTER UPDATE ON venta_items FOR EACH ROW
BEGIN
  IF NOT (OLD.recargo <=> NEW.recargo) THEN
    UPDATE ventas SET total = (SELECT COALESCE(SUM(subtotal), 0) FROM venta_items WHERE venta_id = NEW.venta_id)
     WHERE id = NEW.venta_id;
  END IF;
END$$

-- Recargo "pura papa": si el plato lleva UN solo acompañamiento y hay una regla activa para él
CREATE TRIGGER trg_via_ai AFTER INSERT ON venta_item_acomp FOR EACH ROW
BEGIN
  DECLARE v_n INT;
  DECLARE v_acomp INT;
  DECLARE v_rec DECIMAL(8,2) DEFAULT 0;
  SELECT COUNT(*), MIN(acompanamiento_id) INTO v_n, v_acomp FROM venta_item_acomp WHERE venta_item_id = NEW.venta_item_id;
  IF v_n = 1 THEN
    SELECT COALESCE(MAX(recargo), 0) INTO v_rec FROM reglas_precio WHERE activo = 1 AND acompanamiento_unico_id = v_acomp;
  END IF;
  UPDATE venta_items SET recargo = v_rec WHERE id = NEW.venta_item_id;
END$$

-- Anular una venta: el stock vuelve solo (con registro), y queda en la bitácora
CREATE TRIGGER trg_ventas_au AFTER UPDATE ON ventas FOR EACH ROW
BEGIN
  IF OLD.estado = 'valida' AND NEW.estado = 'anulada' THEN
    INSERT INTO movimientos_pieza (jornada_id, tipo_pieza_id, tipo, cantidad, venta_item_id, registrado_por)
      SELECT m.jornada_id, m.tipo_pieza_id, 'anulacion_venta', -m.cantidad, m.venta_item_id, @usuario_id
        FROM movimientos_pieza m JOIN venta_items vi ON vi.id = m.venta_item_id
       WHERE vi.venta_id = NEW.id AND m.tipo = 'venta';
    INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, venta_item_id, registrado_por)
      SELECT m.gaseosa_id, 'anulacion_venta', -m.cantidad, m.venta_item_id, @usuario_id
        FROM movimientos_gaseosa m JOIN venta_items vi ON vi.id = m.venta_item_id
       WHERE vi.venta_id = NEW.id AND m.tipo = 'venta';
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (COALESCE(NEW.anulada_por, @usuario_id), 'anular', 'ventas', NEW.id,
            JSON_OBJECT('estado', OLD.estado, 'total', OLD.total),
            JSON_OBJECT('estado', NEW.estado, 'motivo', NEW.motivo_anulacion));
  END IF;
END$$

-- ---------------------------------------------------------------------
-- D. GASTOS Y PÉRDIDAS
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_gastos_bi BEFORE INSERT ON gastos FOR EACH ROW
BEGIN
  DECLARE v_estado VARCHAR(10);
  SELECT estado INTO v_estado FROM jornadas WHERE id = NEW.jornada_id;
  IF v_estado IS NULL OR v_estado <> 'abierta' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El día está cerrado: no se pueden registrar gastos';
  END IF;
END$$

CREATE TRIGGER trg_perdidas_bi BEFORE INSERT ON perdidas FOR EACH ROW
BEGIN
  DECLARE v_estado VARCHAR(10);
  SELECT estado INTO v_estado FROM jornadas WHERE id = NEW.jornada_id;
  IF v_estado IS NULL OR v_estado <> 'abierta' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El día está cerrado: no se pueden registrar pérdidas';
  END IF;
END$$

CREATE TRIGGER trg_perdidas_ai AFTER INSERT ON perdidas FOR EACH ROW
BEGIN
  IF NEW.tipo_pieza_id IS NOT NULL THEN
    INSERT INTO movimientos_pieza (jornada_id, tipo_pieza_id, tipo, cantidad, perdida_id, registrado_por, nota)
    VALUES (NEW.jornada_id, NEW.tipo_pieza_id, 'perdida', -NEW.cantidad, NEW.id, NEW.registrado_por, NEW.motivo);
  ELSE
    INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, perdida_id, registrado_por, nota)
    VALUES (NEW.gaseosa_id, 'perdida', -NEW.cantidad, NEW.id, NEW.registrado_por, NEW.motivo);
  END IF;
END$$

CREATE TRIGGER trg_perdidas_au AFTER UPDATE ON perdidas FOR EACH ROW
BEGIN
  IF OLD.anulada = 0 AND NEW.anulada = 1 THEN
    IF NEW.tipo_pieza_id IS NOT NULL THEN
      INSERT INTO movimientos_pieza (jornada_id, tipo_pieza_id, tipo, cantidad, perdida_id, registrado_por)
      VALUES (NEW.jornada_id, NEW.tipo_pieza_id, 'anulacion_perdida', NEW.cantidad, NEW.id, @usuario_id);
    ELSE
      INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, perdida_id, registrado_por)
      VALUES (NEW.gaseosa_id, 'anulacion_perdida', NEW.cantidad, NEW.id, @usuario_id);
    END IF;
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'anular', 'perdidas', NEW.id,
            JSON_OBJECT('cantidad', OLD.cantidad, 'motivo', OLD.motivo), JSON_OBJECT('anulada', 1));
  END IF;
END$$

-- ---------------------------------------------------------------------
-- E. PLANILLA CERRADA = CONGELADA
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_pd_bu BEFORE UPDATE ON planilla_detalles FOR EACH ROW
BEGIN
  IF (SELECT estado FROM planillas WHERE id = OLD.planilla_id) = 'cerrada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla está cerrada y no se puede modificar';
  END IF;
END$$

CREATE TRIGGER trg_pd_bd BEFORE DELETE ON planilla_detalles FOR EACH ROW
BEGIN
  IF (SELECT estado FROM planillas WHERE id = OLD.planilla_id) = 'cerrada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla está cerrada y no se puede modificar';
  END IF;
END$$

CREATE TRIGGER trg_pd_bi BEFORE INSERT ON planilla_detalles FOR EACH ROW
BEGIN
  IF (SELECT estado FROM planillas WHERE id = NEW.planilla_id) = 'cerrada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla está cerrada y no se puede modificar';
  END IF;
END$$

-- =====================================================================
--  PROCEDIMIENTOS (las operaciones que deben ocurrir completas o no ocurrir)
-- =====================================================================

-- Abrir pollos: baja el stock de pollos crudos y sube las piezas del día
-- (10 presas + 4 aumentos por pollo, según el catálogo).
CREATE PROCEDURE sp_abrir_pollos(IN p_jornada INT, IN p_cantidad INT, IN p_usuario INT)
BEGIN
  DECLARE v_crudos INT;
  DECLARE v_estado VARCHAR(10);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT estado INTO v_estado FROM jornadas WHERE id = p_jornada FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'abierta' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ese día no está abierto';
  END IF;
  IF p_cantidad <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad de pollos debe ser mayor a cero';
  END IF;
  SELECT COALESCE(SUM(cantidad), 0) INTO v_crudos FROM movimientos_pollo FOR UPDATE;
  IF v_crudos < p_cantidad THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No hay tantos pollos crudos en stock';
  END IF;

  INSERT INTO movimientos_pollo (jornada_id, tipo, cantidad, registrado_por)
  VALUES (p_jornada, 'apertura', -p_cantidad, p_usuario);

  INSERT INTO movimientos_pieza (jornada_id, tipo_pieza_id, tipo, cantidad, registrado_por)
    SELECT p_jornada, id, 'apertura', cantidad_por_pollo * p_cantidad, p_usuario
      FROM tipos_pieza WHERE activo = 1;
  COMMIT;
END$$

-- Abrir mi sesión de caja. Exige asistencia abierta (para que nadie atienda sin quedar
-- registrado para el pago). Si es la encargada, recibe el dinero del relevo o del día anterior.
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
  IF NOT EXISTS (SELECT 1 FROM asistencias WHERE empleado_id = p_empleado AND entrada IS NOT NULL AND salida IS NULL) THEN
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

-- Cerrar mi caja: calcula lo que debe haber, compara con lo contado y sella la sesión.
CREATE PROCEDURE sp_cerrar_sesion_caja(IN p_sesion INT, IN p_contado DECIMAL(10,2), IN p_motivo VARCHAR(200))
BEGIN
  DECLARE v_estado VARCHAR(10);
  DECLARE v_enc TINYINT;
  DECLARE v_fondo DECIMAL(10,2);
  DECLARE v_efec DECIMAL(10,2);
  DECLARE v_qr DECIMAL(10,2);
  DECLARE v_gastos DECIMAL(10,2);
  DECLARE v_esp DECIMAL(10,2);
  DECLARE v_dif DECIMAL(10,2);
  DECLARE v_margen DECIMAL(10,2);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT estado, es_encargada, COALESCE(fondo_recibido, 0) INTO v_estado, v_enc, v_fondo
    FROM sesiones_caja WHERE id = p_sesion FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'abierta' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Esa sesión de caja no está abierta';
  END IF;

  IF v_enc = 0 THEN
    -- Quien solo atiende no responde por dinero: solo registra su hora de fin
    UPDATE sesiones_caja SET fin = NOW(), estado = 'cerrada' WHERE id = p_sesion;
  ELSE
    IF p_contado IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Escribe cuánto efectivo contaste';
    END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_efec FROM ventas
     WHERE sesion_caja_id = p_sesion AND estado = 'valida' AND forma_pago = 'efectivo';
    SELECT COALESCE(SUM(total), 0) INTO v_qr FROM ventas
     WHERE sesion_caja_id = p_sesion AND estado = 'valida' AND forma_pago = 'qr';
    SELECT COALESCE(SUM(monto), 0) INTO v_gastos FROM gastos
     WHERE sesion_caja_id = p_sesion AND pagado_de_caja = 1 AND anulado = 0;

    SET v_esp = v_fondo + v_efec - v_gastos;
    SET v_dif = p_contado - v_esp;
    SELECT CAST(valor AS DECIMAL(10,2)) INTO v_margen FROM configuracion WHERE clave = 'margen_diferencia_caja';

    IF ABS(v_dif) > COALESCE(v_margen, 0) AND (p_motivo IS NULL OR TRIM(p_motivo) = '') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hay diferencia en la caja: escribe el motivo';
    END IF;

    UPDATE sesiones_caja
       SET fin = NOW(), ventas_efectivo = v_efec, ventas_qr = v_qr, gastos_caja = v_gastos,
           efectivo_esperado = v_esp, efectivo_contado = p_contado, diferencia = v_dif,
           motivo_diferencia = NULLIF(TRIM(p_motivo), ''), estado = 'cerrada'
     WHERE id = p_sesion;

    -- Queda esperando que la siguiente encargada lo reciba
    INSERT INTO traspasos_caja (sesion_entrega_id, monto_entregado) VALUES (p_sesion, p_contado);
  END IF;
  COMMIT;
END$$

-- Cerrar el día: sin cajas abiertas, deja el cambio y los pollos de mañana, y sella.
CREATE PROCEDURE sp_cerrar_jornada(IN p_jornada INT, IN p_fondo_manana DECIMAL(10,2),
                                   IN p_pollos_manana INT, IN p_usuario INT)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  IF (SELECT estado FROM jornadas WHERE id = p_jornada FOR UPDATE) <> 'abierta' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ese día ya está cerrado';
  END IF;
  IF EXISTS (SELECT 1 FROM sesiones_caja WHERE jornada_id = p_jornada AND estado = 'abierta') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hay cajas abiertas: ciérralas antes de cerrar el día';
  END IF;

  UPDATE traspasos_caja t JOIN sesiones_caja s ON s.id = t.sesion_entrega_id
     SET t.estado = 'fin_de_dia'
   WHERE s.jornada_id = p_jornada AND t.estado = 'pendiente';

  UPDATE jornadas
     SET estado = 'cerrada', fondo_para_manana = p_fondo_manana, pollos_para_manana = p_pollos_manana,
         cerrada_por = p_usuario, cerrada_en = NOW()
   WHERE id = p_jornada;

  INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_nuevo)
  VALUES (p_usuario, 'cerrar_dia', 'jornadas', p_jornada,
          JSON_OBJECT('fondo_para_manana', p_fondo_manana, 'pollos_para_manana', p_pollos_manana));
  COMMIT;
END$$

-- Reabrir un día cerrado (solo el dueño; queda en la bitácora)
CREATE PROCEDURE sp_reabrir_jornada(IN p_jornada INT, IN p_usuario INT, IN p_motivo VARCHAR(200))
BEGIN
  IF (SELECT rol FROM empleados WHERE id = p_usuario) <> 'dueno' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo el dueño puede reabrir un día';
  END IF;
  UPDATE jornadas SET estado = 'abierta', cerrada_por = NULL, cerrada_en = NULL WHERE id = p_jornada;
  INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_nuevo)
  VALUES (p_usuario, 'reabrir_dia', 'jornadas', p_jornada, JSON_OBJECT('motivo', p_motivo));
END$$

-- Cerrar la planilla de un periodo: calcula los sueldos, congela los montos y marca los
-- adelantos/bonos como usados.
--   mensual    : base = sueldo × (días del periodo, máx. 30) / 30; descuenta faltas × valor del día
--   diario     : base = días trabajados × tarifa diaria
--   por_turno  : base = turnos trabajados × monto por turno
--   atrasos    : minutos de atraso × tarifa por minuto (configuración)
CREATE PROCEDURE sp_cerrar_planilla(IN p_planilla INT, IN p_usuario INT)
BEGIN
  DECLARE v_ini DATE;
  DECLARE v_fin DATE;
  DECLARE v_dias_mes DECIMAL(5,2);
  DECLARE v_tarifa_min DECIMAL(8,4);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT periodo_inicio, periodo_fin INTO v_ini, v_fin FROM planillas
   WHERE id = p_planilla AND estado = 'abierta' FOR UPDATE;
  IF v_ini IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no existe o ya está cerrada';
  END IF;
  SELECT CAST(valor AS DECIMAL(5,2))  INTO v_dias_mes   FROM configuracion WHERE clave = 'dias_mes_sueldo';
  SELECT CAST(valor AS DECIMAL(8,4))  INTO v_tarifa_min FROM configuracion WHERE clave = 'descuento_por_minuto_atraso';

  INSERT INTO planilla_detalles
    (planilla_id, empleado_id, tipo_pago, monto_pago, valor_dia, dias_trabajados, faltas, faltas_justificadas,
     minutos_atraso, monto_base, descuento_faltas, descuento_atrasos, adelantos, bonos, total_pagar)
  SELECT p_planilla, x.id, x.tipo_pago, x.monto_pago, x.valor_dia, x.dias, x.faltas, x.just, x.atraso,
         x.base, x.desc_faltas, x.desc_atrasos, x.adel, x.bon,
         GREATEST(0, x.base - x.desc_faltas - x.desc_atrasos - x.adel + x.bon)
    FROM (
      SELECT e.id, e.tipo_pago, e.monto_pago,
             ROUND(CASE e.tipo_pago WHEN 'mensual' THEN e.monto_pago / v_dias_mes ELSE e.monto_pago END, 2) AS valor_dia,
             COALESCE(a.dias, 0) AS dias, COALESCE(a.faltas, 0) AS faltas, COALESCE(a.just, 0) AS just,
             COALESCE(a.atraso, 0) AS atraso,
             ROUND(CASE e.tipo_pago
                     WHEN 'mensual' THEN e.monto_pago * LEAST(DATEDIFF(v_fin, v_ini) + 1, v_dias_mes) / v_dias_mes
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
            FROM asistencias WHERE fecha BETWEEN v_ini AND v_fin GROUP BY empleado_id
        ) a ON a.empleado_id = e.id
        LEFT JOIN (
          SELECT empleado_id,
                 SUM(CASE WHEN tipo = 'adelanto' THEN monto ELSE 0 END) AS adel,
                 SUM(CASE WHEN tipo = 'bono' THEN monto ELSE 0 END) AS bon
            FROM ajustes_sueldo WHERE planilla_id IS NULL AND fecha BETWEEN v_ini AND v_fin GROUP BY empleado_id
        ) aj ON aj.empleado_id = e.id
       WHERE e.activo = 1 AND e.rol <> 'dueno'
    ) x;

  UPDATE ajustes_sueldo SET planilla_id = p_planilla
   WHERE planilla_id IS NULL AND fecha BETWEEN v_ini AND v_fin;

  UPDATE planillas SET estado = 'cerrada', cerrada_por = p_usuario, cerrada_en = NOW() WHERE id = p_planilla;

  INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_nuevo)
  VALUES (p_usuario, 'cerrar_planilla', 'planillas', p_planilla,
          JSON_OBJECT('desde', v_ini, 'hasta', v_fin,
                      'total', (SELECT SUM(total_pagar) FROM planilla_detalles WHERE planilla_id = p_planilla)));
  COMMIT;
END$$

DELIMITER ;

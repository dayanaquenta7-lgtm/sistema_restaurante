-- =====================================================================
--  Parte 7 (PDF 06 - CRUD completo): bitácora del PUT de gaseosas
--  Se puede ejecutar muchas veces: el servidor lo aplica solo al arrancar.
--
--  Con el CRUD, el dueño ya puede corregir también la MARCA y el TAMAÑO
--  (PUT /api/gaseosas/:id). El trigger original solo anotaba precio,
--  activo y stock mínimo; ahora también anota los cambios de nombre.
--  La eliminación (DELETE) la anota la API en la bitácora.
-- =====================================================================
USE broasteria;
SET NAMES utf8mb4;

DROP TRIGGER IF EXISTS trg_gaseosas_au;
DELIMITER $$
CREATE TRIGGER trg_gaseosas_au AFTER UPDATE ON gaseosas FOR EACH ROW
BEGIN
  IF NOT (OLD.precio <=> NEW.precio) OR NOT (OLD.activo <=> NEW.activo) OR NOT (OLD.stock_minimo <=> NEW.stock_minimo)
     OR NOT (OLD.marca <=> NEW.marca) OR NOT (OLD.tamano <=> NEW.tamano) THEN
    INSERT INTO bitacora (empleado_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
    VALUES (@usuario_id, 'editar', 'gaseosas', NEW.id,
      JSON_OBJECT('gaseosa', CONCAT(OLD.marca, ' ', OLD.tamano), 'precio', OLD.precio, 'activo', OLD.activo, 'stock_minimo', OLD.stock_minimo),
      JSON_OBJECT('gaseosa', CONCAT(NEW.marca, ' ', NEW.tamano), 'precio', NEW.precio, 'activo', NEW.activo, 'stock_minimo', NEW.stock_minimo));
  END IF;
END$$
DELIMITER ;

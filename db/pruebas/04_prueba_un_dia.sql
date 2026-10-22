-- =====================================================================
--  Parte 4 (OPCIONAL): simulación de un día completo para comprobar que
--  todo cuadra. Usa datos inventados (nombres y montos de ejemplo).
--  Ejecutar en una base de PRUEBA:  mysql -f -t broasteria < 04_prueba_un_dia.sql
--  (-f sigue adelante tras los errores: los "ERROR" que aparecen a propósito
--   demuestran las protecciones del sistema)
-- =====================================================================
USE broasteria;
SET NAMES utf8mb4;
SET time_zone = '-04:00';

-- Personal de ejemplo (el PIN real se guarda como HMAC con el secreto del servidor)
INSERT INTO empleados (nombre, cargo, rol, pin_hmac, clave_hash, tipo_pago, monto_pago, turno_habitual_id) VALUES
  ('Dueño (prueba)', 'Dueño',   'dueno',           SHA2('secreto-0000', 256), 'bcrypt-de-ejemplo', 'mensual', 0,    NULL),
  ('Sandra',         'Cajera',  'atencion',        SHA2('secreto-1111', 256), NULL, 'mensual', 3000, 1),
  ('Rosa',           'Cajera',  'atencion',        SHA2('secreto-2222', 256), NULL, 'diario',   100, 2),
  ('Luis',           'Cocina',  'solo_asistencia', SHA2('secreto-3333', 256), NULL, 'por_turno', 60, 3);
SET @dueno = 1, @sandra = 2, @rosa = 3, @luis = 4;
SET @usuario_id = @dueno;

-- El dueño registra sus gaseosas y llegan al local
INSERT INTO gaseosas (marca, tamano, precio) VALUES
  ('Coca-Cola', 'Personal', 5.00), ('Coca-Cola', '1 litro', 10.00), ('Fanta naranja', 'Personal', 5.00);
INSERT INTO movimientos_gaseosa (gaseosa_id, tipo, cantidad, registrado_por) VALUES
  (1, 'ingreso', 24, @dueno), (2, 'ingreso', 12, @dueno), (3, 'ingreso', 12, @dueno);
UPDATE acompanamientos SET precio_porcion = 3.00 WHERE nombre IN ('Papa','Arroz','Plátano');

-- Llegan 20 pollos crudos
INSERT INTO movimientos_pollo (tipo, cantidad, registrado_por) VALUES ('compra', 20, @dueno);

SELECT '--- 1. SIN ASISTENCIA NO HAY CAJA (debe dar error) ---' AS prueba;
CALL sp_abrir_sesion_caja(@sandra, 1, 200, @ses_sandra);

-- Llegada de Sandra, Rosa y Luis (tablet con PIN)
INSERT INTO asistencias (empleado_id, turno_id, fecha, entrada, minutos_atraso) VALUES
  (@sandra, 1, CURDATE(), CONCAT(CURDATE(), ' 09:03:00'), 0),
  (@rosa,   2, CURDATE(), CONCAT(CURDATE(), ' 13:12:00'), 2),
  (@luis,   1, CURDATE(), CONCAT(CURDATE(), ' 08:58:00'), 0);

SELECT '--- 2. NADIE PUEDE TENER DOS ENTRADAS ABIERTAS (debe dar error) ---' AS prueba;
INSERT INTO asistencias (empleado_id, turno_id, fecha, entrada) VALUES (@sandra, 2, CURDATE(), NOW());

-- Sandra abre la caja como encargada con Bs 200 de cambio
CALL sp_abrir_sesion_caja(@sandra, 1, 200, @ses_sandra);
SELECT '--- 3. COCINA NO PUEDE ATENDER EN CAJA (debe dar error) ---' AS prueba;
CALL sp_abrir_sesion_caja(@luis, 0, NULL, @x);

SET @jornada = (SELECT id FROM jornadas WHERE fecha = CURDATE());

-- Se abren 10 pollos: 100 presas + 40 aumentos
SET @usuario_id = @dueno;
CALL sp_abrir_pollos(@jornada, 10, @dueno);
SELECT '--- 4. PIEZAS DESPUÉS DE ABRIR 10 POLLOS ---' AS prueba;
SELECT nombre, categoria, abiertas FROM v_cuadre_piezas WHERE jornada_id = @jornada;

-- VENTAS de la mañana (las toma Sandra)
SET @usuario_id = @sandra;
-- 1) pierna + rabadilla, plato completo, efectivo
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago) VALUES (@jornada, @ses_sandra, @sandra, 'mesa', 'efectivo');
SET @v1 = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id, aumento_id) VALUES (@v1, 'plato', 1, 6);
SET @i = LAST_INSERT_ID();
INSERT INTO venta_item_acomp VALUES (@i, 1), (@i, 2), (@i, 3);

-- 2) ala + cuello, PURA PAPA (+Bs 1), QR
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago, qr_referencia) VALUES (@jornada, @ses_sandra, @sandra, 'llevar', 'qr', '4821');
SET @v2 = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id, aumento_id) VALUES (@v2, 'plato', 2, 7);
SET @i = LAST_INSERT_ID();
INSERT INTO venta_item_acomp VALUES (@i, 1);

-- 3) ala + minicostilla, PURO ARROZ (precio normal), efectivo
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago) VALUES (@jornada, @ses_sandra, @rosa, 'mesa', 'efectivo');
SET @v3 = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id, aumento_id) VALUES (@v3, 'plato', 2, 8);
SET @i = LAST_INSERT_ID();
INSERT INTO venta_item_acomp VALUES (@i, 2);

-- 4) entrepierna con papa y arroz + 2 Coca-Cola 1 litro + una porción de papa aparte
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago) VALUES (@jornada, @ses_sandra, @rosa, 'mesa', 'efectivo');
SET @v4 = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id) VALUES (@v4, 'plato', 3);
SET @i = LAST_INSERT_ID();
INSERT INTO venta_item_acomp VALUES (@i, 1), (@i, 2);
INSERT INTO venta_items (venta_id, tipo, gaseosa_id, cantidad) VALUES (@v4, 'gaseosa', 2, 2);
INSERT INTO venta_items (venta_id, tipo, acompanamiento_id) VALUES (@v4, 'porcion', 1);

SELECT '--- 5. VENTAS Y TOTALES (calculados por la base) ---' AS prueba;
SELECT v.numero, v.canal, v.forma_pago, v.total FROM ventas v WHERE v.jornada_id = @jornada ORDER BY v.numero;
SELECT '    (esperado: 15, 16 [pura papa +1], 15 [puro arroz normal], 38 [15 + 20 + 3])' AS nota;

SELECT '--- 6. ALA CON RABADILLA NO ES VÁLIDO (debe dar error) ---' AS prueba;
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago) VALUES (@jornada, @ses_sandra, @sandra, 'mesa', 'efectivo');
SET @vx = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id, aumento_id) VALUES (@vx, 'plato', 2, 6);

-- Esa venta quedó vacía: se anula con motivo
UPDATE ventas SET estado = 'anulada', anulada_por = @sandra, anulada_en = NOW(), motivo_anulacion = 'Pedido mal tomado' WHERE id = @vx;

-- 7) una venta con 1 pierna se anula: el stock debe volver solo
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago) VALUES (@jornada, @ses_sandra, @sandra, 'mesa', 'efectivo');
SET @v5 = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id, aumento_id) VALUES (@v5, 'plato', 1, 6);
SELECT '--- 7. PIERNAS Y RABADILLAS ANTES DE ANULAR ---' AS prueba;
SELECT nombre, SUM(cantidad) AS stock FROM movimientos_pieza m JOIN tipos_pieza p ON p.id = m.tipo_pieza_id WHERE nombre IN ('Pierna','Rabadilla') GROUP BY nombre;
UPDATE ventas SET estado = 'anulada', anulada_por = @sandra, anulada_en = NOW(), motivo_anulacion = 'Cliente se fue' WHERE id = @v5;
SELECT '    DESPUÉS DE ANULAR (deben subir en 1)' AS nota;
SELECT nombre, SUM(cantidad) AS stock FROM movimientos_pieza m JOIN tipos_pieza p ON p.id = m.tipo_pieza_id WHERE nombre IN ('Pierna','Rabadilla') GROUP BY nombre;

-- Pedido por llamada con pago QR
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago, qr_referencia) VALUES (@jornada, @ses_sandra, @sandra, 'llamada', 'qr', '9937');
SET @v6 = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id) VALUES (@v6, 'plato', 4);
SET @i = LAST_INSERT_ID();
INSERT INTO venta_item_acomp VALUES (@i, 1), (@i, 2), (@i, 3);
INSERT INTO pedidos_llamada (venta_id, codigo, cliente_nombre, estado, pago_confirmado_en) VALUES (@v6, 'P-01', 'María Pérez Gómez', 'pagado', NOW());

-- Gasto pagado de caja
INSERT INTO gastos (jornada_id, sesion_caja_id, concepto, monto, registrado_por) VALUES (@jornada, @ses_sandra, 'Gas', 50.00, @sandra);

-- Pérdidas: el personal se lleva 2 piernas cocidas (con sus rabadillas)
INSERT INTO perdidas (jornada_id, motivo, tipo_pieza_id, cantidad, registrado_por) VALUES
  (@jornada, 'consumo_personal', 1, 2, @sandra), (@jornada, 'consumo_personal', 6, 2, @sandra);

SELECT '--- 8. CIERRE DE CAJA DE SANDRA ---' AS prueba;
SELECT '    Esperado: 200 (fondo) + 15 + 15 + 38 (efectivo) - 50 (gas) = 218. QR = 16 + 15' AS nota;
SELECT 'Intento contando 210 SIN motivo (debe dar error):' AS nota;
CALL sp_cerrar_sesion_caja(@ses_sandra, 210, NULL);
CALL sp_cerrar_sesion_caja(@ses_sandra, 210, 'Error de cambio a un cliente');

-- Rosa también estaba en caja como apoyo: cierra su sesión
CALL sp_abrir_sesion_caja(@rosa, 0, NULL, @ses_rosa_apoyo);
CALL sp_cerrar_sesion_caja(@ses_rosa_apoyo, NULL, NULL);

-- Llegada de relevo: Rosa recibe la caja y cuenta Bs 205 (entregó 210)
CALL sp_abrir_sesion_caja(@rosa, 1, 205, @ses_rosa);
SELECT '--- 9. RELEVO: Sandra entregó 210, Rosa recibió 205 (debe quedar con diferencia) ---' AS prueba;
SELECT sesion_entrega_id, sesion_recibe_id, monto_entregado, monto_recibido, diferencia, estado FROM traspasos_caja;

-- Venta de la tarde en la caja de Rosa
SET @usuario_id = @rosa;
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago) VALUES (@jornada, @ses_rosa, @rosa, 'mesa', 'efectivo');
SET @v7 = LAST_INSERT_ID();
INSERT INTO venta_items (venta_id, tipo, tipo_pieza_id, aumento_id) VALUES (@v7, 'plato', 1, 6);
SET @i = LAST_INSERT_ID();
INSERT INTO venta_item_acomp VALUES (@i, 1), (@i, 2);

SELECT '--- 10. NO SE PUEDE CERRAR EL DÍA CON LA CAJA ABIERTA (debe dar error) ---' AS prueba;
CALL sp_cerrar_jornada(@jornada, 150, 8, @dueno);

-- Rosa cierra: debe haber 205 + 15 = 220
CALL sp_cerrar_sesion_caja(@ses_rosa, 220, NULL);

-- Fin del día: salidas del personal y cierre
UPDATE asistencias SET salida = CONCAT(CURDATE(), ' 21:59:00') WHERE fecha = CURDATE() AND salida IS NULL;
CALL sp_cerrar_jornada(@jornada, 150, 8, @dueno);

SELECT '--- 11. REGISTRO DEL DÍA (lo que ve el dueño) ---' AS prueba;
SELECT '    (en esta prueba solo se simularon 6 ventas: las presas no vendidas salen "sin explicar"; en la vida real se registran como consumo del personal o pérdida)' AS nota;
SELECT * FROM v_registro_dia\G

SELECT '--- 12. CUADRE POR PIEZA ---' AS prueba;
SELECT nombre, abiertas, vendidas, perdidas, (abiertas - vendidas - perdidas) AS sin_explicar FROM v_cuadre_piezas WHERE jornada_id = @jornada;

SELECT '--- 13. GASEOSAS (stock y semáforo) ---' AS prueba;
SELECT marca, tamano, precio, stock, semaforo FROM v_stock_gaseosas;

SELECT '--- 14. PANEL ADMIN: CAJA (quién, de qué hora a qué hora, cuánto) ---' AS prueba;
SELECT nombre, funcion, TIME(inicio) AS desde, TIME(fin) AS hasta, fondo_recibido, efectivo_esperado, efectivo_contado, diferencia, motivo_diferencia, estado_relevo FROM v_sesiones_caja_admin;

SELECT '--- 15. PANEL ADMIN: ASISTENCIA (separada de la caja) ---' AS prueba;
SELECT nombre, turno, TIME(entrada) AS llegada, TIME(salida) AS salida, minutos_atraso FROM v_asistencia_admin WHERE fecha = CURDATE();

SELECT '--- 16. DÍA CERRADO: NO ADMITE MÁS VENTAS (debe dar error) ---' AS prueba;
INSERT INTO ventas (jornada_id, sesion_caja_id, atendida_por, canal, forma_pago) VALUES (@jornada, @ses_rosa, @rosa, 'mesa', 'efectivo');

-- ---------------------------------------------------------------------
-- PLANILLA SEMANAL (últimos 7 días)
-- ---------------------------------------------------------------------
SET @usuario_id = @dueno;
INSERT INTO asistencias (empleado_id, turno_id, fecha, estado, entrada, salida, minutos_atraso, falta_justificada)
SELECT @sandra, 1, d, IF(n = 3, 'falta', 'presente'), IF(n = 3, NULL, CONCAT(d, ' 09:00:00')), IF(n = 3, NULL, CONCAT(d, ' 18:00:00')), IF(n = 5, 7, 0), 0
  FROM (SELECT 1 n, CURDATE() - INTERVAL 1 DAY d UNION SELECT 2, CURDATE() - INTERVAL 2 DAY UNION SELECT 3, CURDATE() - INTERVAL 3 DAY
        UNION SELECT 4, CURDATE() - INTERVAL 4 DAY UNION SELECT 5, CURDATE() - INTERVAL 5 DAY UNION SELECT 6, CURDATE() - INTERVAL 6 DAY) s;
INSERT INTO asistencias (empleado_id, turno_id, fecha, entrada, salida)
SELECT @rosa, 2, CURDATE() - INTERVAL n DAY, CONCAT(CURDATE() - INTERVAL n DAY, ' 13:00:00'), CONCAT(CURDATE() - INTERVAL n DAY, ' 22:00:00')
  FROM (SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) s;
INSERT INTO asistencias (empleado_id, turno_id, fecha, entrada, salida)
SELECT @luis, 3, CURDATE() - INTERVAL n DAY, CONCAT(CURDATE() - INTERVAL n DAY, ' 18:00:00'), CONCAT(CURDATE() - INTERVAL n DAY, ' 22:00:00')
  FROM (SELECT 1 n UNION SELECT 2 UNION SELECT 3) s;
INSERT INTO ajustes_sueldo (empleado_id, tipo, monto, fecha, nota, registrado_por) VALUES (@rosa, 'adelanto', 50, CURDATE() - INTERVAL 2 DAY, 'Adelanto', @dueno);
UPDATE configuracion SET valor = '0.50' WHERE clave = 'descuento_por_minuto_atraso';

INSERT INTO planillas (periodo_inicio, periodo_fin) VALUES (CURDATE() - INTERVAL 6 DAY, CURDATE());
SET @plan = LAST_INSERT_ID();
CALL sp_cerrar_planilla(@plan, @dueno);

SELECT '--- 17. PLANILLA CERRADA ---' AS prueba;
SELECT '    Sandra mensual 3000: periodo de 7 días => base 700; 1 falta => -100; 7 min atraso x 0.50 => -3.50 = 596.50' AS nota;
SELECT '    Rosa diario 100: 5 días (4 + hoy) => 500 - atraso 2 min (1.00) - adelanto 50 = 449.  Luis por turno 60: 4 turnos (3 + hoy) => 240' AS nota;
SELECT e.nombre, d.tipo_pago, d.dias_trabajados AS dias, d.faltas, d.minutos_atraso AS min_atraso, d.monto_base,
       d.descuento_faltas, d.descuento_atrasos, d.adelantos, d.total_pagar
  FROM planilla_detalles d JOIN empleados e ON e.id = d.empleado_id WHERE d.planilla_id = @plan;

SELECT '--- 18. PLANILLA CONGELADA: cambiar el sueldo no altera la planilla cerrada ---' AS prueba;
UPDATE empleados SET monto_pago = 3500 WHERE id = @sandra;
SELECT monto_pago AS sueldo_en_planilla, total_pagar FROM planilla_detalles WHERE planilla_id = @plan AND empleado_id = @sandra;
SELECT 'Intento editar una planilla cerrada (debe dar error):' AS nota;
UPDATE planilla_detalles SET total_pagar = 9999 WHERE planilla_id = @plan AND empleado_id = @sandra;

SELECT '--- 19. LA BITÁCORA NO SE PUEDE BORRAR (debe dar error) ---' AS prueba;
DELETE FROM bitacora;

SELECT '--- 20. BITÁCORA (lo que quedó anotado solo) ---' AS prueba;
SELECT b.id, e.nombre AS quien, b.accion, b.entidad, b.entidad_id, b.valor_anterior, b.valor_nuevo
  FROM bitacora b LEFT JOIN empleados e ON e.id = b.empleado_id ORDER BY b.id;

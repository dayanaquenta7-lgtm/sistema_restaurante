-- =====================================================================
--  Parte 3: datos iniciales (lo que ya sabemos del negocio)
--  Las gaseosas, el dueño y el personal los registra el dueño desde la app.
-- =====================================================================
USE broasteria;
SET NAMES utf8mb4;

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('tolerancia_minutos',          '10',   'Minutos de tolerancia antes de contar atraso'),
  ('descuento_por_minuto_atraso', '0',    'Bs que se descuentan por cada minuto de atraso (0 = no descuenta)'),
  ('dias_mes_sueldo',             '30',   'Divisor para el valor del día en sueldos mensuales'),
  ('margen_diferencia_caja',      '0',    'Diferencia tolerada al contar la caja, en Bs (0 = toda diferencia se explica)'),
  ('stock_minimo_gaseosa',        '6',    'Aviso de stock mínimo por defecto para gaseosas nuevas');

INSERT INTO turnos (nombre, hora_inicio, hora_fin) VALUES
  ('Mañana', '09:00', '18:00'),
  ('Tarde',  '13:00', '22:00'),
  ('Noche',  '18:00', '22:00');

-- 1 pollo = 10 presas + 4 aumentos
INSERT INTO tipos_pieza (nombre, categoria, cantidad_por_pollo, precio, orden) VALUES
  ('Pierna',             'presa',   2, 15.00, 1),
  ('Ala',                'presa',   2, 15.00, 2),
  ('Entrepierna',        'presa',   2, 15.00, 3),
  ('Pecho',              'presa',   2, 15.00, 4),
  ('Pecho con costilla', 'presa',   2, 15.00, 5),
  ('Rabadilla',          'aumento', 2, NULL,  6),
  ('Cuello',             'aumento', 1, NULL,  7),
  ('Minicostilla',       'aumento', 1, NULL,  8);

-- Pierna → rabadilla; Ala → cuello o minicostilla
INSERT INTO presa_aumento (presa_id, aumento_id)
  SELECT p.id, a.id FROM tipos_pieza p JOIN tipos_pieza a
   WHERE (p.nombre = 'Pierna' AND a.nombre = 'Rabadilla')
      OR (p.nombre = 'Ala'    AND a.nombre IN ('Cuello', 'Minicostilla'));

-- Precio de la porción aparte: lo carga el dueño
INSERT INTO acompanamientos (nombre, precio_porcion, orden) VALUES
  ('Papa', NULL, 1), ('Arroz', NULL, 2), ('Plátano', NULL, 3);

-- "Pura papa" cuesta Bs 1 más (se apaga fuera de temporada)
INSERT INTO reglas_precio (nombre, acompanamiento_unico_id, recargo, activo)
  SELECT 'Plato con pura papa', id, 1.00, 1 FROM acompanamientos WHERE nombre = 'Papa';

-- =====================================================================
--  SISTEMA PARA BROASTERÍA — Modelo de datos (MySQL 8 / MariaDB 10.5+)
--  Parte 1: estructura (tablas, restricciones, vistas)
--
--  Principios:
--   * Nada se borra: se anula, se desactiva o se cierra.
--   * El stock NO es un número editable: es la suma de movimientos con fecha y hora.
--   * Cada venta guarda el precio que tenía ese día (cambiar precios no altera el pasado).
--   * Todo cambio sensible queda en la bitácora (quién, cuándo, antes y después).
--
--  Ejecutar con el cliente de línea de comandos o MySQL Workbench:
--      mysql -u root -p < 01_schema.sql
--      mysql -u root -p broasteria < 02_logica.sql
--      mysql -u root -p broasteria < 03_datos_iniciales.sql
--  (los scripts usan DELIMITER, que no entienden los drivers de Node.js)
--
--  IMPORTANTE (zona horaria): Bolivia es UTC-4 sin horario de verano. Configura el
--  servidor con  default-time-zone='-04:00'  para que "el día" cambie a medianoche
--  local y no a las 20:00.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS broasteria
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE broasteria;
SET NAMES utf8mb4;
SET time_zone = '-04:00';

-- ---------------------------------------------------------------------
-- 1. CONFIGURACIÓN (la pantalla "Reglas" del dueño)
-- ---------------------------------------------------------------------
CREATE TABLE configuracion (
  clave          VARCHAR(50)  NOT NULL,
  valor          VARCHAR(100) NOT NULL,
  descripcion    VARCHAR(200) NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. PERSONAL, TURNOS Y ASISTENCIA
-- ---------------------------------------------------------------------
CREATE TABLE turnos (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(30) NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin    TIME NOT NULL,
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_turnos_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE empleados (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre             VARCHAR(100) NOT NULL,
  cargo              VARCHAR(50)  NULL,
  rol                ENUM('dueno','atencion','solo_asistencia') NOT NULL DEFAULT 'atencion',
  -- PIN: se guarda como HMAC-SHA256(PIN, secreto_del_servidor), nunca en claro.
  -- Permite que la tablet identifique a la persona con solo el PIN.
  pin_hmac           CHAR(64) NOT NULL,
  -- Contraseña larga (bcrypt/argon2) solo para el dueño, para entrar al panel completo.
  clave_hash         VARCHAR(255) NULL,
  intentos_fallidos  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta    DATETIME NULL,
  tipo_pago          ENUM('mensual','diario','por_turno') NOT NULL DEFAULT 'mensual',
  monto_pago         DECIMAL(10,2) NOT NULL DEFAULT 0,   -- sueldo mensual, tarifa diaria o monto por turno
  turno_habitual_id  TINYINT UNSIGNED NULL,
  fecha_ingreso      DATE NULL,
  activo             TINYINT(1) NOT NULL DEFAULT 1,
  creado_en          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_empleados_pin (pin_hmac),
  CONSTRAINT fk_emp_turno FOREIGN KEY (turno_habitual_id) REFERENCES turnos(id),
  CONSTRAINT ck_emp_monto CHECK (monto_pago >= 0)
) ENGINE=InnoDB;

-- Plan semanal OPCIONAL (si el dueño no lo llena, el sistema pregunta el turno al marcar)
CREATE TABLE asignaciones_turno (
  empleado_id INT UNSIGNED NOT NULL,
  fecha       DATE NOT NULL,
  turno_id    TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (empleado_id, fecha),
  CONSTRAINT fk_asig_emp   FOREIGN KEY (empleado_id) REFERENCES empleados(id),
  CONSTRAINT fk_asig_turno FOREIGN KEY (turno_id)    REFERENCES turnos(id)
) ENGINE=InnoDB;

-- ASISTENCIA: lo único que genera pago. Independiente de la sesión de caja.
CREATE TABLE asistencias (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empleado_id       INT UNSIGNED NOT NULL,
  turno_id          TINYINT UNSIGNED NOT NULL,
  fecha             DATE NOT NULL,
  estado            ENUM('presente','falta','permiso') NOT NULL DEFAULT 'presente',
  entrada           DATETIME NULL,
  salida            DATETIME NULL,
  minutos_atraso    SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- ya descontada la tolerancia
  minutos_extra     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  falta_justificada TINYINT(1) NOT NULL DEFAULT 0,
  nota              VARCHAR(200) NULL,
  -- 1 mientras la persona está "adentro"; NULL al salir. Con el UNIQUE, nadie
  -- puede tener dos entradas abiertas a la vez.
  entrada_abierta   TINYINT AS (IF(entrada IS NOT NULL AND salida IS NULL, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_asis_dia_turno (empleado_id, fecha, turno_id),
  UNIQUE KEY uq_asis_abierta (empleado_id, entrada_abierta),
  KEY ix_asis_fecha (fecha),
  CONSTRAINT fk_asis_emp   FOREIGN KEY (empleado_id) REFERENCES empleados(id),
  CONSTRAINT fk_asis_turno FOREIGN KEY (turno_id)    REFERENCES turnos(id),
  CONSTRAINT ck_asis_horas CHECK (salida IS NULL OR entrada IS NULL OR salida > entrada),
  CONSTRAINT ck_asis_estado CHECK (estado <> 'presente' OR entrada IS NOT NULL)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. CATÁLOGO: PIEZAS DEL POLLO, ACOMPAÑAMIENTOS, GASEOSAS
-- ---------------------------------------------------------------------
-- De 1 pollo: 10 presas (2 pierna, 2 ala, 2 entrepierna, 2 pecho, 2 pecho con costilla)
-- y 4 aumentos (2 rabadilla, 1 cuello, 1 minicostilla).
CREATE TABLE tipos_pieza (
  id                 TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre             VARCHAR(40) NOT NULL,
  categoria          ENUM('presa','aumento') NOT NULL,
  cantidad_por_pollo TINYINT UNSIGNED NOT NULL,
  precio             DECIMAL(8,2) NULL,            -- solo las presas; el aumento va incluido
  orden              TINYINT UNSIGNED NOT NULL DEFAULT 0,
  activo             TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pieza_nombre (nombre),
  CONSTRAINT ck_pieza_precio CHECK (categoria = 'aumento' OR (precio IS NOT NULL AND precio >= 0))
) ENGINE=InnoDB;

-- Qué aumento puede acompañar a qué presa (pierna→rabadilla, ala→cuello o minicostilla)
CREATE TABLE presa_aumento (
  presa_id   TINYINT UNSIGNED NOT NULL,
  aumento_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (presa_id, aumento_id),
  CONSTRAINT fk_pa_presa   FOREIGN KEY (presa_id)   REFERENCES tipos_pieza(id),
  CONSTRAINT fk_pa_aumento FOREIGN KEY (aumento_id) REFERENCES tipos_pieza(id)
) ENGINE=InnoDB;

-- Papa, arroz, plátano: van incluidos en el plato y también se venden como porción
CREATE TABLE acompanamientos (
  id             TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre         VARCHAR(40) NOT NULL,
  precio_porcion DECIMAL(8,2) NULL,        -- NULL = aún sin precio
  orden          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  activo         TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_acomp_nombre (nombre)
) ENGINE=InnoDB;

-- Recargo por plato reducido (hoy: "pura papa" = +Bs 1). Se prende y apaga por temporada.
CREATE TABLE reglas_precio (
  id                     TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre                 VARCHAR(60) NOT NULL,
  acompanamiento_unico_id TINYINT UNSIGNED NOT NULL,   -- si es el ÚNICO acompañamiento del plato…
  recargo                DECIMAL(8,2) NOT NULL,        -- …se suma este monto
  activo                 TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT fk_regla_acomp FOREIGN KEY (acompanamiento_unico_id) REFERENCES acompanamientos(id),
  CONSTRAINT ck_regla_recargo CHECK (recargo >= 0)
) ENGINE=InnoDB;

-- Cada fila = una variedad (marca/sabor + tamaño). El dueño las registra desde la app.
CREATE TABLE gaseosas (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  marca        VARCHAR(60) NOT NULL,         -- "Coca-Cola", "Fanta naranja"
  tamano       VARCHAR(30) NOT NULL,         -- "Personal", "1 litro", "2 litros"
  precio       DECIMAL(8,2) NOT NULL,
  stock_minimo SMALLINT UNSIGNED NOT NULL DEFAULT 6,
  activo       TINYINT(1) NOT NULL DEFAULT 1,
  creado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gaseosa (marca, tamano),
  CONSTRAINT ck_gaseosa_precio CHECK (precio >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. JORNADAS Y CAJA
-- ---------------------------------------------------------------------
-- Una jornada = un día de venta. En pantalla "arranca en 0"; en la base nada se reinicia.
CREATE TABLE jornadas (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fecha              DATE NOT NULL,
  estado             ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  fondo_inicial      DECIMAL(10,2) NOT NULL DEFAULT 0,    -- lo que se dejó ayer como cambio
  fondo_para_manana  DECIMAL(10,2) NULL,                   -- lo que se deja para mañana
  pollos_para_manana SMALLINT UNSIGNED NULL,               -- pollos que se prepararán mañana
  cerrada_por        INT UNSIGNED NULL,
  cerrada_en         DATETIME NULL,
  nota               VARCHAR(200) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jornada_fecha (fecha),
  CONSTRAINT fk_jor_cierra FOREIGN KEY (cerrada_por) REFERENCES empleados(id)
) ENGINE=InnoDB;

-- Sesión de caja: quién atendió y de qué hora a qué hora.
-- NO genera pago (eso es la asistencia). Solo la ENCARGADA responde por el dinero.
CREATE TABLE sesiones_caja (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  jornada_id        INT UNSIGNED NOT NULL,
  empleado_id       INT UNSIGNED NOT NULL,
  es_encargada      TINYINT(1) NOT NULL DEFAULT 0,
  inicio            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fin               DATETIME NULL,
  fondo_esperado    DECIMAL(10,2) NULL,        -- lo que la anterior dijo que entregaba
  fondo_recibido    DECIMAL(10,2) NULL,        -- lo que ella contó al recibir
  ventas_efectivo   DECIMAL(10,2) NULL,        -- se congelan al cerrar
  ventas_qr         DECIMAL(10,2) NULL,
  gastos_caja       DECIMAL(10,2) NULL,
  efectivo_esperado DECIMAL(10,2) NULL,        -- fondo + ventas efectivo - gastos
  efectivo_contado  DECIMAL(10,2) NULL,        -- lo que contó y confirmó
  diferencia        DECIMAL(10,2) NULL,        -- contado - esperado
  motivo_diferencia VARCHAR(200) NULL,
  estado            ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  abierta           TINYINT AS (IF(estado = 'abierta', 1, NULL)) STORED,
  encargada_abierta TINYINT AS (IF(estado = 'abierta' AND es_encargada = 1, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ses_persona_abierta (empleado_id, abierta),          -- 1 sesión abierta por persona
  UNIQUE KEY uq_ses_encargada_abierta (jornada_id, encargada_abierta), -- 1 encargada a la vez
  KEY ix_ses_jornada (jornada_id),
  CONSTRAINT fk_ses_jor FOREIGN KEY (jornada_id)  REFERENCES jornadas(id),
  CONSTRAINT fk_ses_emp FOREIGN KEY (empleado_id) REFERENCES empleados(id)
) ENGINE=InnoDB;

-- Relevo de caja: "entregó X" contra "recibió X", con confirmación de las dos.
CREATE TABLE traspasos_caja (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sesion_entrega_id INT UNSIGNED NOT NULL,
  sesion_recibe_id  INT UNSIGNED NULL,
  monto_entregado   DECIMAL(10,2) NOT NULL,
  monto_recibido    DECIMAL(10,2) NULL,
  diferencia        DECIMAL(10,2) NULL,
  estado            ENUM('pendiente','confirmado','con_diferencia','fin_de_dia') NOT NULL DEFAULT 'pendiente',
  entregado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recibido_en       DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tras_entrega (sesion_entrega_id),
  UNIQUE KEY uq_tras_recibe  (sesion_recibe_id),
  CONSTRAINT fk_tras_entrega FOREIGN KEY (sesion_entrega_id) REFERENCES sesiones_caja(id),
  CONSTRAINT fk_tras_recibe  FOREIGN KEY (sesion_recibe_id)  REFERENCES sesiones_caja(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. VENTAS
-- ---------------------------------------------------------------------
CREATE TABLE ventas (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  jornada_id        INT UNSIGNED NOT NULL,
  numero            INT UNSIGNED NOT NULL DEFAULT 0,       -- número de pedido del día
  sesion_caja_id    INT UNSIGNED NOT NULL,                  -- caja que cobró (la de la encargada)
  atendida_por      INT UNSIGNED NOT NULL,                  -- quién tomó el pedido
  canal             ENUM('mesa','llevar','llamada') NOT NULL DEFAULT 'mesa',
  forma_pago        ENUM('efectivo','qr') NOT NULL,
  qr_referencia     VARCHAR(40) NULL,                       -- últimos dígitos del comprobante
  total             DECIMAL(10,2) NOT NULL DEFAULT 0,       -- lo mantiene la base sola
  estado            ENUM('valida','anulada') NOT NULL DEFAULT 'valida',
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulada_por       INT UNSIGNED NULL,
  anulada_en        DATETIME NULL,
  motivo_anulacion  VARCHAR(200) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_venta_numero (jornada_id, numero),
  KEY ix_venta_sesion (sesion_caja_id),
  CONSTRAINT fk_venta_jor  FOREIGN KEY (jornada_id)     REFERENCES jornadas(id),
  CONSTRAINT fk_venta_ses  FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja(id),
  CONSTRAINT fk_venta_aten FOREIGN KEY (atendida_por)   REFERENCES empleados(id),
  CONSTRAINT fk_venta_anul FOREIGN KEY (anulada_por)    REFERENCES empleados(id),
  CONSTRAINT ck_venta_anul CHECK (estado = 'valida' OR motivo_anulacion IS NOT NULL)
) ENGINE=InnoDB;

-- Pedido por llamada: el cliente da su nombre, paga por QR y recoge
CREATE TABLE pedidos_llamada (
  venta_id            BIGINT UNSIGNED NOT NULL,
  codigo              VARCHAR(10) NOT NULL,          -- "P-07"
  cliente_nombre      VARCHAR(120) NOT NULL,
  telefono            VARCHAR(20) NULL,
  estado              ENUM('recibido','pagado','preparando','listo','entregado','cancelado') NOT NULL DEFAULT 'recibido',
  pago_confirmado_en  DATETIME NULL,
  listo_en            DATETIME NULL,
  entregado_en        DATETIME NULL,
  PRIMARY KEY (venta_id),
  KEY ix_pll_codigo (codigo),
  CONSTRAINT fk_pll_venta FOREIGN KEY (venta_id) REFERENCES ventas(id)
) ENGINE=InnoDB;

-- Cada línea: un plato (presa + aumento opcional), una porción aparte o una gaseosa.
CREATE TABLE venta_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  venta_id        BIGINT UNSIGNED NOT NULL,
  tipo            ENUM('plato','porcion','gaseosa') NOT NULL,
  tipo_pieza_id   TINYINT UNSIGNED NULL,     -- plato: qué presa
  aumento_id      TINYINT UNSIGNED NULL,     -- plato: rabadilla / cuello / minicostilla (opcional)
  acompanamiento_id TINYINT UNSIGNED NULL,   -- porción aparte
  gaseosa_id      INT UNSIGNED NULL,
  cantidad        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  precio_base     DECIMAL(8,2) NOT NULL DEFAULT 0,  -- 0 = tomar el precio vigente del catálogo
  recargo         DECIMAL(8,2) NOT NULL DEFAULT 0,  -- p. ej. "pura papa" +1 (lo calcula la base)
  subtotal        DECIMAL(10,2) AS (cantidad * (precio_base + recargo)) STORED,
  PRIMARY KEY (id),
  KEY ix_vi_venta (venta_id),
  CONSTRAINT fk_vi_venta  FOREIGN KEY (venta_id)          REFERENCES ventas(id),
  CONSTRAINT fk_vi_pieza  FOREIGN KEY (tipo_pieza_id)     REFERENCES tipos_pieza(id),
  CONSTRAINT fk_vi_aum    FOREIGN KEY (aumento_id)        REFERENCES tipos_pieza(id),
  CONSTRAINT fk_vi_acomp  FOREIGN KEY (acompanamiento_id) REFERENCES acompanamientos(id),
  CONSTRAINT fk_vi_gas    FOREIGN KEY (gaseosa_id)        REFERENCES gaseosas(id),
  CONSTRAINT ck_vi_forma CHECK (
       (tipo = 'plato'   AND tipo_pieza_id IS NOT NULL AND acompanamiento_id IS NULL AND gaseosa_id IS NULL AND cantidad = 1)
    OR (tipo = 'porcion' AND acompanamiento_id IS NOT NULL AND tipo_pieza_id IS NULL AND aumento_id IS NULL AND gaseosa_id IS NULL)
    OR (tipo = 'gaseosa' AND gaseosa_id IS NOT NULL AND tipo_pieza_id IS NULL AND aumento_id IS NULL AND acompanamiento_id IS NULL)
  )
) ENGINE=InnoDB;

-- Acompañamientos incluidos en cada plato (los que el cliente NO quiere simplemente no se agregan)
CREATE TABLE venta_item_acomp (
  venta_item_id     BIGINT UNSIGNED NOT NULL,
  acompanamiento_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (venta_item_id, acompanamiento_id),
  CONSTRAINT fk_via_item  FOREIGN KEY (venta_item_id)     REFERENCES venta_items(id),
  CONSTRAINT fk_via_acomp FOREIGN KEY (acompanamiento_id) REFERENCES acompanamientos(id)
) ENGINE=InnoDB;

CREATE TABLE gastos (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  jornada_id     INT UNSIGNED NOT NULL,
  sesion_caja_id INT UNSIGNED NULL,
  concepto       VARCHAR(120) NOT NULL,
  monto          DECIMAL(10,2) NOT NULL,
  pagado_de_caja TINYINT(1) NOT NULL DEFAULT 1,
  registrado_por INT UNSIGNED NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulado        TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_gasto_jor (jornada_id),
  CONSTRAINT fk_gasto_jor FOREIGN KEY (jornada_id)     REFERENCES jornadas(id),
  CONSTRAINT fk_gasto_ses FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja(id),
  CONSTRAINT fk_gasto_emp FOREIGN KEY (registrado_por) REFERENCES empleados(id),
  CONSTRAINT ck_gasto_monto CHECK (monto > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. PLANILLA (sueldos)
-- ---------------------------------------------------------------------
CREATE TABLE planillas (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  periodo_inicio DATE NOT NULL,
  periodo_fin    DATE NOT NULL,
  estado         ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  cerrada_por    INT UNSIGNED NULL,
  cerrada_en     DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_planilla_periodo (periodo_inicio, periodo_fin),
  CONSTRAINT fk_plan_cierra FOREIGN KEY (cerrada_por) REFERENCES empleados(id),
  CONSTRAINT ck_plan_fechas CHECK (periodo_fin >= periodo_inicio)
) ENGINE=InnoDB;

-- Adelantos y bonos. Un adelanto pagado de la caja también queda como gasto del día.
CREATE TABLE ajustes_sueldo (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empleado_id    INT UNSIGNED NOT NULL,
  tipo           ENUM('adelanto','bono') NOT NULL,
  monto          DECIMAL(10,2) NOT NULL,
  fecha          DATE NOT NULL,
  nota           VARCHAR(200) NULL,
  gasto_id       BIGINT UNSIGNED NULL,
  planilla_id    INT UNSIGNED NULL,             -- se llena al cerrar la planilla que lo descontó
  registrado_por INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_aj_emp_fecha (empleado_id, fecha),
  CONSTRAINT fk_aj_emp   FOREIGN KEY (empleado_id)    REFERENCES empleados(id),
  CONSTRAINT fk_aj_gasto FOREIGN KEY (gasto_id)       REFERENCES gastos(id),
  CONSTRAINT fk_aj_plan  FOREIGN KEY (planilla_id)    REFERENCES planillas(id),
  CONSTRAINT fk_aj_reg   FOREIGN KEY (registrado_por) REFERENCES empleados(id),
  CONSTRAINT ck_aj_monto CHECK (monto > 0)
) ENGINE=InnoDB;

-- Copia CONGELADA de cada sueldo: si mañana cambia el sueldo base, esto no cambia.
CREATE TABLE planilla_detalles (
  planilla_id        INT UNSIGNED NOT NULL,
  empleado_id        INT UNSIGNED NOT NULL,
  tipo_pago          ENUM('mensual','diario','por_turno') NOT NULL,
  monto_pago         DECIMAL(10,2) NOT NULL,   -- sueldo/tarifa vigente al cerrar
  valor_dia          DECIMAL(10,2) NOT NULL,
  dias_trabajados    SMALLINT UNSIGNED NOT NULL,
  faltas             SMALLINT UNSIGNED NOT NULL,
  faltas_justificadas SMALLINT UNSIGNED NOT NULL,
  minutos_atraso     INT UNSIGNED NOT NULL,
  monto_base         DECIMAL(10,2) NOT NULL,
  descuento_faltas   DECIMAL(10,2) NOT NULL,
  descuento_atrasos  DECIMAL(10,2) NOT NULL,
  adelantos          DECIMAL(10,2) NOT NULL,
  bonos              DECIMAL(10,2) NOT NULL,
  total_pagar        DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (planilla_id, empleado_id),
  CONSTRAINT fk_pd_plan FOREIGN KEY (planilla_id) REFERENCES planillas(id),
  CONSTRAINT fk_pd_emp  FOREIGN KEY (empleado_id) REFERENCES empleados(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. INVENTARIO POR MOVIMIENTOS (el stock es la SUMA, nunca un número editable)
-- ---------------------------------------------------------------------
-- Pollos enteros crudos. compra(+), apertura(−: se abren y pasan a piezas), ajuste/merma(±)
CREATE TABLE movimientos_pollo (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  jornada_id     INT UNSIGNED NULL,
  tipo           ENUM('compra','apertura','ajuste','merma') NOT NULL,
  cantidad       INT NOT NULL,
  costo_total    DECIMAL(10,2) NULL,
  registrado_por INT UNSIGNED NULL,
  nota           VARCHAR(200) NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mpo_jor (jornada_id),
  CONSTRAINT fk_mpo_jor FOREIGN KEY (jornada_id)     REFERENCES jornadas(id),
  CONSTRAINT fk_mpo_emp FOREIGN KEY (registrado_por) REFERENCES empleados(id),
  CONSTRAINT ck_mpo_signo CHECK (
       (tipo = 'compra'   AND cantidad > 0)
    OR (tipo = 'apertura' AND cantidad < 0)
    OR (tipo IN ('ajuste','merma'))
  )
) ENGINE=InnoDB;

-- Pérdidas y consumo del personal: se guardan como CANTIDAD (sin dinero).
-- El cuadre las valora al precio de la presa solo para calcular el "debería ser".
CREATE TABLE perdidas (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  jornada_id     INT UNSIGNED NOT NULL,
  motivo         ENUM('consumo_personal','quemado_o_caido','regalo','otro') NOT NULL,
  tipo_pieza_id  TINYINT UNSIGNED NULL,
  gaseosa_id     INT UNSIGNED NULL,
  cantidad       INT UNSIGNED NOT NULL,
  nota           VARCHAR(200) NULL,
  registrado_por INT UNSIGNED NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulada        TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_per_jor (jornada_id),
  CONSTRAINT fk_per_jor   FOREIGN KEY (jornada_id)     REFERENCES jornadas(id),
  CONSTRAINT fk_per_pieza FOREIGN KEY (tipo_pieza_id)  REFERENCES tipos_pieza(id),
  CONSTRAINT fk_per_gas   FOREIGN KEY (gaseosa_id)     REFERENCES gaseosas(id),
  CONSTRAINT fk_per_emp   FOREIGN KEY (registrado_por) REFERENCES empleados(id),
  CONSTRAINT ck_per_item  CHECK ((tipo_pieza_id IS NULL) <> (gaseosa_id IS NULL)),
  CONSTRAINT ck_per_cant  CHECK (cantidad > 0)
) ENGINE=InnoDB;

-- Piezas sueltas (presas y aumentos). apertura(+), venta(−), perdida(−), ajuste(±), anulaciones(+)
CREATE TABLE movimientos_pieza (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  jornada_id     INT UNSIGNED NOT NULL,
  tipo_pieza_id  TINYINT UNSIGNED NOT NULL,
  tipo           ENUM('apertura','venta','perdida','ajuste','anulacion_venta','anulacion_perdida') NOT NULL,
  cantidad       INT NOT NULL,
  venta_item_id  BIGINT UNSIGNED NULL,
  perdida_id     BIGINT UNSIGNED NULL,
  registrado_por INT UNSIGNED NULL,
  nota           VARCHAR(200) NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mpi_jor_pieza (jornada_id, tipo_pieza_id),
  CONSTRAINT fk_mpi_jor    FOREIGN KEY (jornada_id)    REFERENCES jornadas(id),
  CONSTRAINT fk_mpi_pieza  FOREIGN KEY (tipo_pieza_id) REFERENCES tipos_pieza(id),
  CONSTRAINT fk_mpi_item   FOREIGN KEY (venta_item_id) REFERENCES venta_items(id),
  CONSTRAINT fk_mpi_perd   FOREIGN KEY (perdida_id)    REFERENCES perdidas(id),
  CONSTRAINT fk_mpi_emp    FOREIGN KEY (registrado_por) REFERENCES empleados(id)
) ENGINE=InnoDB;

CREATE TABLE movimientos_gaseosa (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gaseosa_id     INT UNSIGNED NOT NULL,
  tipo           ENUM('ingreso','venta','perdida','ajuste','anulacion_venta','anulacion_perdida') NOT NULL,
  cantidad       INT NOT NULL,
  costo_total    DECIMAL(10,2) NULL,
  venta_item_id  BIGINT UNSIGNED NULL,
  perdida_id     BIGINT UNSIGNED NULL,
  registrado_por INT UNSIGNED NULL,
  nota           VARCHAR(200) NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mga_gas (gaseosa_id),
  CONSTRAINT fk_mga_gas  FOREIGN KEY (gaseosa_id)    REFERENCES gaseosas(id),
  CONSTRAINT fk_mga_item FOREIGN KEY (venta_item_id) REFERENCES venta_items(id),
  CONSTRAINT fk_mga_perd FOREIGN KEY (perdida_id)    REFERENCES perdidas(id),
  CONSTRAINT fk_mga_emp  FOREIGN KEY (registrado_por) REFERENCES empleados(id),
  CONSTRAINT ck_mga_signo CHECK (
       (tipo = 'ingreso' AND cantidad > 0)
    OR (tipo IN ('venta','perdida') AND cantidad < 0)
    OR (tipo IN ('ajuste','anulacion_venta','anulacion_perdida'))
  )
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. BITÁCORA (solo se agrega; no se puede editar ni borrar)
-- ---------------------------------------------------------------------
CREATE TABLE bitacora (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fecha_hora     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  empleado_id    INT UNSIGNED NULL,           -- quién lo hizo (la app fija @usuario_id)
  accion         VARCHAR(30) NOT NULL,
  entidad        VARCHAR(40) NOT NULL,
  entidad_id     VARCHAR(40) NULL,
  valor_anterior JSON NULL,
  valor_nuevo    JSON NULL,
  PRIMARY KEY (id),
  KEY ix_bit_fecha (fecha_hora),
  KEY ix_bit_entidad (entidad, entidad_id),
  CONSTRAINT fk_bit_emp FOREIGN KEY (empleado_id) REFERENCES empleados(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. VISTAS (lo que lee el Registro del día y el panel del dueño)
-- ---------------------------------------------------------------------
CREATE VIEW v_stock_pollos AS
  SELECT COALESCE(SUM(cantidad), 0) AS pollos_crudos FROM movimientos_pollo;

CREATE VIEW v_stock_gaseosas AS
  SELECT g.id AS gaseosa_id, g.marca, g.tamano, g.precio, g.activo, g.stock_minimo,
         COALESCE(SUM(m.cantidad), 0) AS stock,
         CASE WHEN COALESCE(SUM(m.cantidad), 0) <= 0 THEN 'rojo'
              WHEN COALESCE(SUM(m.cantidad), 0) <= g.stock_minimo THEN 'amarillo'
              ELSE 'verde' END AS semaforo
    FROM gaseosas g
    LEFT JOIN movimientos_gaseosa m ON m.gaseosa_id = g.id
   GROUP BY g.id, g.marca, g.tamano, g.precio, g.activo, g.stock_minimo;

-- Piezas por jornada: qué se abrió, qué se vendió, qué se perdió y qué falta explicar
CREATE VIEW v_cuadre_piezas AS
  SELECT m.jornada_id, p.id AS tipo_pieza_id, p.nombre, p.categoria, p.precio,
         SUM(CASE WHEN m.tipo = 'apertura' THEN m.cantidad ELSE 0 END)                         AS abiertas,
         -SUM(CASE WHEN m.tipo IN ('venta','anulacion_venta') THEN m.cantidad ELSE 0 END)      AS vendidas,
         -SUM(CASE WHEN m.tipo IN ('perdida','anulacion_perdida') THEN m.cantidad ELSE 0 END)  AS perdidas,
         SUM(CASE WHEN m.tipo = 'ajuste' THEN m.cantidad ELSE 0 END)                           AS ajustes,
         SUM(m.cantidad)                                                                        AS restante
    FROM movimientos_pieza m
    JOIN tipos_pieza p ON p.id = m.tipo_pieza_id
   GROUP BY m.jornada_id, p.id, p.nombre, p.categoria, p.precio;

-- EL REGISTRO DEL DÍA: una fila por jornada con los números del dueño
CREATE VIEW v_registro_dia AS
  SELECT j.id AS jornada_id, j.fecha, j.estado,
         COALESCE((SELECT -SUM(mp.cantidad) FROM movimientos_pollo mp
                    WHERE mp.jornada_id = j.id AND mp.tipo = 'apertura'), 0)      AS pollos_usados,
         COALESCE((SELECT SUM(c.abiertas)  FROM v_cuadre_piezas c WHERE c.jornada_id = j.id AND c.categoria = 'presa'), 0) AS presas_abiertas,
         COALESCE((SELECT SUM(c.vendidas)  FROM v_cuadre_piezas c WHERE c.jornada_id = j.id AND c.categoria = 'presa'), 0) AS presas_vendidas,
         COALESCE((SELECT SUM(c.perdidas)  FROM v_cuadre_piezas c WHERE c.jornada_id = j.id AND c.categoria = 'presa'), 0) AS presas_perdidas,
         COALESCE((SELECT SUM(c.abiertas - c.vendidas - c.perdidas) FROM v_cuadre_piezas c WHERE c.jornada_id = j.id AND c.categoria = 'presa'), 0) AS presas_sin_explicar,
         -- DEBERÍA SER = todas las presas abiertas × su precio
         COALESCE((SELECT SUM(c.abiertas * c.precio) FROM v_cuadre_piezas c WHERE c.jornada_id = j.id AND c.categoria = 'presa'), 0) AS deberia_ser,
         COALESCE((SELECT SUM(c.perdidas * c.precio) FROM v_cuadre_piezas c WHERE c.jornada_id = j.id AND c.categoria = 'presa'), 0) AS perdidas_valoradas,
         COALESCE((SELECT SUM(vi.subtotal) FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
                    WHERE v.jornada_id = j.id AND v.estado = 'valida' AND vi.tipo = 'plato'), 0)    AS ventas_platos,
         COALESCE((SELECT SUM(vi.subtotal) FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
                    WHERE v.jornada_id = j.id AND v.estado = 'valida' AND vi.tipo = 'porcion'), 0)  AS ventas_porciones,
         COALESCE((SELECT SUM(vi.subtotal) FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
                    WHERE v.jornada_id = j.id AND v.estado = 'valida' AND vi.tipo = 'gaseosa'), 0)  AS ventas_gaseosas,
         COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.jornada_id = j.id AND v.estado = 'valida'), 0) AS venta_total,
         COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.jornada_id = j.id AND v.estado = 'valida' AND v.forma_pago = 'efectivo'), 0) AS venta_efectivo,
         COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.jornada_id = j.id AND v.estado = 'valida' AND v.forma_pago = 'qr'), 0)       AS venta_qr,
         COALESCE((SELECT SUM(g.monto) FROM gastos g WHERE g.jornada_id = j.id AND g.anulado = 0), 0) AS gastos,
         COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.jornada_id = j.id AND v.estado = 'valida'), 0)
           - COALESCE((SELECT SUM(g.monto) FROM gastos g WHERE g.jornada_id = j.id AND g.anulado = 0), 0) AS queda_del_dia,
         j.fondo_inicial, j.fondo_para_manana, j.pollos_para_manana
    FROM jornadas j;

-- Panel del admin, pestaña PERSONAL: llegadas y salidas
CREATE VIEW v_asistencia_admin AS
  SELECT a.fecha, e.nombre, t.nombre AS turno, a.estado, a.entrada, a.salida,
         a.minutos_atraso, a.falta_justificada
    FROM asistencias a
    JOIN empleados e ON e.id = a.empleado_id
    JOIN turnos t    ON t.id = a.turno_id;

-- Panel del admin, pestaña CAJA: quién atendió y los cierres con su diferencia
CREATE VIEW v_sesiones_caja_admin AS
  SELECT s.id AS sesion_id, j.fecha, e.nombre, IF(s.es_encargada, 'Encargada', 'Atención') AS funcion,
         s.inicio, s.fin, s.fondo_esperado, s.fondo_recibido, s.ventas_efectivo, s.ventas_qr,
         s.gastos_caja, s.efectivo_esperado, s.efectivo_contado, s.diferencia, s.motivo_diferencia,
         s.estado, tc.estado AS estado_relevo
    FROM sesiones_caja s
    JOIN jornadas j  ON j.id = s.jornada_id
    JOIN empleados e ON e.id = s.empleado_id
    LEFT JOIN traspasos_caja tc ON tc.sesion_entrega_id = s.id;

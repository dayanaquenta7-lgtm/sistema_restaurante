-- Ficha C: el precio de una gaseosa debe ser mayor que 0 y no superar Bs 5.000
USE broasteria;

ALTER TABLE gaseosas DROP CHECK ck_gaseosa_precio;

ALTER TABLE gaseosas
  ADD CONSTRAINT ck_gaseosa_precio CHECK (precio > 0 AND precio <= 5000);
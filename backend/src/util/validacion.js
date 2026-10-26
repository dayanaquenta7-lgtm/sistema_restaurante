// Esquemas de validación reutilizables (zod) y formato de dinero.
const { z } = require('zod');

// Dinero: acepta 15, 15.5 o "15.50"; siempre se maneja como TEXTO con máximo 2 decimales.
const dinero = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Monto inválido (usa números, hasta 2 decimales)'));

const dineroPositivo = dinero.refine((v) => Number(v) > 0, 'El monto debe ser mayor a cero');

const pin = z.string().regex(/^\d{4,6}$/, 'El PIN son de 4 a 6 números');
const id = z.coerce.number().int().positive();
const entero = (min, max) => z.number().int().min(min).max(max);
const texto = (min, max) =>
  z.string({ required_error: 'Este dato es obligatorio', invalid_type_error: 'Debe ser un texto' })
    .trim()
    .min(min, min === 1 ? 'No puede quedar vacío' : `Debe tener al menos ${min} caracteres`)
    .max(max, `Debe tener como máximo ${max} caracteres`);

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (usa AAAA-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Esa fecha no existe');

/** 1250 -> "1.250"; 1250.5 -> "1.250,50" (formato boliviano). */
function bs(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'Bs 0';
  const [ent, dec] = Math.abs(n).toFixed(2).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = dec === '00' ? '' : `,${dec}`;
  return `${n < 0 ? '-' : ''}Bs ${miles}${resto}`;
}

module.exports = { z, dinero, dineroPositivo, pin, id, entero, texto, fecha, bs };

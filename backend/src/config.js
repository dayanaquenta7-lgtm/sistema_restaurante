// Lee la configuración desde variables de entorno (archivo .env).
const path = require('path');
// En el programa instalado, el archivo de configuración vive en la carpeta del usuario (SISTEMA_ENV).
require('dotenv').config({ path: process.env.SISTEMA_ENV || path.join(__dirname, '..', '.env'), quiet: true });

const e = process.env;
const numero = (valor, porDefecto) => {
  if (valor === undefined || valor === '') return porDefecto;
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
};
const bool = (valor) => String(valor || '').toLowerCase() === 'true';

const config = {
  entorno: e.NODE_ENV || 'development',
  puerto: numero(e.PORT, 3000),
  db: {
    host: e.DB_HOST || '127.0.0.1',
    port: numero(e.DB_PORT, 3306),
    user: e.DB_USER || 'root',
    password: e.DB_PASSWORD || '',
    database: e.DB_NAME || 'broasteria',
    socketPath: e.DB_SOCKET || undefined,
  },
  // Bolivia es UTC-4 todo el año (sin horario de verano)
  zonaHoraria: '-04:00',
  pinSecret: e.PIN_SECRET,
  tabletKey: e.TABLET_KEY || '',
  cookieSegura: bool(e.COOKIE_SECURE),
  confiarProxy: bool(e.CONFIAR_PROXY),
  sesionHorasDueno: numero(e.SESION_HORAS_DUENO, 720),
  sesionHorasAtencion: numero(e.SESION_HORAS_ATENCION, 14),
  limiteIntentos: numero(e.LIMITE_INTENTOS, 10),
  esperaSalidaSeg: numero(e.ESPERA_SALIDA_SEG, 30),
  negocioNombre: e.NEGOCIO_NOMBRE || 'Super Pollitos El Rey',

  // Se llama al arrancar el servidor: si falta algo importante, avisa en claro.
  validar() {
    if (!this.pinSecret || this.pinSecret.length < 16) {
      throw new Error(
        'Falta PIN_SECRET en el archivo .env (una frase secreta de al menos 16 caracteres). ' +
          'Copia .env.example como .env y complétalo.'
      );
    }
  },
};

module.exports = config;

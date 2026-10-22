// Arma la aplicación Express: seguridad, rutas de la API y las pantallas (carpeta frontend/).
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const eventos = require('./eventos');
const { cargarSesion, requiereSesion } = require('./middleware/auth');
const { verificarOrigen } = require('./middleware/seguridad-http');
const { manejadorErrores, noEncontrada } = require('./middleware/errores');

function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.confiarProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      // Sin HTTPS (red del local) el navegador no debe forzar https en los recursos
      contentSecurityPolicy: {
        directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), ...(config.cookieSegura ? {} : { 'upgrade-insecure-requests': null }) },
      },
      hsts: config.cookieSegura,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
    })
  );
  app.use(express.json({ limit: '100kb' }));

  // ---- API
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', cargarSesion, verificarOrigen);

  app.get('/api/salud', (req, res) => res.json({ ok: true, negocio: config.negocioNombre }));
  app.get('/api/eventos', requiereSesion, eventos.conectar);

  // Cada cambio exitoso avisa a los demás dispositivos conectados
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET') {
      res.on('finish', () => {
        if (res.statusCode < 400) eventos.emitir();
      });
    }
    next();
  });

  app.use('/api/auth', require('./rutas/auth'));
  app.use('/api/asistencia', require('./rutas/asistencia'));
  app.use('/api/caja', require('./rutas/caja'));
  app.use('/api', require('./rutas/ventas'));
  app.use('/api', require('./rutas/personal'));
  app.use('/api', require('./rutas/catalogo'));
  app.use('/api', require('./rutas/inventario'));
  app.use('/api', require('./rutas/jornada'));
  app.use('/api', require('./rutas/planilla'));
  app.use('/api', require('./rutas/reportes'));
  app.use('/api', noEncontrada);

  // ---- Pantallas (PWA)
  const frontend = path.join(__dirname, '..', '..', 'frontend');
  app.use(express.static(frontend, { extensions: ['html'], setHeaders: (res, f) => { if (f.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); } }));

  app.use(noEncontrada);
  app.use(manejadorErrores);
  return app;
}

module.exports = { crearApp };

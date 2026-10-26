// Rutas CRUD de gaseosas. Se montan en app.js con:  app.use('/api/gaseosas', ...)
// por eso  router.get('/:id')  responde en  GET /api/gaseosas/:id
// Solo el dueño administra las gaseosas (requiere sesión con rol "dueno").
const express = require('express');
const controlador = require('../controladores/gaseosaController');
const { envolver } = require('../util/errores');
const { soloDueno } = require('../middleware/auth');

const router = express.Router();

router.use(soloDueno);

router.get('/', envolver(controlador.listar)); //            Read (todas)
router.get('/:id', envolver(controlador.obtener)); //        Read (una)
router.post('/', envolver(controlador.crear)); //            Create
router.put('/:id', envolver(controlador.actualizar)); //     Update (completo)
router.patch('/:id', envolver(controlador.actualizarParcial)); // Update parcial (pantalla del dueño)
router.delete('/:id', envolver(controlador.eliminar)); //    Delete

// Movimientos de stock (no son parte del CRUD, pero pertenecen a la misma entidad)
router.post('/ingreso', envolver(controlador.ingreso));
router.post('/conteo', envolver(controlador.conteo));

module.exports = router;

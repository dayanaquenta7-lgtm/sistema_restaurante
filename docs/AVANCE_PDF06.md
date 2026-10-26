# Avance PDF 06: API REST completa (CRUD, seguridad básica, pruebas y Docker)

**Proyecto:** Sistema de la broastería "Super Pollitos El Rey"
**Entidad elegida para el CRUD:** `gaseosas` (equivale a "productos" del PDF, en un sistema gastronómico)
**Tecnologías:** Node.js + Express 5 + **MySQL 8**. El PDF usa PostgreSQL; aquí se aplican los mismos conceptos en MySQL.

---

## 1. Qué se agregó en este avance

| Paso del PDF | Cómo quedó en el sistema | Archivo(s) |
|---|---|---|
| Paso 1: comprobar conexión | `GET /api/salud` ahora ejecuta `SELECT 1` y responde `base_de_datos: "conectada"` (503 si no hay base) | `backend/src/app.js` |
| Paso 2-3: servicio con `actualizar` y `eliminar` | Servicio nuevo con `listarGaseosas`, `obtenerGaseosaPorId`, `crearGaseosa`, `actualizarGaseosa`, `eliminarGaseosa` | `backend/src/servicios/gaseosas.js` |
| 5.1 `validarDatosProducto()` | `validarDatosGaseosa()`, reutilizada en POST y PUT | `backend/src/servicios/gaseosas.js` |
| 5.2 UPDATE con WHERE | `UPDATE gaseosas SET ... WHERE id = ?` dentro de una transacción con `SELECT ... FOR UPDATE` | ídem |
| 5.3 DELETE + RETURNING | MySQL no tiene `RETURNING`: se lee el registro antes de borrarlo y se devuelve | ídem |
| Paso 4: controlador + `validarId()` | Controlador nuevo (capa que antes no existía en el proyecto) | `backend/src/controladores/gaseosaController.js` |
| Paso 5: rutas CRUD | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` (+ `PATCH`, `ingreso`, `conteo` que ya existían) | `backend/src/rutas/gaseosas.js`, `backend/src/app.js` |
| Pasos 6-12: pruebas | Pruebas automáticas de la tabla del PDF (casos A–E) + colección Postman | `backend/tests/gaseosas-crud.test.js`, `docs/postman_gaseosas.json` |
| Paso 13-14: Helmet | **Ya estaba** configurado desde avances anteriores; las pruebas verifican sus cabeceras | `backend/src/app.js` |
| Paso 16: Dockerfile | `node:22-alpine`, `npm ci --omit=dev`, usuario sin privilegios | `backend/Dockerfile` |
| Paso 17: .dockerignore | En la **raíz** (el build se hace desde la raíz porque el backend necesita `frontend/` y `db/`) | `.dockerignore` |
| Paso 18: init.sql | Equivale a los scripts que ya existen en `db/` (01, 02, 03, 05), montados en `/docker-entrypoint-initdb.d` | `docker-compose.yml` |
| Paso 19: `.env.docker` | Variables de Docker y su plantilla; `.gitignore` reforzado | `.env.docker.example`, `.gitignore` |
| Paso 20: docker-compose.yml | Servicios `db` (MySQL 8.4, healthcheck, puerto 3307) y `app` (`DB_HOST=db`), volumen `mysql_data` | `docker-compose.yml` |
| Paso 27: README | Arquitectura, API, validaciones, base de datos, Docker, seguridad y tabla de pruebas | `README.md` |
| Desafío final | CRUD adaptado a una entidad real del negocio, más editar/eliminar desde la pantalla del dueño | `frontend/js/dueno.js` |

**Extras propios del negocio:**
- **DELETE responsable:** solo se elimina una gaseosa **sin historial** (registrada por error). Si ya tiene ingresos, ventas o pérdidas, responde **409** y pide desactivarla, porque borrarla rompería los reportes.
- **Bitácora:** el `PUT` queda registrado por trigger (se amplió para anotar también los cambios de marca y tamaño en `db/07_crud_gaseosas.sql`) y el `DELETE` lo anota la API.
- Se agregó `backend/.env.example`, que el README mencionaba pero no existía.

---

## 2. Tabla de pruebas

Se ejecuta con `cd backend && npm run test:crud`. **14 de 14 pruebas pasaron** en el entorno de desarrollo, con una base compatible con MySQL.

| Prueba | Resultado esperado | ¿Funcionó? |
|---|---|---|
| Listar gaseosas | 200 | Sí |
| Consultar una existente | 200 | Sí |
| Crear gaseosa válida | 201 | Sí |
| Actualizar gaseosa existente (y verificar con GET y en MySQL) | 200 | Sí |
| Eliminar gaseosa existente (luego GET → 404) | 200 | Sí |
| Consultar una inexistente (`/999999`) | 404 | Sí |
| Caso A: precio negativo (y precio 0) | 400 | Sí |
| Caso B: marca demasiado corta (`"A"`) | 400 | Sí |
| Caso C: ID no numérico (`abc`, `-1`, `0`, `1.5`) | 400 | Sí |
| Caso E: PUT incorrecto, el registro no cambia | 400 | Sí |
| Gaseosa repetida (misma marca y tamaño) | 409 | Sí |
| Eliminar gaseosa con historial | 409 | Sí |
| Sin sesión / rol de caja | 401 / 403 | Sí |
| Cabeceras de Helmet presentes, sin `X-Powered-By` | — | Sí |

> **Pendiente de evidencia en tu equipo:** correr `npm test` contra tu MySQL 8 y levantar `docker compose` (pasos 21-26), y tomar las capturas. En el entorno donde se desarrolló no había acceso a Docker Hub para descargar las imágenes. El `docker-compose.yml` sí se validó con `docker compose config`.

### Verificación directa en MySQL (paso 12)
```sql
USE broasteria;
SELECT id, marca, tamano, precio, activo FROM gaseosas ORDER BY id;
SELECT fecha_hora, accion, entidad_id, valor_anterior, valor_nuevo
  FROM bitacora WHERE entidad = 'gaseosas' ORDER BY id DESC LIMIT 10;
```
Con Docker, conecta Workbench a `127.0.0.1:3307` con el usuario de `.env.docker`.

---

## 3. Recorrido de una actualización (Detente y explica 4)

1. **Método:** `PUT /api/gaseosas/5` con `{ "marca": "Coca-Cola", "tamano": "2 L", "precio": 13 }`.
2. **Ruta:** `backend/src/rutas/gaseosas.js` → `router.put('/:id', ...)`, montada en `app.js` como `/api/gaseosas`. Antes pasa por `soloDueno`.
3. **Controlador:** `actualizar()` en `gaseosaController.js` valida el id con `validarId()`.
4. **Servicio:** `actualizarGaseosa()` valida los datos con `validarDatosGaseosa()` y ejecuta `UPDATE gaseosas SET marca = ?, tamano = ?, precio = ?, ... WHERE id = ?`.
5. **En MySQL:** cambia esa fila y el trigger `trg_gaseosas_au` guarda el antes y el después en `bitacora`.
6. **Comprobación:** un nuevo `GET /api/gaseosas/5` y el `SELECT` directo en MySQL muestran los nuevos valores.

## 4. Respuestas "Detente y explica"

**1.** La configuración de conexión está en `backend/src/config.js`, que lee `backend/.env`; el pool está en `backend/src/db.js`. Las consultas las ejecutan los servicios (`servicios/gaseosas.js`) con `pool.query`. En un arreglo los datos se pierden al reiniciar; en MySQL persisten y la base aplica restricciones. Si el producto no existe, el servicio devuelve `undefined` y la API responde 404.

**2.** `UPDATE` modifica registros existentes. Sin `WHERE`, cambiaría todas las gaseosas. `RETURNING` (de PostgreSQL) devuelve el registro afectado; en MySQL se reemplaza leyendo la fila con `SELECT`. `validarDatosGaseosa()` se reutiliza para no duplicar las reglas entre POST y PUT. Si se elimina un id inexistente, el servicio devuelve `undefined` y la API responde 404.

**3.** GET consulta y POST crea. PUT reemplaza los datos de un registro existente. `:id` es un parámetro de la URL (`req.params.id`). El archivo `controladores/gaseosaController.js` conecta las rutas con el servicio. La ruta no lleva SQL porque cada capa tiene una sola responsabilidad.

**5.** Helmet agrega cabeceras de seguridad HTTP (CSP, `nosniff`, `X-Frame-Options`...). Las consultas parametrizadas evitan la **inyección SQL**. `.env` no se publica porque contiene contraseñas y el `PIN_SECRET`. Una contraseña en un mensaje de error quedaría expuesta a cualquier cliente. Estas medidas no dicen **quién** puede hacer qué: para eso el sistema ya tiene sesión con PIN/contraseña y roles.

**6.** El Dockerfile describe cómo construir la imagen del backend. `docker-compose.yml` define y conecta los servicios `db` y `app`. Dentro de Docker, `localhost` es el propio contenedor, por eso se usa `DB_HOST=db` (el nombre del servicio). Un contenedor es desechable; el volumen `mysql_data` guarda los datos fuera de él, y por eso `down` + `up` no borra nada (`down -v` sí). Las credenciales no van en el Dockerfile porque quedarían grabadas en la imagen.

---

## 5. Evidencias para la entrega (checklist)

- [ ] 1. Estructura `rutas/`, `controladores/`, `servicios/`, `db.js` (captura del explorador de VS Code)
- [ ] 2. Consultas parametrizadas (`servicios/gaseosas.js`)
- [ ] 3-6. Postman: GET, POST (201), PUT (200 + GET de verificación), DELETE (200 + GET 404)
- [ ] 7. Casos A–E (400/404) y salida de `npm run test:crud`
- [ ] 8. `SELECT` en Workbench
- [ ] 9. Datos que siguen después de `down` / `up -d`
- [ ] 10-11. `backend/Dockerfile` y `docker-compose.yml`
- [ ] 12. `docker compose --env-file .env.docker ps` con `db` healthy y `app` running
- [ ] 13. README actualizado
- [ ] 14. GitHub sin `.env` ni `.env.docker` (`git status` antes de `git add .`)

## 6. Registro de uso responsable de IA (borrador: complétalo con tus palabras)

- **Problema:** completar el CRUD y llevar el sistema a Docker usando MySQL en lugar de PostgreSQL.
- **Consulta:** cómo aplicar el PDF 06 a mi sistema existente sin romper lo anterior.
- **Explicación obtenida:** separación ruta → controlador → servicio, `RETURNING` vs MySQL, `DB_HOST=db`, volúmenes y scripts de inicialización.
- **Adaptación:** la entidad es `gaseosas`; DELETE solo sin historial (409 si tiene ventas); scripts de `db/` como `init.sql`.
- **Verificación:** `npm run test:crud` (14/14), pruebas en Postman, `docker compose config`, … *(agrega lo que verificaste tú)*
- **Aprendizaje:** *(qué puedes explicar o modificar ahora por tu cuenta)*

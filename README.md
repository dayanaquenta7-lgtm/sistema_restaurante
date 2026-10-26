# Sistema de la Broastería

Registro simple de **pollo, gaseosas, caja, personal y sueldos**. El dueño anota; el sistema calcula.
Funciona en celular, tablet y computadora (PWA) dentro del wifi del local.

- **Backend:** Node.js 20+ · Express 5 · MySQL 8 (la lógica de stock y dinero vive en la base de datos)
- **Pantallas:** HTML/JS sin dependencias, carpeta `frontend/` (la sirve el mismo servidor)
- **Docker:** `docker-compose.yml` levanta MySQL + backend con un volumen para los datos

## Arquitectura del backend

```
backend/
├── server.js                 arranque (puerto, direcciones de red)
├── Dockerfile                imagen del backend
├── src/
│   ├── app.js                Express + Helmet + montaje de rutas
│   ├── config.js             variables de entorno (.env)
│   ├── db.js                 conexión a MySQL (pool) y transacciones
│   ├── rutas/                define las rutas HTTP
│   ├── controladores/        coordina la petición y el código HTTP (gaseosaController.js)
│   ├── servicios/            consultas SQL y reglas del negocio (gaseosas.js, ventas.js, ...)
│   ├── middleware/           sesión y roles, seguridad, manejo central de errores
│   └── util/                 validación (zod), errores, bitácora, cifrado de PIN
└── tests/                    pruebas automáticas (node --test)
db/                           scripts SQL (tablas, triggers, procedimientos, datos iniciales)
frontend/                     pantallas (PWA)
```

## API de gaseosas (CRUD completo)

Requiere sesión del **dueño** (`POST /api/auth/dueno` con `{ "nombre", "clave" }`; la sesión queda en una cookie).

| Método | Ruta | Qué hace | Respuesta |
|---|---|---|---|
| GET | `/api/gaseosas` | Lista todas (con su stock) | 200 |
| GET | `/api/gaseosas/:id` | Consulta una | 200 / 404 |
| POST | `/api/gaseosas` | Registra `{ marca, tamano, precio, stock_minimo?, activo? }` | 201 |
| PUT | `/api/gaseosas/:id` | Actualiza marca, tamaño, precio (y opcionalmente stock mínimo/activo) | 200 / 404 |
| PATCH | `/api/gaseosas/:id` | Cambio parcial (precio, activo, stock mínimo) | 200 / 404 |
| DELETE | `/api/gaseosas/:id` | Elimina una gaseosa **sin historial** | 200 / 404 / 409 |
| POST | `/api/gaseosas/ingreso` | "Llegaron gaseosas" (suma stock) | 201 |
| POST | `/api/gaseosas/conteo` | "Contar lo que queda" (ajusta diferencias) | 200 |

Otros códigos: **400** datos o id inválidos · **401** sin sesión · **403** sin permiso · **409** repetida (misma marca y tamaño)
o con ventas/ingresos (no se borra para no perder la historia: se desactiva) · **500** error interno sin detalles sensibles.

Colección lista para Postman: `docs/postman_gaseosas.json` (cambia las variables `dueno_nombre` y `dueno_clave`).

### Validaciones
- Marca entre 2 y 60 caracteres; tamaño entre 1 y 30.
- Precio numérico **mayor que cero**, máximo 2 decimales.
- Identificador entero positivo (`/api/gaseosas/abc` → 400 antes de consultar la base).
- MySQL también protege: `CHECK (precio >= 0)`, `UNIQUE (marca, tamano)`, `NOT NULL` y llaves foráneas.

### Base de datos
- MySQL 8 (base `broasteria`), almacenamiento persistente.
- La lógica de stock y dinero vive en triggers y procedimientos (`db/02_logica.sql`).
- Todo cambio de gaseosas queda en la **bitácora** (quién, cuándo, antes y después).

### Seguridad
- Credenciales solo en `.env` / `.env.docker` (no se suben a GitHub).
- Consultas SQL **parametrizadas** (`?`) en todo el backend.
- Las solicitudes se validan antes de registrarse (zod) y los errores no muestran contraseñas ni SQL.
- **Helmet** (cabeceras de seguridad HTTP), límite de intentos de PIN, protección de origen (CSRF).
- Inicio de sesión con PIN/contraseña y permisos por rol (dueño / atención).

## 1. Instalar (una sola vez)

1. Instala **Node.js 20 o 22** y **MySQL 8**.
2. En `backend/`, copia `.env.example` como `.env` y completa:
   - `DB_USER` y `DB_PASSWORD` de tu MySQL
   - `PIN_SECRET`: una frase larga y secreta (¡no la cambies después: los PIN dejarían de funcionar!)
3. En una terminal:

```bash
cd backend
npm install
npm run db:crear        # crea la base "broasteria" con tablas, reglas y datos iniciales
npm run crear-dueno     # te pide nombre, PIN y contraseña del dueño
npm start
```

El servidor muestra dos direcciones: `http://localhost:3000` (esta computadora) y
`http://192.168.x.x:3000` (para tablets y celulares conectados al mismo wifi).

## 1.b Ejecutar con Docker (MySQL + backend en contenedores)

Requisito: Docker Desktop (o Docker Engine) con Docker Compose.

1. Copia `.env.docker.example` como `.env.docker` (raíz del proyecto) y cambia las claves.
2. Verifica que exista `backend/.env` (de él se toman `PIN_SECRET` y el nombre del negocio).
3. Desde la raíz del proyecto:

```bash
docker compose --env-file .env.docker config          # revisa la configuración (puede mostrar claves: no la publiques)
docker compose --env-file .env.docker up -d --build   # construye la imagen e inicia db + app
docker compose --env-file .env.docker ps              # ambos "running"; db "healthy"
docker compose --env-file .env.docker logs app        # mensajes del backend   (agrega -f para verlos en vivo)
docker compose --env-file .env.docker logs db         # mensajes de MySQL
docker compose --env-file .env.docker exec app npm run crear-dueno   # solo la primera vez
```

Abre `http://localhost:3000/api/salud` → `"base_de_datos": "conectada"`.

- MySQL de Docker se expone en el puerto **3307** de tu equipo (Workbench: `127.0.0.1:3307`), así no choca con tu MySQL local en 3306.
  Dentro de Docker el backend usa `DB_HOST=db` y el puerto interno 3306.
- Las tablas se crean solas la **primera vez** (scripts de `db/` montados en `/docker-entrypoint-initdb.d`).
  `06_mejoras.sql` y `07_crud_gaseosas.sql` los aplica el backend cada vez que arranca.
- Los datos viven en el volumen `mysql_data`: `docker compose --env-file .env.docker down` y luego `up -d` **no** los borra.
  **No uses `down -v`**: elimina el volumen con todos los datos.
- Esta base es independiente de tu MySQL local: lo que registres en una no aparece en la otra.

## 2. Uso diario (lo que ve el dueño)

| Pantalla | Para qué |
|---|---|
| **Inicio** | Frases cortas: cuánto vendiste, pollos y gaseosas que quedan, quién llegó tarde, alertas |
| **Pollos** | "Llegaron pollos", "Abrir pollos" (1 pollo = 10 presas + 4 aumentos), contar, gaseosas (marca, tamaño, precio) |
| **Personal** | Alta de empleados con PIN, sueldo y turno; asistencia de hoy; plan semanal (opcional) |
| **Sueldos** | Cuánto se paga a cada persona (con vista previa), adelantos/bonos, cerrar planilla (queda congelada), boletas |
| **Día** | Registro del día: vendido, cuadre de presas, gastos, pérdidas, cajas con diferencias; **Cerrar el día** |
| **Más** | Precios, pura papa (+Bs 1, se activa/apaga), reglas (tolerancia, descuento por minuto), turnos, bitácora |

El personal de caja entra con su **PIN**: abre su caja, vende (2 tickets por venta), anota pérdidas y gastos,
y al terminar cierra su caja y recibe el informe. **Solo la encargada** cuenta y guarda el efectivo.

### Tablet de asistencia
Abre `http://IP-DEL-SERVIDOR:3000/asistencia.html` en la tablet fija del local. Cada persona escribe su PIN:
la primera vez del día es la llegada y la siguiente la salida. La asistencia es lo único que genera pago.
Opcional: define `TABLET_KEY` en `.env` y abre una vez `.../asistencia.html?clave=LA_CLAVE` en la tablet para que
solo ella pueda marcar.

### Instalar como app
En Chrome/Edge: menú ▸ "Instalar aplicación". En iPhone/iPad (Safari): Compartir ▸ "Añadir a pantalla de inicio".

## Programa de escritorio (sin internet)

El sistema **no necesita internet**: todo corre en la computadora del local (servidor + MySQL + pantallas).
El wifi solo se usa para que tablets y celulares se conecten a esa computadora; si no hay wifi, se atiende
directo en la computadora.

Para usarlo como un programa de Windows (icono en el escritorio, se enciende solo al prender la PC):

```bash
cd programa
npm install
npm start               # abre el programa (la primera vez muestra un asistente para crear la base y el dueño)
npm run instalador      # arma el instalador .exe en programa/dist (hazlo en Windows)
```

Requisito: **MySQL 8 instalado y encendido** en esa computadora (servicio de Windows).
La primera vez, el asistente pide la contraseña de MySQL, tu nombre, PIN y contraseña de dueño.
Menú **Sistema ▸ Dirección para tablets y celulares** muestra la dirección para otros aparatos.

## Interfaz
Colores del negocio (rojo, amarillo y azul). Casi todo se hace tocando botones: platos, acompañamientos,
dónde come, cómo paga, billetes ("Justo / Bs 50 / Bs 100"), teclado numérico grande para montos y contador de billetes
para contar la caja. Solo se escribe el nombre del cliente en pedidos por llamada.
En pantalla grande el pedido queda a la derecha con **TOTAL y COBRAR siempre visibles**; en celular una barra
"Ver pedido" lleva al pedido y se oculta cuando ya lo estás viendo.

## 3. Pruebas automáticas

```bash
cd backend
npm test           # recrea la base "broasteria_test": día completo, turno y CRUD de gaseosas
npm run test:crud  # solo el CRUD de gaseosas (casos correctos y negativos A–E del PDF 06)
```

| Prueba | Esperado |
|---|---|
| Listar gaseosas | 200 |
| Consultar una existente | 200 |
| Crear gaseosa válida | 201 |
| Actualizar existente (y volver a consultarla) | 200 |
| Eliminar existente (y luego consultar → 404) | 200 |
| Consultar una inexistente | 404 |
| Precio negativo o cero | 400 |
| Marca demasiado corta | 400 |
| ID no numérico (`abc`, `-1`, `1.5`) | 400 |
| PUT con datos incorrectos (no cambia nada) | 400 |
| Gaseosa repetida (marca + tamaño) | 409 |
| Borrar gaseosa con ingresos/ventas | 409 |

## 4. Copias de seguridad
Haz una copia diaria: `mysqldump -u root -p broasteria > backups/broasteria_AAAA-MM-DD.sql`
(la carpeta `backups/` está en `.gitignore`).

## 5. Subir a GitHub (tu repositorio `sistema_restaurante`)

```bash
git add .
git commit -m "Sistema completo: API, base de datos y pantallas"
git push
```
`.env`, `.env.docker` y `node_modules/` no se suben (están en `.gitignore`). Antes de `git add .` revisa con
`git status` que no aparezcan. Si alguna clave real ya se publicó antes, cámbiala: borrarla después no la quita del historial.

## 6. Notas
- Hora de Bolivia (UTC-4) fija en el servidor; "el día" cambia a medianoche local.
- Sin internet en el local el sistema sigue funcionando (todo está en tu red); sin wifi no se puede vender.
- Para usarlo fuera del local o con candado HTTPS, ponlo detrás de Caddy/Nginx y activa `COOKIE_SECURE=true` y `CONFIAR_PROXY=true`.
- Base de datos en `db/` (`01_schema`, `02_logica`, `03_datos_iniciales`, `05_api`, `06_mejoras`, `07_crud_gaseosas`); `db/pruebas/` es solo una simulación.
- Avance del PDF 06 (CRUD, pruebas, seguridad y Docker): `docs/AVANCE_PDF06.md`.

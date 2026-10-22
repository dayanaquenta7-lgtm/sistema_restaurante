# Sistema de la Broastería

Registro simple de **pollo, gaseosas, caja, personal y sueldos**. El dueño anota; el sistema calcula.
Funciona en celular, tablet y computadora (PWA) dentro del wifi del local.

- **Backend:** Node.js 20+ · Express 5 · MySQL 8 (la lógica de stock y dinero vive en la base de datos)
- **Pantallas:** HTML/JS sin dependencias, carpeta `frontend/` (la sirve el mismo servidor)

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
npm test     # recrea la base "broasteria_test" y simula un día completo (13 pruebas)
```

## 4. Copias de seguridad
Haz una copia diaria: `mysqldump -u root -p broasteria > backups/broasteria_AAAA-MM-DD.sql`
(la carpeta `backups/` está en `.gitignore`).

## 5. Subir a GitHub (tu repositorio `sistema_restaurante`)

```bash
git add .
git commit -m "Sistema completo: API, base de datos y pantallas"
git push
```
`.env` y `node_modules/` no se suben (están en `.gitignore`).

## 6. Notas
- Hora de Bolivia (UTC-4) fija en el servidor; "el día" cambia a medianoche local.
- Sin internet en el local el sistema sigue funcionando (todo está en tu red); sin wifi no se puede vender.
- Para usarlo fuera del local o con candado HTTPS, ponlo detrás de Caddy/Nginx y activa `COOKIE_SECURE=true` y `CONFIAR_PROXY=true`.
- Base de datos en `db/` (`01_schema`, `02_logica`, `03_datos_iniciales`, `05_api`); `db/pruebas/` es solo una simulación.

// Programa de escritorio de Super Pollitos El Rey.
// Enciende el sistema en esta computadora y lo muestra en su propia ventana.
// No necesita internet: todo (pantallas, servidor y base de datos) está en el local.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Para pruebas: otra carpeta de datos
if (process.env.SP_DATOS) app.setPath('userData', process.env.SP_DATOS);

const raiz = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const backend = path.join(raiz, 'backend');
const archivoEnv = path.join(app.getPath('userData'), 'configuracion.env');
// Si se corre desde el código (no instalado) y ya existe backend/.env, se usa ese (así no hay que configurar dos veces)
const envDesarrollo = path.join(backend, '.env');
const usarEnvDesarrollo = !app.isPackaged && fs.existsSync(envDesarrollo) && !process.env.SP_DATOS;
const rutaEnv = usarEnvDesarrollo ? envDesarrollo : archivoEnv;
const icono = path.join(__dirname, 'img', 'icono.png');

let ventana = null;
let sistema = null; // módulo backend/server.js
let info = null; // { puerto, direcciones }
let cerrando = false;

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });
}

function ventanaBase(opciones = {}) {
  return new BrowserWindow({ width: 1280, height: 800, minWidth: 360, minHeight: 500, backgroundColor: '#0f2466', title: 'Super Pollitos El Rey', icon: icono, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, ...(opciones.webPreferences || {}) }, ...opciones, ...(opciones.webPreferences ? { webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, ...opciones.webPreferences } } : {}) });
}

// ------------------------------------------------------------------ primera vez: asistente
const comillas = (v) => { if (/["\n\r]/.test(v)) throw new Error('No uses comillas ni saltos de línea.'); return `"${v}"`; };

async function instalar({ mysqlClave, nombre, pin, clave }) {
  try {
    nombre = String(nombre || '').trim();
    if (nombre.length < 2) throw new Error('Escribe el nombre del dueño.');
    if (!/^\d{4,6}$/.test(String(pin))) throw new Error('El PIN debe tener de 4 a 6 números.');
    if (String(clave || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    mysqlClave = String(mysqlClave ?? '');

    // ¿MySQL responde con esa contraseña?
    const mysql = require(path.join(backend, 'node_modules', 'mysql2', 'promise'));
    try {
      const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: mysqlClave });
      await c.end();
    } catch (e) {
      if (e.code === 'ER_ACCESS_DENIED_ERROR') throw new Error('La contraseña de MySQL no es correcta.');
      if (e.code === 'ECONNREFUSED') throw new Error('MySQL no está encendido. Enciéndelo (Servicios de Windows → MySQL → Iniciar) y vuelve a intentar.');
      throw e;
    }

    fs.mkdirSync(path.dirname(rutaEnv), { recursive: true });
    fs.writeFileSync(rutaEnv, [
      'PORT=3000', 'NODE_ENV=production', 'COOKIE_SECURE=false',
      'DB_HOST=127.0.0.1', 'DB_PORT=3306', 'DB_USER=root', `DB_PASSWORD=${comillas(mysqlClave)}`, `DB_NAME=${process.env.SP_DB_NAME || 'broasteria'}`,
      `PIN_SECRET=${crypto.randomBytes(24).toString('hex')}`, 'NEGOCIO_NOMBRE=Super Pollitos El Rey', ''].join('\n'), { mode: 0o600 });

    process.env.SISTEMA_ENV = rutaEnv;
    const { crearBase, crearDueno } = require(path.join(backend, 'src', 'instalar.js'));
    await crearBase({});
    await crearDueno({ nombre, pin, clave });
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true }); // se enciende solo al prender la computadora
    setImmediate(() => iniciarYMostrar(true));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function mostrarAsistente() {
  ventana = ventanaBase({ width: 640, height: 780, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  ventana.setMenu(null);
  ventana.loadFile(path.join(__dirname, 'asistente.html'));
}

// ------------------------------------------------------------------ el sistema
async function iniciarYMostrar(cierraAsistente = false) {
  process.env.SISTEMA_ENV = rutaEnv;
  try {
    sistema = require(path.join(backend, 'server.js'));
    info = await sistema.iniciar();
  } catch (e) {
    const texto = e.code === 'EADDRINUSE'
      ? 'Ya hay otro programa usando el puerto 3000. Cierra el otro sistema y vuelve a intentar.'
      : e.message;
    const r = dialog.showMessageBoxSync({ type: 'error', title: 'Super Pollitos El Rey', message: 'No se pudo encender el sistema', detail: `${texto}\n\nSi MySQL estaba apagado, enciéndelo (Servicios de Windows → MySQL → Iniciar).`, buttons: ['Reintentar', 'Salir'], defaultId: 0, cancelId: 1 });
    if (r === 0) return iniciarYMostrar(cierraAsistente);
    cerrando = true; return app.quit();
  }
  const vieja = ventana;
  ventana = ventanaBase({ show: false });
  ventana.maximize();
  ventana.loadURL(`http://localhost:${info.puerto}`);
  ventana.once('ready-to-show', () => { ventana.show(); if (vieja && !vieja.isDestroyed()) { vieja.removeAllListeners('close'); vieja.destroy(); } });
  ventana.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url) && !url.startsWith(`http://localhost:${info.puerto}`)) shell.openExternal(url); return { action: 'deny' }; });
  ventana.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://localhost:${info.puerto}`)) { e.preventDefault(); shell.openExternal(url); } });
  ventana.webContents.on('did-fail-load', (_e, codigo, _desc, _url, principal) => { if (principal && codigo !== -3) setTimeout(() => ventana?.loadURL(`http://localhost:${info.puerto}`), 1500); });
  ventana.on('close', (e) => {
    if (cerrando) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(ventana, { type: 'question', title: 'Cerrar el sistema', message: '¿Cerrar el programa?', detail: 'Si lo cierras, las tablets y celulares dejarán de funcionar hasta que lo vuelvas a abrir.', buttons: ['Sí, cerrar', 'No, seguir'], defaultId: 1, cancelId: 1 });
    if (r === 0) { cerrando = true; app.quit(); }
  });
  armarMenu();
}

function armarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Sistema', submenu: [
      { label: 'Dirección para tablets y celulares', click: () => {
        const lista = info.direcciones.length ? info.direcciones.join('\n') : '(no se encontró una red; conecta esta computadora al wifi del local)';
        dialog.showMessageBox(ventana, { type: 'info', title: 'Otros aparatos', message: 'Abre esta dirección en la tablet o celular', detail: `${lista}\n\nLos aparatos tienen que estar conectados al mismo wifi del local. No hace falta internet.\n\nTablet de asistencia: agrega /asistencia.html al final.`, buttons: ['Listo'] });
      } },
      { type: 'separator' },
      { label: 'Recargar pantalla', accelerator: 'CmdOrCtrl+R', click: () => ventana.reload() },
      { label: 'Pantalla completa', accelerator: 'F11', click: () => ventana.setFullScreen(!ventana.isFullScreen()) },
      { type: 'separator' },
      { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: () => ventana.close() },
    ] }]));
  ventana.setAutoHideMenuBar(false);
  ventana.setMenuBarVisibility(true);
}

ipcMain.handle('instalar', (_e, datos) => instalar(datos));

app.whenReady().then(() => {
  if (!app.isPackaged) Menu.setApplicationMenu(null);
  if (fs.existsSync(rutaEnv)) iniciarYMostrar(); else mostrarAsistente();
});
app.on('window-all-closed', () => { if (cerrando || !info) app.quit(); });
app.on('before-quit', async (e) => {
  if (sistema && !app.__apagado) { e.preventDefault(); app.__apagado = true; cerrando = true; await sistema.apagar().catch(() => {}); app.quit(); }
});

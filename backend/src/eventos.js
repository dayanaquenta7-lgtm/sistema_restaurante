// Avisos en vivo (Server-Sent Events): cuando alguien vende o cambia algo, los demás
// dispositivos (la otra tablet de caja, el celular del dueño) se enteran y se actualizan solos.
const clientes = new Set();

function conectar(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // para que Nginx no retenga los avisos
  });
  res.write('retry: 3000\n\n');
  clientes.add(res);
  req.on('close', () => clientes.delete(res));
}

let pendiente = null;
/** Avisa a todos que algo cambió. Junta varios cambios seguidos en un solo aviso. */
function emitir(tipo = 'cambio') {
  if (pendiente) return;
  pendiente = setTimeout(() => {
    pendiente = null;
    const mensaje = `data: ${JSON.stringify({ tipo, t: Date.now() })}\n\n`;
    for (const c of clientes) c.write(mensaje);
  }, 120);
  pendiente.unref?.();
}

// Mantiene viva la conexión (algunos routers cortan las conexiones silenciosas)
setInterval(() => {
  for (const c of clientes) c.write(': ping\n\n');
}, 25000).unref();

const conectados = () => clientes.size;

module.exports = { conectar, emitir, conectados };

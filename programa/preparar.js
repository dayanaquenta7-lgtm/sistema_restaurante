// Antes de armar el instalador: deja en backend solo las librerías que el sistema necesita para funcionar.
const { execSync } = require('child_process');
const path = require('path');
const backend = path.join(__dirname, '..', 'backend');
console.log('Preparando el sistema para el instalador...');
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: backend, stdio: 'inherit' });
console.log('Listo. Armando el instalador...');

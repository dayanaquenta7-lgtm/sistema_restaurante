# Imagen del backend (Node.js + Express) de la broastería.
#
# Se construye desde la RAÍZ del proyecto (lo hace docker-compose.yml), porque el
# servidor también necesita las pantallas (frontend/) y los scripts SQL (db/):
#     docker build -f backend/Dockerfile -t broasteria-app .
#
# Nunca escribas contraseñas aquí: llegan como variables de entorno desde Docker Compose.

FROM node:22-alpine

# Hora de Bolivia y modo producción
ENV NODE_ENV=production \
    TZ=America/La_Paz

WORKDIR /app/backend

# 1) Primero solo package*.json: si no cambian, Docker reutiliza la capa de dependencias
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 2) Después el código
COPY backend/ ./
COPY frontend/ ../frontend/
COPY db/ ../db/

# No ejecutar como administrador dentro del contenedor
USER node

EXPOSE 3000

CMD ["node", "server.js"]

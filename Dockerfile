FROM node:24-slim

WORKDIR /app

# Instala solo las dependencias de producción (se cachea si package*.json no cambia)
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "server.js"]

FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server/index.js"]

FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python-is-python3 make gcc libsodium-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production=false

COPY . .

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server/index.js"]

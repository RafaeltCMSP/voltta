# Base Debian slim (não Alpine): tem glibc + openssl 3 nativos, que é o ambiente
# mais estável para o Prisma (evita o erro de libssl/schema engine no Alpine/musl).

# ───────── build ─────────
FROM node:20-slim AS build
WORKDIR /app

# openssl: o Prisma precisa dele para detectar a libssl e usar o engine certo.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Instala TODAS as deps (inclui dev: typescript, tsx) para compilar.
COPY package*.json ./
RUN npm ci

# Gera o Prisma Client e compila o TypeScript.
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ───────── runtime ─────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# openssl: necessário em runtime para o query/schema engine do Prisma (db push + queries).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Só dependências de produção (inclui o CLI `prisma` p/ o db push no boot).
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Prisma Client + schema (usado no db push).
COPY prisma ./prisma
RUN npx prisma generate

# Código já compilado.
COPY --from=build /app/dist ./dist

# Entrypoint: aplica o schema no banco e sobe o app.
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3333
ENTRYPOINT ["./docker-entrypoint.sh"]

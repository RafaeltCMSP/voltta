# ───────── build ─────────
FROM node:20-alpine AS build
WORKDIR /app

# openssl: o Prisma precisa dele no Alpine para detectar a libssl e usar o engine certo.
RUN apk add --no-cache openssl

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
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# openssl: necessário em runtime para o query engine do Prisma (db push + queries).
RUN apk add --no-cache openssl

# Só dependências de produção (inclui o CLI `prisma` p/ o db push no boot).
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Prisma Client para o ambiente alpine/musl + o schema (usado no db push).
COPY prisma ./prisma
RUN npx prisma generate

# Código já compilado.
COPY --from=build /app/dist ./dist

# Entrypoint: aplica o schema no banco e sobe o app.
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3333
ENTRYPOINT ["./docker-entrypoint.sh"]

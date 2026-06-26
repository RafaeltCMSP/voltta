# Deploy do Voltta no EasyPanel

Há duas formas. A **Opção A (Compose)** sobe **tudo de uma vez** a partir do repo —
é a mais fácil e a recomendada. A Opção B cria os serviços separadamente (mais controle).

---

## ✅ Opção A — Tudo num serviço (Docker Compose)  ← recomendada

O repositório já tem um `docker-compose.yml` com **App + Postgres + Redis** prontos e
interligados. O EasyPanel sobe os três de uma vez; você só preenche as chaves.

### Passo 1 — Criar o serviço Compose
No EasyPanel: **Create Project** → `voltta` → **+ Service → Compose**.
- **Source**: GitHub → repositório `RafaeltCMSP/voltta`, branch `main`.
- **Compose file**: `docker-compose.yml` (padrão).

### Passo 2 — Variáveis de ambiente
Na aba **Environment** do serviço, cole só o que é segredo/seu (o resto já tem padrão
no compose, e o `DATABASE_URL`/`REDIS_URL` são montados automaticamente entre os serviços):

```env
# Loja Integrada (obrigatório)
LI_USE_MOCK=false
LI_API_KEY=COLE_A_CHAVE_DE_API
LI_APPLICATION_KEY=COLE_A_CHAVE_DE_APLICACAO

# Segurança (recomendado trocar)
POSTGRES_PASSWORD=uma-senha-forte
LI_WEBHOOK_SECRET=um-segredo-forte

# Identificação da loja (opcional)
STORE_NAME=Minha Loja

# Evolution API (WhatsApp) — pode deixar de fora agora e preencher quando ativar o envio
# EVOLUTION_BASE_URL=https://sua-evolution...
# EVOLUTION_API_KEY=...
# EVOLUTION_INSTANCE=...
```

### Passo 3 — Deploy
Clique em **Deploy**. O EasyPanel builda o `Dockerfile`, sobe Postgres + Redis e o App.
No boot, o container do app:
1. espera o Postgres ficar saudável (healthcheck);
2. roda `prisma db push` (cria as tabelas);
3. configura a loja `principal` a partir das env;
4. sobe servidor + worker + monitor de polling.

### Passo 4 — Domínio (opcional)
Para acessar o `/health` por fora, em **Domains** do serviço aponte um domínio para o
serviço **app** na porta **3333**. (O monitor por polling **não** exige domínio.)

> Pronto. Tudo num serviço só. Para atualizar, dê **Deploy** de novo (os volumes do
> Postgres/Redis são preservados; `db push` é idempotente e não apaga dados).

---

## Opção B — Serviços separados (Postgres, Redis e App)

Use se preferir gerenciar o banco e o Redis como serviços próprios do EasyPanel.

1. **+ Service → Postgres** (nome `postgres`, defina senha). Anote o host interno
   `voltta_postgres` e a senha.
2. **+ Service → Redis** (nome `redis`). Host interno `voltta_redis`.
3. **+ Service → App**: Source = GitHub `RafaeltCMSP/voltta`; Build = Dockerfile; Port 3333.
4. Em **Environment** do App, cole:

```env
NODE_ENV=production
PORT=3333
DATABASE_URL=postgresql://postgres:SUA_SENHA@voltta_postgres:5432/postgres?schema=public
REDIS_URL=redis://voltta_redis:6379
RECOVERY_DELAY_MINUTES=45
RECOVERY_MIN_YEAR=2026
MONITOR_ENABLED=true
MONITOR_INTERVAL_SECONDS=60
LI_USE_MOCK=false
LI_API_BASE_URL=https://api.awsli.com.br/api/v1
LI_WEBHOOK_SECRET=troque-por-um-segredo-forte
STORE_ID=principal
STORE_NAME=Minha Loja
LI_API_KEY=COLE_A_CHAVE_DE_API
LI_APPLICATION_KEY=COLE_A_CHAVE_DE_APLICACAO
EVOLUTION_BASE_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=
```
5. **Deploy**.

---

## Verificar (qualquer opção)
Nos **logs** do app você deve ver:
```
Loja configurada via variáveis de ambiente   { storeId: 'principal', evolution: 'PENDENTE' }
🔭 Monitor de polling iniciado (a cada 60s)
🚀 Voltta rodando ...
Monitor inicializado — vigiando a partir de agora   { ate: <numero> }
```
A partir daí, todo pedido novo em **aguardando_pagamento** é detectado, aguarda
`RECOVERY_DELAY_MINUTES` e — se não for pago — entra na fila de envio.

## Ativar o envio de WhatsApp (depois)
Preencha as `EVOLUTION_*` no Environment e dê **Deploy** de novo. O bootstrap atualiza a
loja e o envio passa a funcionar.

## Rodar localmente (full stack)
```bash
cp .env.example .env     # preencha LI_API_KEY e LI_APPLICATION_KEY
docker compose up -d --build
```
> O serviço `app` usa `expose` (sem porta publicada) para não conflitar no EasyPanel.
> Para acessar o `/health` do host localmente, adicione um mapeamento de porta ao app:
> `docker compose run --service-ports app` ou inclua `ports: ["3333:3333"]` temporariamente.

Para desenvolvimento com hot reload, suba só o banco/redis e rode o app no host:
```bash
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

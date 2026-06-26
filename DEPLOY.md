# Deploy do Voltta no EasyPanel

Guia para subir o Voltta a partir do repositório no GitHub, usando o EasyPanel.
A ideia: **criar 3 serviços** (Postgres, Redis e o App) e **colar as variáveis de
ambiente** — o app cria as tabelas e configura a loja sozinho no primeiro boot.

---

## Pré-requisitos
- Repositório no GitHub com este código.
- Um servidor com EasyPanel instalado.
- As chaves: Loja Integrada (API + Aplicação) e, quando for ativar o envio, a Evolution.

---

## Passo 1 — Criar o projeto
No EasyPanel: **Create Project** → nome `voltta`.

## Passo 2 — Banco de dados (Postgres)
Dentro do projeto: **+ Service → Postgres**.
- Nome: `postgres`
- Defina uma senha (anote).
- Create.

O EasyPanel mostra a **connection string interna**. Ela tem o formato:
```
postgres://<user>:<senha>@<projeto>_<service>:5432/<database>
# ex: postgres://postgres:SENHA@voltta_postgres:5432/postgres
```
> Para o Prisma, use o esquema `postgresql://...` (com "ql") e acrescente `?schema=public`.

## Passo 3 — Redis
**+ Service → Redis**.
- Nome: `redis`
- Create.

Connection string interna:
```
redis://<projeto>_<service>:6379
# ex: redis://voltta_redis:6379
```

## Passo 4 — App (Voltta)
**+ Service → App**.
- **Source**: GitHub → selecione o repositório do Voltta (branch `main`).
- **Build**: o EasyPanel detecta o `Dockerfile` automaticamente (deixe em **Dockerfile**).
- **Port**: `3333` (o app expõe nessa porta; o `/health` responde nela).

## Passo 5 — Variáveis de ambiente do App
Na aba **Environment** do serviço App, **cole o bloco abaixo** e preencha os valores.
(Ajuste host/senha do Postgres e Redis conforme os passos 2 e 3.)

```env
NODE_ENV=production
PORT=3333

# Banco e fila (use os hosts internos do EasyPanel — passos 2 e 3)
DATABASE_URL=postgresql://postgres:SUA_SENHA@voltta_postgres:5432/postgres?schema=public
REDIS_URL=redis://voltta_redis:6379

# Lógica de recuperação
RECOVERY_DELAY_MINUTES=45
RECOVERY_MIN_YEAR=2026

# Monitor (polling da Loja Integrada)
MONITOR_ENABLED=true
MONITOR_INTERVAL_SECONDS=60

# Loja Integrada — API real
LI_USE_MOCK=false
LI_API_BASE_URL=https://api.awsli.com.br/api/v1
LI_WEBHOOK_SECRET=troque-por-um-segredo-forte

# Loja padrão (o app cria/atualiza sozinho no boot)
STORE_ID=principal
STORE_NAME=Minha Loja
LI_API_KEY=COLE_A_CHAVE_DE_API
LI_APPLICATION_KEY=COLE_A_CHAVE_DE_APLICACAO

# Evolution API (WhatsApp) — pode deixar vazio agora e preencher quando for ativar o envio
EVOLUTION_BASE_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=
```

## Passo 6 — Deploy
Clique em **Deploy**. No boot, o container:
1. roda `prisma db push` (cria as tabelas);
2. lê as env e **configura a loja `principal`** automaticamente;
3. sobe o servidor + worker + monitor de polling.

Confira nos **logs** algo como:
```
Loja configurada via variáveis de ambiente   { storeId: 'principal', evolution: 'PENDENTE' }
🔭 Monitor de polling iniciado (a cada 60s)
🚀 Voltta rodando ...
Monitor inicializado — vigiando a partir de agora   { ate: <numero> }
```

## Passo 7 — Verificar
- **Health**: se publicar um domínio no serviço, acesse `https://SEU_DOMINIO/health` → `{"status":"ok"}`.
- A partir daqui, todo pedido novo em **aguardando_pagamento** é detectado pelo monitor,
  aguarda `RECOVERY_DELAY_MINUTES` e — se não for pago — entra na fila de envio.

---

## Ativar o envio de WhatsApp (depois)
Quando a Evolution estiver pronta, preencha no **Environment** do App:
```env
EVOLUTION_BASE_URL=https://sua-evolution...
EVOLUTION_API_KEY=sua-apikey
EVOLUTION_INSTANCE=nome-da-instancia
```
e clique em **Deploy** de novo. O bootstrap atualiza a loja e o envio passa a funcionar.

## Observações
- **Domínio/HTTPS**: o monitor por polling **não** precisa de domínio público. Só vale a
  pena publicar um domínio se/quando ativarmos o webhook nativo da LI (futuro).
- **Migrações**: o boot usa `prisma db push` (idempotente). Reimplantar não apaga dados.
- **Multi-loja**: o schema já suporta várias lojas; a config por env atende a loja padrão.
  Para mais lojas, cadastre direto no banco.

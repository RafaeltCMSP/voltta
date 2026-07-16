# Voltta 🛒➡️💬

**Recuperação de vendas não pagas da Loja Integrada via WhatsApp.**

> O cliente *volta* e conclui a compra.

Quando alguém gera um pedido (PIX/boleto) na sua loja da **Loja Integrada** e **não paga**, o Voltta detecta o pedido, captura contato e produto, espera um intervalo e — se o pagamento não vier — aborda o cliente no WhatsApp (via **Evolution API**) para entender o que houve e resgatar a venda. Também gera mensagens **personalizadas por IA** (MiniMax), uma diferente para cada cliente.

---

## Índice

1. [Visão geral e funcionalidades](#1-visão-geral-e-funcionalidades)
2. [Arquitetura](#2-arquitetura)
3. [Modelo de dados](#3-modelo-de-dados)
4. [Fluxos principais](#4-fluxos-principais)
5. [Mensagens: template e IA (MiniMax)](#5-mensagens-template-e-ia-minimax)
6. [Proteção anti-bloqueio do WhatsApp](#6-proteção-anti-bloqueio-do-whatsapp)
7. [Painel web (/dashboard)](#7-painel-web-dashboard)
8. [API HTTP](#8-api-http)
9. [Variáveis de ambiente](#9-variáveis-de-ambiente)
10. [Infraestrutura e deploy](#10-infraestrutura-e-deploy)
11. [Desenvolvimento local](#11-desenvolvimento-local)
12. [Estrutura do código](#12-estrutura-do-código)
13. [Segurança e LGPD](#13-segurança-e-lgpd)
14. [Roadmap / pontos em aberto](#14-roadmap--pontos-em-aberto)

---

## 1. Visão geral e funcionalidades

| Funcionalidade | Status | Onde |
|---|---|---|
| Detecção de pedidos não pagos em tempo real (polling da LI) | ✅ | `modules/monitor` |
| Webhook de pedido (alternativa ao polling) | ✅ (payload a confirmar) | `modules/webhook` |
| Espera configurável + recheck de pagamento antes de enviar | ✅ | `modules/recovery` |
| Envio de WhatsApp via Evolution API | ✅ | `modules/evolution` |
| Import/backfill de pedidos por ano (ex.: todo 2026) | ✅ | `modules/campaign` |
| Campanha manual (selecionar pedidos no painel e disparar) | ✅ | painel + `modules/campaign` |
| Mensagem por template com variáveis | ✅ | `recovery.service.ts` |
| **Mensagem única por cliente gerada por IA (MiniMax)** | ✅ | `modules/ai` |
| **Geração avulsa p/ copiar e colar (sem automação — aquecimento de número)** | ✅ | painel, botão 🤖 por pedido |
| Painel web com stats, filtros e envio | ✅ | `modules/dashboard` |
| Proteção anti-ban (ritmo lento + teto diário) | ✅ | worker + `campaign.ts` |
| Multi-loja (schema pronto; deploy atual é single-loja via env) | ✅/parcial | `prisma/schema.prisma` |
| Mock completo da Loja Integrada (testa tudo sem chaves) | ✅ | `lojaintegrada/client.ts` |

**Stack:** Node.js 20 + TypeScript (ESM) · Fastify 5 (HTTP + painel) · BullMQ + Redis (fila/agendamento) · Prisma 5 + PostgreSQL 16 (dados) · Zod (validação de env) · Pino (logs) · undici (HTTP client) · Docker (deploy).

---

## 2. Arquitetura

Um único processo Node roda **três papéis** (separáveis em containers no futuro):

```
                            ┌──────────────────────────── Voltta (1 processo Node) ───────────────────────────┐
                            │                                                                                  │
 Loja Integrada (API v1)    │  ┌───────────┐   pedidos novos    ┌──────────────────┐                           │
 api.awsli.com.br  ◄────────┼──┤  Monitor   │───────────────────►                  │                           │
      ▲                     │  │ (polling)  │                    │    Recovery      │   delay expira           │
      │ recheck pagou?      │  └───────────┘                    │    (BullMQ)      │──────────────┐            │
      │                     │  ┌───────────┐   evento pedido    │  agenda job com  │              ▼            │
      └─────────────────────┼──┤  Webhook   │───────────────────►  delay de X min  │      ┌──────────────┐     │
                            │  │  (Fastify) │                    └──────────────────┘      │    Worker    │     │
 Operador (browser)         │  └───────────┘                                              │ 1. recheck LI │     │
      │                     │  ┌────────────────────┐  seleciona/enfileira               │ 2. gera msg   │────┼──► Evolution API ──► WhatsApp
      └─────────────────────┼──►  Dashboard + API    │────────────────────────────────────► 3. envia      │     │      do cliente
        /dashboard?token=   │  │  (Fastify)          │                                    │ 4. registra   │     │
                            │  └─────────┬──────────┘                                     └──────────────┘     │
                            │            │ 🤖 gera msg avulsa (copiar/colar)                                    │
                            │            ▼                                                                      │
                            │       MiniMax API (chat completion)                                               │
                            └──────────────────────────────────────────────────────────────────────────────────┘
                                     │                              │
                                PostgreSQL                        Redis
                            (Store/Order/Message)              (fila BullMQ)
```

**Princípios de design:**

- **A LI é a fonte da verdade de pagamento.** Antes de qualquer envio, o worker reconsulta o pedido — se pagou no intervalo, marca `SKIPPED_PAID` e não manda nada.
- **Tudo que envia passa pela fila.** Nunca há envio direto de rota HTTP: rotas apenas enfileiram, o worker (serializado, com rate limit) executa.
- **Falha de IA nunca trava envio.** MiniMax indisponível → fallback automático para o template.
- **Boot autoconfigurável.** `bootstrap.ts` cria/atualiza a loja a partir das env vars a cada boot (idempotente) — deploy é "preencher env e subir".
- **Camada anticorrupção na LI.** `lojaintegrada/types.ts` define o formato normalizado; o resto do app nunca vê o JSON tastypie cru da LI. O mock implementa o mesmo contrato (`LiClient`).

### Integração com a Loja Integrada (confirmada em produção)

- **Base:** `https://api.awsli.com.br/api/v1` · **Auth:** header `Authorization: chave_api <LI_API_KEY> aplicacao <LI_APPLICATION_KEY>`
- **Formato tastypie:** o cliente do pedido vem como *link* (`/api/v1/cliente/123`) → 2ª chamada para resolver nome/telefone/email.
- **Situação → estado:** objeto `situacao` (`aprovado` → pago, `cancelado` → cancelado, senão → aguardando pagamento).
- **Paginação:** máx. **50 por página** (`limit>50` dá erro).
- **Datas sem fuso** (`2026-06-26T10:33:26`) são **horário de Brasília (UTC-3)** — `liDateToISO()` converte para UTC antes de gravar.

---

## 3. Modelo de dados

Três tabelas (`prisma/schema.prisma`), multi-loja desde o início:

```
Store (1) ──< Order (N) ──< RecoveryMessage (N)
```

| Model | Papel | Campos-chave |
|---|---|---|
| **Store** | Um cliente do SaaS: chaves da LI, instância Evolution, template de mensagem, delay de recuperação e `lastSeenOrderNumber` (marcador do monitor). | `liApiKey`, `liApplicationKey`, `evolution*`, `messageTemplate`, `recoveryDelayMinutes`, `lastSeenOrderNumber` |
| **Order** | Pedido capturado da LI + dados de contato p/ remarketing. Único por `(storeId, liOrderId)`. | `status`, `recoveryStatus`, `customerName/Phone/Email`, `productSummary`, `productUrl`, `paymentMethod`, `totalAmount`, `placedAt` |
| **RecoveryMessage** | Log de cada tentativa de envio (corpo, sucesso, erro, quando). | `body`, `success`, `error`, `sentAt` |

**Estados do pedido:**

- `status` (espelho da LI): `AWAITING_PAYMENT` · `PAID` · `CANCELED` · `UNKNOWN`
- `recoveryStatus` (nosso funil): `PENDING` (na fila/espera) → `SENT` (mensagem saiu) · `SKIPPED_PAID` (pagou antes) · `FAILED` (sem telefone ou Evolution recusou)

---

## 4. Fluxos principais

### 4.1 Tempo real (monitor de polling)

1. A cada `MONITOR_INTERVAL_SECONDS` (padrão 60s), o monitor lista pedidos da LI com `numero > lastSeenOrderNumber` de cada loja ativa.
2. **Primeiro ciclo** apenas fixa o marcador (não reprocessa histórico).
3. Pedidos novos em *aguardando pagamento* entram em `handleOrderEvent`: grava o pedido e **agenda** um job BullMQ com delay de `recoveryDelayMinutes` (padrão 45 min). Pedidos anteriores a `RECOVERY_MIN_YEAR` são ignorados.
4. Quando o delay expira, o **worker**: reconsulta a LI (pagou? → `SKIPPED_PAID`; cancelou? → só envia em modo campanha) → checa o teto diário → resolve telefone → monta a mensagem (template ou IA) → envia pela Evolution → registra `RecoveryMessage` e atualiza `recoveryStatus`.

### 4.2 Webhook (alternativa)

`POST /webhooks/lojaintegrada/:storeId` com header `x-webhook-token: <LI_WEBHOOK_SECRET>` e `{ pedido_id | numero | id }` no corpo. Responde `202` imediato e processa async pelo mesmo `handleOrderEvent`. *(payload real da LI ainda a confirmar; o monitor cobre o gap.)*

### 4.3 Import por período (backfill)

Botão **"Analisar período"** no painel (ou `POST /api/import {year}`): varre a LI página a página (desc por data), grava/atualiza todos os pedidos do ano-alvo e **enriquece cada um** com nome/telefone/email/produto (1 chamada extra por pedido, com fallback se falhar). Progresso via `GET /api/import/status`. Não agenda envio — só popula a base para campanha manual.

### 4.4 Campanha manual (win-back)

No painel, filtre (ex.: `AWAITING_PAYMENT` ou `CANCELED`), selecione pedidos e clique **"✉️ Enviar selecionados"** ou **"🤖 Enviar com IA"**. A rota respeita o teto diário (o excedente é recusado com aviso — cabe amanhã), enfileira com `mode: 'campaign'` (envia até para cancelado, é win-back explícito) e o worker executa no ritmo anti-ban. Pedido **pago nunca recebe mensagem**, em nenhum modo.

### 4.5 Geração avulsa por IA — modo aquecimento (sem automação)

Cada linha da tabela de pedidos tem um botão **🤖** que abre um modal:

1. Chama `POST /api/orders/:id/ai-message` → MiniMax gera a **sequência de 3 mensagens** daquele cliente (apresentação Megatumii → pergunta do que houve → link do produto).
2. As mensagens aparecem em **blocos separados e editáveis**, cada um com seu **📋 Copiar** (+ "copiar tudo") — você cola uma por vez no WhatsApp, como conversa real. **💬 Abrir no WhatsApp** abre o wa.me do cliente com a 1ª já preenchida. **O envio é manual, no seu dedo**; nada entra na fila, **não requer Evolution**.
3. **🔄 Gerar outra** produz uma variação na hora.

É o fluxo recomendado enquanto o número de WhatsApp é novo (aquecimento) ou a Evolution não está conectada.

---

## 5. Mensagens: template e IA (MiniMax)

### Template (padrão)

Definido por loja (`Store.messageTemplate`, override via `STORE_MESSAGE_TEMPLATE`). Variáveis: `{{nome}}` (primeiro nome), `{{produto}}`, `{{valor}}` (formatado em BRL), `{{loja}}`.

### IA (MiniMax) — `src/modules/ai/minimax.ts`

- **Ativação:** basta definir `MINIMAX_API_KEY`. Sem ela, os recursos de IA ficam desabilitados no painel (com aviso) e o template continua valendo.
- **Endpoint:** `{MINIMAX_BASE_URL}/text/chatcompletion_v2` (OpenAI-like, Bearer auth). Modelo padrão `MiniMax-M2`. Conta da plataforma chinesa? Troque a base para `https://api.minimaxi.com/v1`.
- **Formato: sempre 3 mensagens** (balões separados de WhatsApp), com estrutura fixa:
  1. saudação com primeiro nome + **apresentação clara da loja** ("aqui é da Megatumii");
  2. menção natural ao pedido/produto + **uma pergunta aberta** para entender por que não pagou;
  3. convite leve para concluir + **link da página do produto** (exato, sem encurtar) — sem link disponível, convida a responder.
- **Link do produto:** capturado da LI no detalhe do pedido (campo do item ou seguindo o resource do produto; link relativo é resolvido contra `STORE_URL`) e salvo em `Order.productUrl`. Fallback: `STORE_URL` (home da loja). Garantia dura no código: se há link e o modelo não o incluiu, ele é anexado à 3ª mensagem.
- **Proibido no prompt:** inventar links/descontos/prazos, pressão, ameaça, "Prezado cliente", numeração "1/3".
- **Contexto por pedido:** nome, produto, valor, dias desde o pedido, **forma de pagamento** (a pergunta fica concreta: "o pix expirou?") e se está cancelado (win-back). `temperature: 1.0` → cada sequência sai diferente.
- **Geração na hora do disparo** (não no clique de campanha): usa dados frescos; a sequência fica registrada em `RecoveryMessage.body`. No envio automático, os 3 balões saem com pausa de 2–5s entre eles (ritmo de digitação humana); se um falhar, interrompe e marca `FAILED`.
- **Saída estruturada:** o modelo responde um array JSON de 3 strings; o parser tolera desvios (code fence, separadores) e, se nada aproveitável vier, retorna `null`.
- **Robustez:** timeout (30s/60s), checagem do `base_resp` (a MiniMax retorna HTTP 200 com erro dentro do JSON), erro → `null` → **fallback para template** (no fluxo automático) ou erro claro no modal (no fluxo manual).

---

## 6. Proteção anti-bloqueio do WhatsApp

Número banido = projeto morto. As proteções são **estruturais**, não opcionais:

| Proteção | Mecanismo | Config |
|---|---|---|
| Ritmo humano | Worker BullMQ com `concurrency: 1` + `limiter: 1 job / intervalo` | `SEND_MIN_INTERVAL_SECONDS` (padrão 90s) |
| Teto diário | Contagem de `RecoveryMessage.success` do dia (UTC) checada **na hora do envio** e **no enfileiramento** | `SEND_DAILY_CAP` (padrão 50) |
| Sem envio órfão | Evolution não configurada → rota de envio bloqueia com erro claro (nada enfileirado) | — |
| Recheck de pagamento | Pagou entre a detecção e o disparo → não envia | — |
| Jobs idempotentes | `jobId` determinístico (`recover-<id>`, `campaign[-ai]-<id>-<dia>`) — reenfileirar não duplica | — |

**Aquecimento de número novo (recomendado):** use só o fluxo manual (botão 🤖 + copiar/colar) nas primeiras semanas; ao ativar a automação, comece com `SEND_DAILY_CAP=10–20` e suba gradualmente; mantenha `SEND_MIN_INTERVAL_SECONDS≥90`.

---

## 7. Painel web (/dashboard)

HTML/JS autocontido servido pelo próprio Fastify (`dashboard.page.ts`) — sem build de front, sem dependência externa.

- **Acesso:** `https://seu-dominio/dashboard?token=SEU_TOKEN` (token = `DASHBOARD_TOKEN`; sem env definida o painel fica aberto — use só em ambiente protegido). Token inválido → tela de login.
- **Cards:** totais por situação e funil de recuperação (na fila / enviadas / pagou antes / falhas). Auto-refresh a cada 15s.
- **Seção 1 — Analisar período:** informe o ano e importe todos os pedidos da LI (barra de progresso).
- **Seção 2 — Pedidos & envio:** tabela com filtros por situação/recuperação — o **nome do produto é link** para a página pública dele e há coluna de **forma de pagamento** —, seleção em massa (pagos ficam bloqueados), botões **✉️ Enviar selecionados**, **🤖 Enviar com IA** e o botão **🤖 por linha** (gerar p/ copiar/colar).
- **Mensagens enviadas:** log das últimas 30 com status e erro.
- Badges de estado: **MOCK/PRODUÇÃO**, Evolution ativa/pendente, IA ativa/desativada.

---

## 8. API HTTP

Todas as rotas `/api/*` exigem o token (`?token=` ou header `x-dashboard-token`), se `DASHBOARD_TOKEN` estiver definido.

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | Healthcheck (`{status:'ok'}`) — usado pelo Docker/EasyPanel |
| GET | `/` → `/dashboard` | Painel web |
| GET | `/api/dashboard` | Stats agregadas + config + últimas mensagens |
| GET | `/api/orders?status=&recovery=&take=` | Lista pedidos com filtros (máx. 500) |
| POST | `/api/import` `{year}` | Inicia import/backfill em background |
| GET | `/api/import/status` | Progresso do import |
| POST | `/api/orders/:id/ai-message` | **Gera a sequência IA (3 mensagens) de um pedido — só texto, não envia** |
| POST | `/api/orders/send` `{orderIds[], ai?}` | Enfileira campanha (template ou IA), respeitando o teto diário |
| POST | `/webhooks/lojaintegrada/:storeId` | Recebe evento de pedido da LI (header `x-webhook-token`) |

---

## 9. Variáveis de ambiente

Validadas com Zod no boot (`src/config/env.ts`) — env inválida derruba o processo com erro claro.

### Obrigatórias em produção

| Var | Descrição |
|---|---|
| `DATABASE_URL` | Postgres (montada automaticamente no compose) |
| `REDIS_URL` | Redis (idem) |
| `LI_API_KEY` / `LI_APPLICATION_KEY` | Chaves da Loja Integrada — com elas o boot configura a loja sozinho |
| `LI_USE_MOCK=false` | Desliga o mock (padrão do compose em produção) |

### Recomendadas

| Var | Padrão | Descrição |
|---|---|---|
| `DASHBOARD_TOKEN` | *(vazio = aberto)* | Token do painel — **defina**, há dados de cliente |
| `LI_WEBHOOK_SECRET` | `troque-este-segredo` | Token do webhook |
| `POSTGRES_PASSWORD` | `voltta` | Senha do Postgres (compose) |
| `STORE_NAME` | `Minha Loja` | Nome usado nas mensagens |

### Comportamento

| Var | Padrão | Descrição |
|---|---|---|
| `RECOVERY_DELAY_MINUTES` | `45` | Espera entre detecção e disparo |
| `RECOVERY_MIN_YEAR` | `2026` | Ignora pedidos anteriores a este ano |
| `MONITOR_ENABLED` / `MONITOR_INTERVAL_SECONDS` | `true` / `60` | Polling da LI |
| `SEND_MIN_INTERVAL_SECONDS` | `90` | Ritmo mínimo entre envios (anti-ban) |
| `SEND_DAILY_CAP` | `50` | Teto de envios/dia (anti-ban) |
| `STORE_MESSAGE_TEMPLATE` | *(template padrão)* | Override do template (`{{nome}} {{produto}} {{valor}} {{loja}}`) |
| `STORE_ID` | `principal` | Id da loja criada no bootstrap |
| `STORE_URL` | *(vazio)* | URL pública da loja — base p/ links relativos de produto e fallback do link nas mensagens de IA |

### Integrações opcionais

| Var | Padrão | Descrição |
|---|---|---|
| `EVOLUTION_BASE_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | *(vazio)* | Evolution API — sem elas o envio automático fica bloqueado (o resto funciona) |
| `MINIMAX_API_KEY` | *(vazio)* | Liga os recursos de IA |
| `MINIMAX_MODEL` | `MiniMax-M2` | Modelo de chat |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/v1` | Base da API (internacional) |

### Servidor

`PORT` (3333) · `NODE_ENV` · `PUBLIC_URL` · `LI_API_BASE_URL` (`https://api.awsli.com.br/api/v1`)

---

## 10. Infraestrutura e deploy

### Topologia (produção — EasyPanel via `docker-compose.yml`)

```
EasyPanel (VPS)
├── postgres  → postgres:16-alpine  · volume voltta_pg     · healthcheck pg_isready
├── redis     → redis:7-alpine      · volume voltta_redis  · healthcheck redis-cli ping
└── app       → build do Dockerfile · expose 3333 (roteado por domínio no EasyPanel)
                healthcheck GET /health · restart unless-stopped
                depends_on: postgres/redis saudáveis
```

### Dockerfile (multi-stage, `node:20-slim`)

Debian slim (não Alpine) de propósito: glibc + OpenSSL 3 nativos evitam os erros de engine do Prisma em musl. **Build:** `npm ci` completo → `prisma generate` → `tsc`. **Runtime:** só deps de produção (mantém o CLI `prisma` p/ o `db push` do boot) + `dist/`.

### Sequência de boot (`docker-entrypoint.sh` → `src/index.ts`)

1. `prisma db push --skip-generate` — aplica o schema (idempotente, não destrói dados);
2. `bootstrapStoreFromEnv()` — cria/atualiza a loja `STORE_ID` com as chaves das env (preserva `lastSeenOrderNumber` e o template salvo);
3. sobe **worker** BullMQ → **monitor** de polling → **Fastify** em `0.0.0.0:3333`.

### Deploy

Passo a passo completo em **[DEPLOY.md](./DEPLOY.md)**. Resumo: EasyPanel → *Service → Compose* apontando pro GitHub (`docker-compose.yml`), cole as env de segredo (LI, `POSTGRES_PASSWORD`, `DASHBOARD_TOKEN`, `MINIMAX_API_KEY`, e `EVOLUTION_*` quando ativar o envio) e **Deploy**. Atualização = novo Deploy (volumes preservados). Logs esperados no boot:

```
Loja configurada via variáveis de ambiente  { storeId: 'principal', evolution: 'PENDENTE' }
🔭 Monitor de polling iniciado (a cada 60s)
🚀 Voltta rodando ...
```

---

## 11. Desenvolvimento local

```bash
npm install
cp .env.example .env                              # ajuste o que precisar
docker compose -f docker-compose.dev.yml up -d    # só Postgres + Redis
npm run db:push                                   # cria tabelas
npm run db:seed                                   # loja-demo (p/ mock)
npm run dev                                       # server + worker + monitor, hot reload
```

Stack completa num comando (mesmo compose da produção): `docker compose up -d --build`.

### Testar sem chaves (mock)

Com `LI_USE_MOCK=true` (padrão em dev) e o servidor rodando:

```bash
npm run simulate       # simula pedido NÃO PAGO chegando pelo webhook
```

O mock responde qualquer pedido como *aguardando pagamento* (cliente fictício com telefone). Rode o dev com `RECOVERY_DELAY_MINUTES=1` para ver o disparo rápido. Para o WhatsApp chegar de verdade, aponte a `loja-demo` (em `prisma/seed.ts`) para a sua Evolution.

### Scripts npm

| Script | Faz |
|---|---|
| `dev` / `build` / `start` | tsx watch · compila p/ `dist/` · roda o compilado |
| `typecheck` | `tsc --noEmit` |
| `db:push` / `db:seed` / `db:generate` / `db:migrate` | Prisma |
| `simulate` | Pedido fake não pago via webhook (mock) |
| `test:li` / `test:li:client` | Probes da API real da LI (exigem chaves) |

---

## 12. Estrutura do código

```
src/
├── index.ts                      # entrypoint: bootstrap → worker → monitor → Fastify
├── server.ts                     # Fastify: /health + rotas de webhook e dashboard
├── bootstrap.ts                  # cria/atualiza a loja a partir das env (a cada boot)
├── config/env.ts                 # todas as env vars, validadas com Zod
├── lib/                          # prisma.ts · queue.ts (BullMQ/Redis) · logger.ts (pino)
└── modules/
    ├── lojaintegrada/            # client real (tastypie/awsli) + mock + tipos normalizados
    ├── evolution/                # envio WhatsApp (sendText) + normalização de telefone (DDI 55)
    ├── ai/minimax.ts             # geração de mensagem personalizada (prompt + client)
    ├── monitor/                  # polling da LI: detecta pedidos novos por numero
    ├── recovery/                 # service (detecta/agenda) + worker (recheck/gera/envia)
    ├── campaign/                 # import por ano (backfill) + enfileiramento de campanha
    ├── webhook/                  # POST /webhooks/lojaintegrada/:storeId
    └── dashboard/                # rotas /api/* + página HTML do painel
prisma/schema.prisma              # Store · Order · RecoveryMessage
scripts/                          # simulate-webhook · probes da LI
Dockerfile · docker-entrypoint.sh # imagem de produção + boot (db push)
docker-compose.yml                # stack completa (produção/EasyPanel)
docker-compose.dev.yml            # só Postgres + Redis (dev local)
DEPLOY.md                         # guia de deploy no EasyPanel
```

---

## 13. Segurança e LGPD

- **Painel e API protegidos por token** (`DASHBOARD_TOKEN`) — obrigatório em produção: há nome, telefone e email de clientes.
- **Webhook validado** por segredo compartilhado (`x-webhook-token`).
- **Segredos só via env vars** — nada de chave commitada; `.env` está no `.gitignore`.
- **LGPD:** as mensagens vão para quem **iniciou uma compra** (relação de consumo — legítimo interesse). Identifique a loja na mensagem, respeite pedido de opt-out e **não** use a base para disparo em massa fora desse contexto. O prompt de IA proíbe pressão, ameaça e promessas falsas.

---

## 14. Roadmap / pontos em aberto

- [ ] Confirmar payload real do webhook nativo da LI (hoje o polling cobre)
- [ ] Opt-out automático ("PARE") + registro de consentimento
- [ ] Sequência de follow-ups (2ª/3ª mensagem com espaçamento)
- [ ] Captura de carrinho 100% abandonado (script no front da loja) — Fase 2
- [ ] Painel multi-loja (schema já suporta) — Fase 2
- [ ] Ler respostas do WhatsApp (webhook da Evolution) p/ medir conversão real
- [ ] Métricas de recuperação (R$ recuperado por período)

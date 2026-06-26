# Voltta 🛒➡️💬

Recuperação de vendas **não pagas** da **Loja Integrada** via **WhatsApp** (Evolution API).

> O cliente *volta* e conclui a compra.

Quando um cliente gera um pedido (PIX/boleto) e **não paga**, o Voltta captura
o contato + o produto em tempo real, espera um intervalo e, se o pagamento não vier,
dispara automaticamente uma mensagem no WhatsApp para resgatar a venda.

## Como funciona

```
Loja Integrada  ──webhook──►  Voltta  ──agenda (BullMQ)──►  espera X min
                                                                       │
                                              pagou? ─ não ──► Evolution API ──► WhatsApp do cliente
```

## Stack

- **Node.js + TypeScript** · Fastify (webhook) · BullMQ + Redis (agendamento) · Prisma + PostgreSQL
- Multi-loja desde o schema (cada loja com suas chaves da LI e instância Evolution)
- **Mock da Loja Integrada** embutido — dá para testar tudo **antes** da Chave de Aplicação chegar

## Pré-requisitos

- Node 20+
- Docker (para Postgres + Redis) — ou um Postgres/Redis próprios
- Uma instância da Evolution API (a sua) para o teste de envio real

## Setup

```bash
npm install
cp .env.example .env                         # ajuste se precisar
docker compose -f docker-compose.dev.yml up -d   # sobe postgres + redis (dev)

npm run db:push               # cria as tabelas
npm run db:seed               # cria a "loja-demo"

npm run dev                   # sobe o servidor + worker + monitor
```

> Para subir **a stack inteira** (app + banco + redis) num comando só:
> `docker compose up -d --build`. É o mesmo `docker-compose.yml` que o EasyPanel usa.

## Testar o fluxo (com mock, sem chaves)

Em outro terminal, com o servidor rodando:

```bash
# para ver o disparo rápido, rode o dev com RECOVERY_DELAY_MINUTES=1
npm run simulate
```

Isso simula um pedido **não pago** chegando pelo webhook. O servidor agenda a
recuperação; quando o tempo passa, o worker reconsulta o status (mock = continua não
pago) e tenta enviar o WhatsApp pela Evolution configurada na `loja-demo`.

> Com `LI_USE_MOCK=true`, os dados do cliente são fictícios. Para o envio real chegar
> no seu celular, aponte a `loja-demo` (no `prisma/seed.ts`) para a sua Evolution API
> e use um número de teste.

## Deploy (produção)

Veja **[DEPLOY.md](./DEPLOY.md)** — passo a passo para subir no EasyPanel a partir do
GitHub (3 serviços: Postgres + Redis + App via `Dockerfile`). No deploy, basta preencher
as variáveis de ambiente: o app cria as tabelas (`prisma db push`) e **configura a loja
sozinho no boot** a partir das chaves em env (`LI_API_KEY`, `LI_APPLICATION_KEY`,
`EVOLUTION_*`) — ver `src/bootstrap.ts`.

## Monitoramento em tempo real

Enquanto não usamos o webhook nativo da LI, o **monitor de polling**
(`src/modules/monitor/`) varre a Loja Integrada a cada `MONITOR_INTERVAL_SECONDS` e
detecta pedidos novos em `aguardando_pagamento`, alimentando o fluxo de recuperação.

## Estrutura

```
src/
├── config/env.ts                 # validação das variáveis de ambiente (zod)
├── lib/                          # prisma, redis/bullmq, logger
├── modules/
│   ├── lojaintegrada/            # client real + mock + tipos normalizados
│   ├── evolution/                # client da Evolution API (envio WhatsApp)
│   ├── recovery/                 # serviço (agenda) + worker (dispara)
│   └── webhook/                  # endpoint que recebe o evento da LI
├── server.ts                     # Fastify
└── index.ts                      # sobe servidor + worker
│   ├── monitor/                  # polling da LI (detecta pedidos novos)
│   └── webhook/                  # endpoint que recebe o evento da LI
├── bootstrap.ts                  # configura a loja padrão a partir das env vars
├── server.ts                     # Fastify
└── index.ts                      # sobe servidor + worker + monitor
prisma/schema.prisma              # Store, Order, RecoveryMessage
scripts/simulate-webhook.ts       # simula pedido não pago
scripts/test-li*.ts               # probes/testes da API real da LI
Dockerfile · DEPLOY.md            # build de produção + guia de deploy (EasyPanel)
```

## ⚠️ Pontos em aberto (próximos passos)

- [ ] **Chave de Aplicação** da Loja Integrada (5–10 dias úteis) — caminho crítico
- [ ] Confirmar payload real do webhook e mapeamento de campos do pedido
- [ ] Cobertura de carrinho 100% abandonado (script no front da loja) — Fase 2
- [ ] Painel/dashboard multi-loja — Fase 2
- [ ] Opt-out / conformidade LGPD nas mensagens
- [ ] Sequência de follow-ups (2ª e 3ª mensagem)
```

## Conformidade (LGPD)

As mensagens são para clientes que **iniciaram uma compra** (relação de consumo).
Inclua sempre identificação da loja e opção de descadastro. Não use a base para
disparos em massa fora desse contexto.

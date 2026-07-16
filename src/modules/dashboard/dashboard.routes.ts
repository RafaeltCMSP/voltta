import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OrderStatus, RecoveryStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { dashboardHtml } from './dashboard.page.js';
import { startImport, getImportState, enqueueCampaign } from '../campaign/campaign.js';
import { aiConfigured, generateRecoveryMessage } from '../ai/minimax.js';

/** Confere o token, se DASHBOARD_TOKEN estiver configurado. */
function checkToken(req: FastifyRequest): boolean {
  if (!env.DASHBOARD_TOKEN) return true; // sem token configurado = aberto
  const q = req.query as { token?: string };
  const header = req.headers['x-dashboard-token'];
  return q.token === env.DASHBOARD_TOKEN || header === env.DASHBOARD_TOKEN;
}

export async function dashboardRoutes(app: FastifyInstance) {
  // Página HTML do painel.
  app.get('/dashboard', async (_req, reply: FastifyReply) => {
    reply.type('text/html').send(dashboardHtml());
  });

  // Raiz redireciona para o painel (conveniência).
  app.get('/', async (_req, reply) => reply.redirect('/dashboard'));

  // API com os dados agregados + listas recentes.
  app.get('/api/dashboard', async (req, reply) => {
    if (!checkToken(req)) {
      return reply.status(401).send({ error: 'token inválido ou ausente' });
    }

    const [store, byStatus, byRecovery, recentOrders, recentMessages, totalOrders] =
      await Promise.all([
        prisma.store.findFirst({ orderBy: { createdAt: 'asc' } }),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.order.groupBy({ by: ['recoveryStatus'], _count: { _all: true } }),
        prisma.order.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        prisma.recoveryMessage.findMany({
          orderBy: { sentAt: 'desc' },
          take: 30,
          include: { order: { select: { liOrderId: true, customerName: true } } },
        }),
        prisma.order.count(),
      ]);

    const countBy = (rows: { _count: { _all: number } }[], key: string, value: string) =>
      (rows as Array<Record<string, unknown> & { _count: { _all: number } }>).find(
        (r) => r[key] === value,
      )?._count._all ?? 0;

    return {
      generatedAt: new Date().toISOString(),
      store: store
        ? {
            id: store.id,
            name: store.name,
            lastSeenOrderNumber: store.lastSeenOrderNumber,
            evolutionConfigured: Boolean(
              store.evolutionBaseUrl && store.evolutionApiKey && store.evolutionInstance,
            ),
            recoveryDelayMinutes: store.recoveryDelayMinutes,
          }
        : null,
      config: {
        mock: env.LI_USE_MOCK,
        monitorEnabled: env.MONITOR_ENABLED,
        minYear: env.RECOVERY_MIN_YEAR,
        sendMinIntervalSeconds: env.SEND_MIN_INTERVAL_SECONDS,
        sendDailyCap: env.SEND_DAILY_CAP,
        aiConfigured: aiConfigured(),
      },
      stats: {
        totalOrders,
        status: {
          awaitingPayment: countBy(byStatus, 'status', 'AWAITING_PAYMENT'),
          paid: countBy(byStatus, 'status', 'PAID'),
          canceled: countBy(byStatus, 'status', 'CANCELED'),
          unknown: countBy(byStatus, 'status', 'UNKNOWN'),
        },
        recovery: {
          pending: countBy(byRecovery, 'recoveryStatus', 'PENDING'),
          sent: countBy(byRecovery, 'recoveryStatus', 'SENT'),
          skippedPaid: countBy(byRecovery, 'recoveryStatus', 'SKIPPED_PAID'),
          failed: countBy(byRecovery, 'recoveryStatus', 'FAILED'),
        },
      },
      recentOrders: recentOrders.map((o) => ({
        liOrderId: o.liOrderId,
        status: o.status,
        recoveryStatus: o.recoveryStatus,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        productSummary: o.productSummary,
        totalAmount: o.totalAmount ? Number(o.totalAmount) : null,
        createdAt: o.createdAt.toISOString(),
      })),
      recentMessages: recentMessages.map((m) => ({
        liOrderId: m.order.liOrderId,
        customerName: m.order.customerName,
        success: m.success,
        error: m.error,
        sentAt: m.sentAt.toISOString(),
        body: m.body,
      })),
    };
  });

  // Lista de pedidos com filtros (para a tabela + seleção de envio).
  app.get('/api/orders', async (req, reply) => {
    if (!checkToken(req)) return reply.status(401).send({ error: 'token inválido' });
    const q = req.query as { status?: string; recovery?: string; take?: string };

    const where: Prisma.OrderWhereInput = {};
    const statuses: OrderStatus[] = ['AWAITING_PAYMENT', 'PAID', 'CANCELED', 'UNKNOWN'];
    const recoveries: RecoveryStatus[] = ['PENDING', 'SENT', 'SKIPPED_PAID', 'FAILED'];
    if (q.status && (statuses as string[]).includes(q.status)) where.status = q.status as OrderStatus;
    if (q.recovery && (recoveries as string[]).includes(q.recovery))
      where.recoveryStatus = q.recovery as RecoveryStatus;

    const take = Math.min(Number(q.take) || 200, 500);
    const orders = await prisma.order.findMany({ where, orderBy: { placedAt: 'desc' }, take });

    return {
      total: orders.length,
      orders: orders.map((o) => ({
        id: o.id,
        liOrderId: o.liOrderId,
        status: o.status,
        recoveryStatus: o.recoveryStatus,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        customerEmail: o.customerEmail,
        productSummary: o.productSummary,
        totalAmount: o.totalAmount ? Number(o.totalAmount) : null,
        placedAt: o.placedAt ? o.placedAt.toISOString() : null,
      })),
    };
  });

  // Inicia o import por período (background).
  app.post('/api/import', async (req, reply) => {
    if (!checkToken(req)) return reply.status(401).send({ error: 'token inválido' });
    const body = (req.body ?? {}) as { year?: number };
    const year = Number(body.year) || env.RECOVERY_MIN_YEAR;
    const state = startImport(year);
    return { ok: true, state };
  });

  // Progresso do import.
  app.get('/api/import/status', async (req, reply) => {
    if (!checkToken(req)) return reply.status(401).send({ error: 'token inválido' });
    return { state: getImportState() };
  });

  // Gera a mensagem com IA para UM pedido — só devolve o texto (copiar/colar manual).
  // Não envia nada e não depende da Evolution: uso enquanto o número aquece.
  app.post('/api/orders/:id/ai-message', async (req, reply) => {
    if (!checkToken(req)) return reply.status(401).send({ error: 'token inválido' });
    if (!aiConfigured())
      return reply.status(400).send({ error: 'IA não configurada — defina MINIMAX_API_KEY.' });

    const { id } = req.params as { id: string };
    const order = await prisma.order.findUnique({ where: { id }, include: { store: true } });
    if (!order) return reply.status(404).send({ error: 'pedido não encontrado' });

    const message = await generateRecoveryMessage({
      nome: order.customerName ?? undefined,
      produto: order.productSummary ?? undefined,
      valor: order.totalAmount ? Number(order.totalAmount) : undefined,
      loja: order.store.name,
      diasDesdePedido: order.placedAt
        ? Math.max(0, Math.floor((Date.now() - order.placedAt.getTime()) / 86_400_000))
        : undefined,
      cancelado: order.status === 'CANCELED',
    });
    if (!message)
      return reply.status(502).send({ error: 'A MiniMax falhou ao gerar — tente de novo.' });

    return { ok: true, message, phone: order.customerPhone, customerName: order.customerName };
  });

  // Enfileira envio (com proteção anti-bloqueio). Bloqueia se a Evolution não estiver pronta.
  app.post('/api/orders/send', async (req, reply) => {
    if (!checkToken(req)) return reply.status(401).send({ error: 'token inválido' });
    const body = (req.body ?? {}) as { orderIds?: string[]; ai?: boolean };
    const ids = Array.isArray(body.orderIds) ? body.orderIds.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return reply.status(400).send({ error: 'nenhum pedido selecionado' });

    const useAi = body.ai === true;
    if (useAi && !aiConfigured()) {
      return reply.status(400).send({
        error: 'IA não configurada — defina MINIMAX_API_KEY para usar o envio com IA.',
      });
    }

    const result = await enqueueCampaign(ids, useAi);
    if (!result.evolutionConfigured) {
      return reply.status(400).send({
        error: 'Evolution não configurada — configure EVOLUTION_* antes de enviar.',
        ...result,
        queued: 0,
      });
    }
    return { ok: true, ...result };
  });
}

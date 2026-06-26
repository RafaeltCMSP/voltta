import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { dashboardHtml } from './dashboard.page.js';

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
      config: { mock: env.LI_USE_MOCK, monitorEnabled: env.MONITOR_ENABLED, minYear: env.RECOVERY_MIN_YEAR },
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
}

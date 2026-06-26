import { prisma } from '../../lib/prisma.js';
import { recoveryQueue } from '../../lib/queue.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { makeLiClient } from '../lojaintegrada/client.js';
import type { LiPaymentState } from '../lojaintegrada/types.js';

function mapStatus(state: LiPaymentState) {
  switch (state) {
    case 'paid':
      return 'PAID' as const;
    case 'canceled':
      return 'CANCELED' as const;
    case 'awaiting_payment':
      return 'AWAITING_PAYMENT' as const;
    default:
      return 'UNKNOWN' as const;
  }
}

/**
 * Processa um evento de pedido recebido pelo webhook da Loja Integrada.
 * Se o pedido estiver aguardando pagamento, registra e agenda o disparo
 * de recuperação para daqui a X minutos.
 */
export async function handleOrderEvent(storeId: string, liOrderId: string): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store || !store.active) {
    logger.warn({ storeId }, 'Evento para loja inexistente ou inativa — ignorando');
    return;
  }

  const li = makeLiClient({
    liApiKey: store.liApiKey,
    liApplicationKey: store.liApplicationKey,
  });

  const order = await li.getOrder(liOrderId);
  if (!order) {
    logger.warn({ storeId, liOrderId }, 'Pedido não encontrado na LI');
    return;
  }

  // Foco atual: só recuperar pedidos a partir de RECOVERY_MIN_YEAR (2026).
  if (order.placedAt) {
    const year = new Date(order.placedAt).getFullYear();
    if (Number.isFinite(year) && year < env.RECOVERY_MIN_YEAR) {
      logger.info({ liOrderId, year }, `Pedido anterior a ${env.RECOVERY_MIN_YEAR} — ignorado`);
      return;
    }
  }

  const status = mapStatus(order.paymentState);

  const saved = await prisma.order.upsert({
    where: { storeId_liOrderId: { storeId, liOrderId } },
    update: {
      status,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      customerEmail: order.customer.email,
      productSummary: order.productSummary,
      totalAmount: order.totalAmount,
      placedAt: order.placedAt ? new Date(order.placedAt) : undefined,
    },
    create: {
      storeId,
      liOrderId,
      status,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      customerEmail: order.customer.email,
      productSummary: order.productSummary,
      totalAmount: order.totalAmount,
      placedAt: order.placedAt ? new Date(order.placedAt) : undefined,
    },
  });

  // Se já está pago, marca como skip e não agenda nada.
  if (status === 'PAID') {
    await prisma.order.update({
      where: { id: saved.id },
      data: { recoveryStatus: 'SKIPPED_PAID' },
    });
    logger.info({ liOrderId }, 'Pedido já pago — sem recuperação');
    return;
  }

  // Só agenda recuperação para pedidos aguardando pagamento que ainda não foram tratados.
  if (status === 'AWAITING_PAYMENT' && saved.recoveryStatus === 'PENDING') {
    const delayMs = store.recoveryDelayMinutes * 60_000;
    await recoveryQueue.add(
      'recover',
      { orderId: saved.id },
      {
        delay: delayMs,
        jobId: `recover:${saved.id}`, // idempotente: não agenda duas vezes o mesmo pedido
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    logger.info(
      { liOrderId, delayMin: store.recoveryDelayMinutes },
      'Recuperação agendada para pedido não pago',
    );
  }
}

/** Aplica o template substituindo as variáveis. */
export function renderTemplate(
  template: string,
  vars: { nome?: string; produto?: string; valor?: number; loja: string },
): string {
  const valor =
    vars.valor != null ? vars.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
  return template
    .replaceAll('{{nome}}', vars.nome?.split(' ')[0] ?? 'tudo bem?')
    .replaceAll('{{produto}}', vars.produto ?? 'seu produto')
    .replaceAll('{{valor}}', valor)
    .replaceAll('{{loja}}', vars.loja);
}

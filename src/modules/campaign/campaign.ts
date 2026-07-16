import type { OrderStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { recoveryQueue } from '../../lib/queue.js';
import { makeLiClient } from '../lojaintegrada/client.js';
import type { LiPaymentState } from '../lojaintegrada/types.js';

function toOrderStatus(s: LiPaymentState): OrderStatus {
  switch (s) {
    case 'paid':
      return 'PAID';
    case 'canceled':
      return 'CANCELED';
    case 'awaiting_payment':
      return 'AWAITING_PAYMENT';
    default:
      return 'UNKNOWN';
  }
}

// ───────── Import por período (backfill) ─────────

export interface ImportState {
  running: boolean;
  year: number;
  scanned: number; // pedidos lidos da LI
  imported: number; // pedidos do ano gravados/atualizados
  done: boolean;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

let importState: ImportState | null = null;
export function getImportState(): ImportState | null {
  return importState;
}

/** Dispara o import em background e devolve o estado inicial. */
export function startImport(year: number): ImportState {
  if (importState?.running) return importState;
  importState = {
    running: true,
    year,
    scanned: 0,
    imported: 0,
    done: false,
    startedAt: new Date().toISOString(),
  };
  void runImport(year).catch((err) => {
    logger.error({ err, year }, 'Falha no import por período');
    if (importState) {
      importState.error = err instanceof Error ? err.message : String(err);
      importState.running = false;
      importState.done = true;
      importState.finishedAt = new Date().toISOString();
    }
  });
  return importState;
}

async function runImport(year: number): Promise<void> {
  const store = await prisma.store.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!store) throw new Error('Nenhuma loja configurada');
  const li = makeLiClient({ liApiKey: store.liApiKey, liApplicationKey: store.liApplicationKey });

  const LIMIT = 50; // a LI aceita no máximo 50 por página
  const MAX_PAGES = 800; // trava de segurança (até 40k pedidos)
  let maxNumero = store.lastSeenOrderNumber;

  for (let page = 0; page < MAX_PAGES; page++) {
    const orders = await li.listOrders({ offset: page * LIMIT, limit: LIMIT });
    if (!orders.length) break;

    let reachedOlder = false;
    for (const o of orders) {
      if (importState) importState.scanned++;
      const y = o.placedAt ? new Date(o.placedAt).getFullYear() : year;
      if (y > year) continue; // mais novo que o alvo (não deve ocorrer no ano corrente)
      if (y < year) {
        reachedOlder = true; // ordenado por data desc → daqui pra trás é tudo mais antigo
        continue;
      }

      // Enriquece com nome/telefone/email/produto (1 chamada extra por pedido).
      // Se falhar, cai no básico (status/valor/data) para não perder o pedido.
      let full = null;
      try {
        full = await li.getOrder(o.numero);
      } catch (err) {
        logger.warn({ err, numero: o.numero }, 'Falha ao enriquecer pedido no import');
      }

      const data = {
        status: toOrderStatus(full?.paymentState ?? o.paymentState),
        totalAmount: full?.totalAmount ?? o.totalAmount ?? undefined,
        placedAt: (full?.placedAt ?? o.placedAt) ? new Date(full?.placedAt ?? o.placedAt!) : undefined,
        customerName: full?.customer.name ?? undefined,
        customerPhone: full?.customer.phone ?? undefined,
        customerEmail: full?.customer.email ?? undefined,
        productSummary: full?.productSummary ?? undefined,
      };

      await prisma.order.upsert({
        where: { storeId_liOrderId: { storeId: store.id, liOrderId: o.numero } },
        update: data,
        create: { storeId: store.id, liOrderId: o.numero, ...data },
      });
      if (importState) importState.imported++;
      const n = Number(o.numero);
      if (Number.isFinite(n) && n > maxNumero) maxNumero = n;
    }
    if (reachedOlder) break;
  }

  // Avança o marcador do monitor para não reprocessar o que já importamos.
  if (maxNumero > store.lastSeenOrderNumber) {
    await prisma.store.update({ where: { id: store.id }, data: { lastSeenOrderNumber: maxNumero } });
  }

  if (importState) {
    importState.running = false;
    importState.done = true;
    importState.finishedAt = new Date().toISOString();
  }
  logger.info({ year, imported: importState?.imported }, 'Import por período concluído');
}

// ───────── Envio de campanha (com proteção anti-bloqueio) ─────────

export interface EnqueueResult {
  queued: number; // realmente enfileirados hoje
  deferred: number; // ficaram de fora pelo teto diário
  remainingToday: number; // quanto ainda cabe hoje após este envio
  sentToday: number;
  evolutionConfigured: boolean;
}

/**
 * Enfileira o envio para os pedidos selecionados, respeitando o teto diário.
 * O ritmo (1 a cada SEND_MIN_INTERVAL_SECONDS) é garantido pelo limiter do worker.
 */
export async function enqueueCampaign(orderIds: string[], ai = false): Promise<EnqueueResult> {
  const store = await prisma.store.findFirst({ orderBy: { createdAt: 'asc' } });
  const evolutionConfigured = Boolean(
    store?.evolutionBaseUrl && store?.evolutionApiKey && store?.evolutionInstance,
  );

  // Sem Evolution não enfileira nada (evita gerar falhas e mexer no número à toa).
  if (!evolutionConfigured) {
    return { queued: 0, deferred: orderIds.length, remainingToday: 0, sentToday: 0, evolutionConfigured };
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const sent = await prisma.recoveryMessage.count({
    where: { success: true, sentAt: { gte: startOfDay } },
  });
  const remaining = Math.max(0, env.SEND_DAILY_CAP - sent);
  const toQueue = orderIds.slice(0, remaining);

  let i = 0;
  for (const orderId of toQueue) {
    await recoveryQueue.add(
      'recover',
      { orderId, mode: 'campaign', ai },
      {
        jobId: `campaign${ai ? '-ai' : ''}-${orderId}-${startOfDay.getTime()}`,
        delay: i * 1000, // pequeno escalonamento; o ritmo real é do limiter
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    i++;
  }

  return {
    queued: toQueue.length,
    deferred: orderIds.length - toQueue.length,
    remainingToday: Math.max(0, remaining - toQueue.length),
    sentToday: sent,
    evolutionConfigured,
  };
}

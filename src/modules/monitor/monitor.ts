import type { Store } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { makeLiClient } from '../lojaintegrada/client.js';
import { handleOrderEvent } from '../recovery/recovery.service.js';

/**
 * Monitor de polling — substitui (por enquanto) o webhook nativo da LI.
 *
 * A cada MONITOR_INTERVAL_SECONDS, consulta os pedidos mais recentes de cada
 * loja ativa, identifica os NOVOS (numero > lastSeenOrderNumber) que ainda estão
 * aguardando pagamento e os entrega ao fluxo de recuperação (handleOrderEvent).
 *
 * O estado `aguardando_pagamento` é transitório, então o intervalo precisa ser
 * curto o bastante para não perder pedidos antes de eles expirarem.
 */

let timer: NodeJS.Timeout | null = null;

export function startMonitor() {
  if (!env.MONITOR_ENABLED) {
    logger.info('Monitor de polling DESLIGADO (MONITOR_ENABLED=false)');
    return () => {};
  }
  if (env.LI_USE_MOCK) {
    logger.warn('Monitor ligado mas LI_USE_MOCK=true — não há pedidos reais para varrer.');
  }

  const intervalMs = env.MONITOR_INTERVAL_SECONDS * 1000;
  const tick = () =>
    pollAllStores().catch((err) => logger.error({ err }, 'Falha no ciclo do monitor'));

  tick(); // roda já no boot
  timer = setInterval(tick, intervalMs);
  logger.info(`🔭 Monitor de polling iniciado (a cada ${env.MONITOR_INTERVAL_SECONDS}s)`);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

async function pollAllStores() {
  const stores = await prisma.store.findMany({ where: { active: true } });
  for (const store of stores) {
    try {
      await pollStore(store);
    } catch (err) {
      logger.error({ err, storeId: store.id }, 'Erro ao varrer a loja');
    }
  }
}

async function pollStore(store: Store) {
  const li = makeLiClient({ liApiKey: store.liApiKey, liApplicationKey: store.liApplicationKey });
  const since = store.lastSeenOrderNumber ?? 0;
  const { orders, maxNumber } = await li.listOrdersSince(since, { maxPages: 5 });

  // Primeiro ciclo (since=0): só fixa o marcador, sem reprocessar o histórico.
  // A partir daqui, recuperamos apenas pedidos criados depois que o monitor subiu.
  if (since === 0) {
    if (maxNumber > 0) {
      await prisma.store.update({ where: { id: store.id }, data: { lastSeenOrderNumber: maxNumber } });
    }
    logger.info({ storeId: store.id, ate: maxNumber }, 'Monitor inicializado — vigiando a partir de agora');
    return;
  }

  const candidatos = orders.filter((o) => o.awaiting);
  for (const o of candidatos) {
    try {
      await handleOrderEvent(store.id, o.numero);
    } catch (err) {
      logger.error({ err, storeId: store.id, numero: o.numero }, 'Erro ao processar pedido do monitor');
    }
  }

  if (maxNumber > since) {
    await prisma.store.update({ where: { id: store.id }, data: { lastSeenOrderNumber: maxNumber } });
  }
  if (orders.length) {
    logger.info(
      { storeId: store.id, novos: orders.length, aguardando: candidatos.length, ate: maxNumber },
      'Ciclo do monitor',
    );
  }
}

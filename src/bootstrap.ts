import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';

/**
 * Cria/atualiza a loja padrão a partir das variáveis de ambiente.
 *
 * É isto que torna o deploy "coloca as env e sobe": em vez de rodar o seed,
 * o app lê as chaves do ambiente (LI_API_KEY, LI_APPLICATION_KEY, EVOLUTION_*)
 * e configura a loja `STORE_ID` sozinho. Idempotente — roda a cada boot.
 *
 * Não mexe em `lastSeenOrderNumber` nem em `messageTemplate` (a não ser que
 * STORE_MESSAGE_TEMPLATE seja informado), preservando o que já está no banco.
 */
export async function bootstrapStoreFromEnv(): Promise<void> {
  if (!env.LI_API_KEY || !env.LI_APPLICATION_KEY) {
    logger.warn(
      'LI_API_KEY/LI_APPLICATION_KEY ausentes — bootstrap da loja pulado. ' +
        'Configure as chaves por env var ou cadastre a loja manualmente no banco.',
    );
    return;
  }

  const data = {
    name: env.STORE_NAME,
    liApiKey: env.LI_API_KEY,
    liApplicationKey: env.LI_APPLICATION_KEY,
    evolutionBaseUrl: env.EVOLUTION_BASE_URL ?? '',
    evolutionApiKey: env.EVOLUTION_API_KEY ?? '',
    evolutionInstance: env.EVOLUTION_INSTANCE ?? '',
    recoveryDelayMinutes: env.RECOVERY_DELAY_MINUTES,
    ...(env.STORE_MESSAGE_TEMPLATE ? { messageTemplate: env.STORE_MESSAGE_TEMPLATE } : {}),
  };

  const store = await prisma.store.upsert({
    where: { id: env.STORE_ID },
    update: data,
    create: { id: env.STORE_ID, ...data },
  });

  const evoOk = data.evolutionBaseUrl && data.evolutionApiKey && data.evolutionInstance;
  logger.info(
    { storeId: store.id, evolution: evoOk ? 'configurada' : 'PENDENTE' },
    'Loja configurada via variáveis de ambiente',
  );
}

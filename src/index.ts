import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { buildServer } from './server.js';
import { bootstrapStoreFromEnv } from './bootstrap.js';
import { startRecoveryWorker } from './modules/recovery/recovery.worker.js';
import { startMonitor } from './modules/monitor/monitor.js';

async function main() {
  // Configura a loja padrão a partir das variáveis de ambiente (deploy single-loja).
  await bootstrapStoreFromEnv();

  // O worker (que dispara o WhatsApp) roda no mesmo processo do servidor no MVP.
  // Em produção dá para separar em outro container facilmente.
  startRecoveryWorker();

  // Monitor de polling: detecta pedidos novos na LI (enquanto não há webhook nativo).
  startMonitor();

  const app = buildServer();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  logger.info(`🚀 Voltta rodando em ${env.PUBLIC_URL}`);
  logger.info(`   Loja Integrada mock: ${env.LI_USE_MOCK ? 'LIGADO' : 'desligado'}`);
}

main().catch((err) => {
  logger.error({ err }, 'Falha ao subir o Voltta');
  process.exit(1);
});

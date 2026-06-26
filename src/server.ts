import Fastify from 'fastify';
import { logger } from './lib/logger.js';
import { webhookRoutes } from './modules/webhook/webhook.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';

export function buildServer() {
  const app = Fastify({ loggerInstance: logger });

  app.get('/health', async () => ({ status: 'ok', service: 'voltta' }));

  app.register(webhookRoutes);
  app.register(dashboardRoutes);

  return app;
}

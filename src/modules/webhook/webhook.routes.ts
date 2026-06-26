import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { handleOrderEvent } from '../recovery/recovery.service.js';

// A Loja Integrada manda o evento; aqui só nos interessa identificar o pedido.
// O formato exato do payload deve ser confirmado na configuração do webhook na LI.
const payloadSchema = z.object({
  // aceitamos vários nomes possíveis para o id do pedido
  pedido_id: z.union([z.string(), z.number()]).optional(),
  numero: z.union([z.string(), z.number()]).optional(),
  id: z.union([z.string(), z.number()]).optional(),
});

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/lojaintegrada/:storeId', async (req, reply) => {
    const { storeId } = req.params as { storeId: string };

    // Validação simples de origem: token compartilhado no header.
    const token = req.headers['x-webhook-token'];
    if (token !== env.LI_WEBHOOK_SECRET) {
      logger.warn({ storeId }, 'Webhook com token inválido');
      return reply.status(401).send({ error: 'token inválido' });
    }

    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'payload inválido' });
    }

    const liOrderId = String(parsed.data.pedido_id ?? parsed.data.numero ?? parsed.data.id ?? '');
    if (!liOrderId) {
      return reply.status(400).send({ error: 'id do pedido ausente' });
    }

    // Responde rápido (200) e processa de forma assíncrona — webhooks não devem esperar.
    reply.status(202).send({ received: true });

    handleOrderEvent(storeId, liOrderId).catch((err) =>
      logger.error({ err, storeId, liOrderId }, 'Erro ao processar evento de pedido'),
    );
  });
}

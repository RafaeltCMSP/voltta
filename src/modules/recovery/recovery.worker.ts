import { Worker } from 'bullmq';
import { connection, RECOVERY_QUEUE, type RecoveryJobData } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { makeLiClient } from '../lojaintegrada/client.js';
import { sendWhatsAppText } from '../evolution/client.js';
import { renderTemplate } from './recovery.service.js';

/**
 * Worker que roda QUANDO o delay expira:
 *  1. Reconsulta o pedido na LI — o cliente pode ter pagado nesse meio tempo.
 *  2. Se ainda não pagou, dispara o WhatsApp via Evolution API.
 *  3. Registra a mensagem.
 */
export function startRecoveryWorker() {
  const worker = new Worker<RecoveryJobData, void, string>(
    RECOVERY_QUEUE,
    async (job) => {
      const { orderId } = job.data;
      const order = await prisma.order.findUnique({ where: { id: orderId }, include: { store: true } });
      if (!order) {
        logger.warn({ orderId }, 'Pedido sumiu antes do disparo');
        return;
      }
      const { store } = order;

      // 1. Recheca o status de pagamento — fonte da verdade é a LI.
      const li = makeLiClient({
        liApiKey: store.liApiKey,
        liApplicationKey: store.liApplicationKey,
      });
      const fresh = await li.getOrder(order.liOrderId);

      if (fresh?.paymentState === 'paid') {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'PAID', recoveryStatus: 'SKIPPED_PAID' },
        });
        logger.info({ liOrderId: order.liOrderId }, 'Cliente pagou no intervalo — não dispara');
        return;
      }

      if (fresh?.paymentState === 'canceled') {
        await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELED' } });
        logger.info({ liOrderId: order.liOrderId }, 'Pedido cancelado — não dispara');
        return;
      }

      const phone = fresh?.customer.phone ?? order.customerPhone;
      if (!phone) {
        await prisma.order.update({ where: { id: order.id }, data: { recoveryStatus: 'FAILED' } });
        logger.warn({ liOrderId: order.liOrderId }, 'Sem telefone — impossível recuperar');
        return;
      }

      // 2. Monta e envia a mensagem.
      const body = renderTemplate(store.messageTemplate, {
        nome: fresh?.customer.name ?? order.customerName ?? undefined,
        produto: fresh?.productSummary ?? order.productSummary ?? undefined,
        valor: fresh?.totalAmount ?? (order.totalAmount ? Number(order.totalAmount) : undefined),
        loja: store.name,
      });

      const result = await sendWhatsAppText(
        {
          baseUrl: store.evolutionBaseUrl,
          apiKey: store.evolutionApiKey,
          instance: store.evolutionInstance,
        },
        phone,
        body,
      );

      // 3. Registra.
      await prisma.recoveryMessage.create({
        data: { orderId: order.id, body, success: result.success, error: result.error },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { recoveryStatus: result.success ? 'SENT' : 'FAILED' },
      });
    },
    { connection, concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job de recuperação falhou');
  });

  logger.info('Worker de recuperação iniciado');
  return worker;
}

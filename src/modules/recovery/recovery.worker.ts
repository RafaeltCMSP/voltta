import { Worker } from 'bullmq';
import { connection, RECOVERY_QUEUE, type RecoveryJobData } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { makeLiClient } from '../lojaintegrada/client.js';
import { sendWhatsAppText } from '../evolution/client.js';
import { renderTemplate } from './recovery.service.js';
import { generateRecoveryMessages } from '../ai/minimax.js';

/** Quantas mensagens já saíram com sucesso hoje (UTC) — teto anti-bloqueio. */
async function sentToday(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return prisma.recoveryMessage.count({ where: { success: true, sentAt: { gte: start } } });
}

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

      // Cancelado: no fluxo normal não dispara; em campanha (win-back) o operador
      // escolheu explicitamente, então segue.
      if (fresh?.paymentState === 'canceled') {
        await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELED' } });
        if (job.data.mode !== 'campaign') {
          logger.info({ liOrderId: order.liOrderId }, 'Pedido cancelado — não dispara');
          return;
        }
      }

      // Teto diário (anti-bloqueio): nunca ultrapassa SEND_DAILY_CAP envios/dia.
      if ((await sentToday()) >= env.SEND_DAILY_CAP) {
        logger.warn(
          { liOrderId: order.liOrderId, cap: env.SEND_DAILY_CAP },
          'Teto diário de envios atingido — pulando (proteção anti-bloqueio)',
        );
        return;
      }

      // Persiste contato resolvido (útil quando veio do import sem telefone).
      if (fresh?.customer) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            customerName: fresh.customer.name ?? order.customerName,
            customerPhone: fresh.customer.phone ?? order.customerPhone,
            customerEmail: fresh.customer.email ?? order.customerEmail,
            productUrl: fresh.productUrl ?? order.productUrl,
          },
        });
      }

      const phone = fresh?.customer.phone ?? order.customerPhone;
      if (!phone) {
        await prisma.order.update({ where: { id: order.id }, data: { recoveryStatus: 'FAILED' } });
        logger.warn({ liOrderId: order.liOrderId }, 'Sem telefone — impossível recuperar');
        return;
      }

      // 2. Monta e envia a mensagem.
      const vars = {
        nome: fresh?.customer.name ?? order.customerName ?? undefined,
        produto: fresh?.productSummary ?? order.productSummary ?? undefined,
        valor: fresh?.totalAmount ?? (order.totalAmount ? Number(order.totalAmount) : undefined),
        loja: store.name,
      };

      // Modo IA: gera a sequência (3 balões) única por cliente na hora do disparo.
      // Se a IA falhar por qualquer motivo, cai no template — o envio nunca trava.
      let messages: string[] | null = null;
      if (job.data.ai) {
        const placedAt = fresh?.placedAt ?? order.placedAt?.toISOString();
        messages = await generateRecoveryMessages({
          ...vars,
          diasDesdePedido: placedAt
            ? Math.max(0, Math.floor((Date.now() - new Date(placedAt).getTime()) / 86_400_000))
            : undefined,
          cancelado: (fresh?.paymentState ?? undefined) === 'canceled',
          link: fresh?.productUrl ?? order.productUrl ?? env.STORE_URL,
        });
        if (!messages) {
          logger.warn({ liOrderId: order.liOrderId }, 'IA falhou — usando template como fallback');
        }
      }
      if (!messages) messages = [renderTemplate(store.messageTemplate, vars)];

      // Envia os balões em sequência, com pausa curta entre eles (parece digitação
      // humana). Se um falhar, interrompe — não deixa a conversa pela metade.
      const evo = {
        baseUrl: store.evolutionBaseUrl,
        apiKey: store.evolutionApiKey,
        instance: store.evolutionInstance,
      };
      let sent = 0;
      let error: string | undefined;
      for (const msg of messages) {
        if (sent > 0) {
          await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 3000)));
        }
        const result = await sendWhatsAppText(evo, phone, msg);
        if (!result.success) {
          error = result.error;
          break;
        }
        sent++;
      }
      const success = sent === messages.length;

      // 3. Registra.
      await prisma.recoveryMessage.create({
        data: {
          orderId: order.id,
          body: messages.join('\n\n'),
          success,
          error: error ? `${error} (enviadas ${sent}/${messages.length})` : undefined,
        },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { recoveryStatus: success ? 'SENT' : 'FAILED' },
      });
    },
    {
      connection,
      concurrency: 1, // serializa os envios
      // Anti-bloqueio: no máx. 1 envio por SEND_MIN_INTERVAL_SECONDS (ritmo humano).
      limiter: { max: 1, duration: env.SEND_MIN_INTERVAL_SECONDS * 1000 },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job de recuperação falhou');
  });

  logger.info('Worker de recuperação iniciado');
  return worker;
}

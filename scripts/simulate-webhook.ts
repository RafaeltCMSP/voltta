/**
 * Simula um pedido NÃO PAGO chegando pelo webhook da Loja Integrada,
 * para testar o fluxo end-to-end sem precisar das chaves reais.
 *
 * Uso:
 *   npm run simulate                       -> dispara um pedido novo não pago
 *   npm run simulate -- --paid PEDIDO_ID   -> marca um pedido como pago (no mock)
 *
 * Dica: rode o servidor com RECOVERY_DELAY_MINUTES baixo (ex: 1) para ver o
 * disparo acontecer rápido.
 */
import { env } from '../src/config/env.js';

const STORE_ID = process.env.STORE_ID ?? 'loja-demo';
const base = `http://localhost:${env.PORT}`;

async function fireOrder(orderId: string) {
  const res = await fetch(`${base}/webhooks/lojaintegrada/${STORE_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-token': env.LI_WEBHOOK_SECRET },
    body: JSON.stringify({ pedido_id: orderId }),
  });
  console.log(`Webhook enviado para pedido ${orderId} -> HTTP ${res.status}`);
  console.log('Veja os logs do servidor: a recuperação foi agendada.');
  console.log(`Disparo em ~${env.RECOVERY_DELAY_MINUTES} min (se o pedido continuar não pago).`);
}

async function main() {
  const orderId = `PED-${Date.now()}`;
  await fireOrder(orderId);
}

main().catch((e) => {
  console.error('Erro:', e);
  process.exit(1);
});

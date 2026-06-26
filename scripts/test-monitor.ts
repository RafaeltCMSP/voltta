/**
 * Testa listOrdersSince() do client real — o coração do monitor de polling.
 *   $env:LI_API_KEY="..."; $env:LI_APP_KEY="..."; npx tsx scripts/test-monitor.ts [sinceNumber]
 */
process.env.LI_USE_MOCK = 'false';
process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
export {};

const API_KEY = process.env.LI_API_KEY;
const APP_KEY = process.env.LI_APP_KEY;
if (!API_KEY || !APP_KEY) { console.error('Defina LI_API_KEY e LI_APP_KEY.'); process.exit(1); }

const { makeLiClient } = await import('../src/modules/lojaintegrada/client.js');

const since = Number(process.argv[2] ?? 12285);
const li = makeLiClient({ liApiKey: API_KEY!, liApplicationKey: APP_KEY! });

const { orders, maxNumber } = await li.listOrdersSince(since, { maxPages: 2 });
console.log(`Desde o pedido #${since} → ${orders.length} novos | maior numero: ${maxNumber}`);
for (const o of orders) {
  const tag = o.awaiting ? '🟡 AGUARDANDO (recuperar)' : '⚪ outro';
  console.log(`  #${o.numero}  ${tag}  ${o.placedAt}`);
}
console.log(`\nO monitor processaria ${orders.filter((o) => o.awaiting).length} pedido(s) e avançaria o marcador p/ ${maxNumber}.`);

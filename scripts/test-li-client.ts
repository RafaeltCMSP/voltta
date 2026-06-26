/**
 * Testa o RealLiClient de PRODUÇÃO contra a API real da Loja Integrada.
 * Exercita o mesmo caminho que o webhook/worker usam: getOrder -> normalize.
 *
 *   $env:LI_API_KEY="..."; $env:LI_APP_KEY="..."; npx tsx scripts/test-li-client.ts <numero1> <numero2...>
 */
process.env.LI_USE_MOCK = 'false';
// env.ts exige DATABASE_URL, mas o client não conecta no banco — basta um valor.
process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';

const API_KEY = process.env.LI_API_KEY;
const APP_KEY = process.env.LI_APP_KEY;
if (!API_KEY || !APP_KEY) {
  console.error('Defina LI_API_KEY e LI_APP_KEY.');
  process.exit(1);
}

export {}; // garante que o arquivo é um módulo (permite top-level await)
const { makeLiClient } = await import('../src/modules/lojaintegrada/client.js');

async function main() {
  const numeros = process.argv.slice(2);
  if (!numeros.length) numeros.push('12291'); // pago (recente)

  const li = makeLiClient({ liApiKey: API_KEY!, liApplicationKey: APP_KEY! });

  for (const numero of numeros) {
    console.log(`\n━━━ getOrder("${numero}") ━━━`);
    const order = await li.getOrder(numero);
    if (!order) {
      console.log('  → null (não encontrado)');
      continue;
    }
    console.log(JSON.stringify(order, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

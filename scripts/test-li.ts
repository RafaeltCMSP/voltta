/**
 * Probe da API da Loja Integrada (v1 / awsli).
 *
 * Objetivo: confirmar que conseguimos EXTRAIR pedidos e contatos (clientes)
 * com as credenciais reais — matéria-prima da automação do Voltta.
 *
 * Não depende do resto do app (não precisa de banco/redis). Só das 2 chaves.
 *
 * Como rodar (PowerShell):
 *   $env:LI_API_KEY="sua_chave_api"; $env:LI_APP_KEY="sua_chave_aplicacao"; npm run test:li
 * ou passando como argumentos:
 *   npx tsx scripts/test-li.ts <chave_api> <chave_aplicacao>
 */
import { request } from 'undici';

const API_KEY = process.env.LI_API_KEY ?? process.argv[2];
const APP_KEY = process.env.LI_APP_KEY ?? process.argv[3];

// Base e header de auth oficiais da API v1 da Loja Integrada (awsli).
const BASE = process.env.LI_API_BASE_URL ?? 'https://api.awsli.com.br/api/v1';
const AUTH = `chave_api ${API_KEY} aplicacao ${APP_KEY}`;

if (!API_KEY || !APP_KEY) {
  console.error(
    '❌ Faltam as chaves.\n' +
      '   PowerShell: $env:LI_API_KEY="..."; $env:LI_APP_KEY="..."; npm run test:li\n' +
      '   ou:         npx tsx scripts/test-li.ts <chave_api> <chave_aplicacao>',
  );
  process.exit(1);
}

async function get(path: string) {
  const url = `${BASE}${path}`;
  const res = await request(url, {
    method: 'GET',
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  const text = await res.body.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta não-JSON */
  }
  return { url, status: res.statusCode, json, text };
}

function preview(obj: unknown, max = 800): string {
  const s = JSON.stringify(obj, null, 2) ?? String(obj);
  return s.length > max ? s.slice(0, max) + '\n  …(truncado)' : s;
}

async function probe(label: string, path: string) {
  console.log(`\n━━━ ${label} ━━━`);
  console.log(`GET ${BASE}${path}`);
  try {
    const r = await get(path);
    console.log(`status: ${r.status}`);
    if (r.status === 401 || r.status === 403) {
      console.log('🔒 Autenticação recusada. Conferir as chaves / formato do header.');
      console.log('resposta:', r.text.slice(0, 300));
      return null;
    }
    if (r.status >= 400) {
      console.log('⚠️  Erro:', r.text.slice(0, 300));
      return null;
    }
    const data = r.json as Record<string, unknown> | null;
    const objects = (data?.['objects'] as unknown[]) ?? (Array.isArray(data) ? data : []);
    const meta = data?.['meta'] as Record<string, unknown> | undefined;
    console.log(`✅ ok — itens nesta página: ${objects.length}` + (meta ? ` | total_count: ${meta['total_count']}` : ''));
    if (objects.length) {
      console.log('exemplo (1º item):');
      console.log(preview(objects[0]));
    } else {
      console.log('corpo:', preview(data ?? r.text));
    }
    return objects;
  } catch (err) {
    console.log('💥 falha de rede:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function main() {
  console.log('Voltta · Probe Loja Integrada');
  console.log(`base: ${BASE}`);
  console.log(`auth: chave_api ${API_KEY!.slice(0, 4)}…${API_KEY!.slice(-2)} aplicacao ${APP_KEY!.slice(0, 4)}…`);

  // 1) Pedidos — o coração da automação (queremos os não pagos).
  const pedidos = await probe('PEDIDOS (listagem)', '/pedido/search?limit=5&formato=json');

  // 2) Clientes/contatos — nome + telefone + email pro WhatsApp.
  await probe('CLIENTES (listagem)', '/cliente/search?limit=5&formato=json');

  // 3) Situações de pedido (pra mapear "aguardando pagamento" x "pago").
  await probe('SITUAÇÕES DE PEDIDO', '/situacao_pedido/search?limit=20&formato=json');

  // Resumo focado no que a automação precisa: contato + status do pedido.
  if (pedidos?.length) {
    console.log('\n━━━ RESUMO PARA A AUTOMAÇÃO ━━━');
    for (const p of pedidos as Record<string, unknown>[]) {
      const cliente = (p['cliente'] as Record<string, unknown>) ?? {};
      console.log({
        numero: p['numero'] ?? p['id'],
        situacao: p['situacao'],
        cliente: cliente['nome'] ?? cliente['resource_uri'] ?? cliente,
        telefone: cliente['telefone_celular'] ?? cliente['telefone'],
        email: cliente['email'],
        valor: p['valor_total'] ?? p['valor_subtotal'],
      });
    }
  }

  console.log('\nFim do probe. Se algo veio como resource_uri em vez do dado, a LI usa links;');
  console.log('aí buscamos o detalhe seguindo a URL (faço isso no próximo passo).');
}

main();

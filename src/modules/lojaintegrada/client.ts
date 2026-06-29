import { request } from 'undici';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { LiClient, LiOrder, LiOrderRef, LiOrderSummary, LiPaymentState } from './types.js';

interface StoreCredentials {
  liApiKey: string;
  liApplicationKey: string;
}

/**
 * A LI envia datas SEM fuso (ex: "2026-06-26T10:33:26.009033"), que na verdade
 * estão em horário de Brasília (UTC-3). Convertemos para ISO/UTC correto aqui,
 * para que o banco guarde o instante certo e a exibição não fique 3h defasada.
 */
function liDateToISO(s?: string): string | undefined {
  if (!s) return undefined;
  let str = s.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'); // fração -> 3 casas
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(str);
  if (!hasTz) str += '-03:00'; // horário de Brasília
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Deriva o estado de pagamento a partir do objeto `situacao` da LI. */
function paymentStateFromSituacao(sit: Record<string, unknown> | undefined): LiPaymentState {
  if (!sit) return 'unknown';
  if (sit['cancelado']) return 'canceled';
  if (sit['aprovado']) return 'paid';
  if (sit['codigo']) return 'awaiting_payment'; // não aprovado e não cancelado
  return 'unknown';
}

/**
 * Cliente real da API v1 (awsli) da Loja Integrada — confirmado em 2026-06-26.
 *
 * Base:  https://api.awsli.com.br/api/v1   (env LI_API_BASE_URL)
 * Auth:  Authorization: chave_api <liApiKey> aplicacao <liApplicationKey>
 * Forma: tastypie — respostas com resource_uri; o cliente vem como LINK dentro
 *        do pedido, então fazemos uma 2ª chamada para pegar o telefone.
 */
class RealLiClient implements LiClient {
  constructor(private readonly creds: StoreCredentials) {}

  /** Origem (https://api.awsli.com.br) para montar URLs a partir de resource_uri. */
  private get origin(): string {
    return new URL(env.LI_API_BASE_URL).origin;
  }

  private authHeader(): string {
    return `chave_api ${this.creds.liApiKey} aplicacao ${this.creds.liApplicationKey}`;
  }

  /** GET autenticado. `path` pode ser absoluto (resource_uri) ou relativo à base. */
  private async get(pathOrUri: string): Promise<Record<string, unknown> | null> {
    const sep = pathOrUri.includes('?') ? '&' : '?';
    const url = pathOrUri.startsWith('/')
      ? `${this.origin}${pathOrUri}${sep}formato=json`
      : `${env.LI_API_BASE_URL}/${pathOrUri}${sep}formato=json`;

    const res = await request(url, {
      method: 'GET',
      headers: { Authorization: this.authHeader(), Accept: 'application/json' },
    });
    if (res.statusCode === 404) return null;
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      logger.error({ url, status: res.statusCode, body }, 'Erro na API da Loja Integrada');
      throw new Error(`LI respondeu ${res.statusCode}: ${body.slice(0, 200)}`);
    }
    return (await res.body.json()) as Record<string, unknown>;
  }

  async getOrder(liOrderId: string): Promise<LiOrder | null> {
    try {
      const raw = await this.get(`pedido/${encodeURIComponent(liOrderId)}`);
      if (!raw) return null;
      return await this.normalize(liOrderId, raw);
    } catch (err) {
      logger.error({ err, liOrderId }, 'Falha na requisição à Loja Integrada');
      throw err;
    }
  }

  async listOrdersSince(
    sinceNumber: number,
    opts: { maxPages?: number } = {},
  ): Promise<{ orders: LiOrderRef[]; maxNumber: number }> {
    const maxPages = opts.maxPages ?? 5;
    const PAGE = 50;
    const orders: LiOrderRef[] = [];
    let maxNumber = sinceNumber;

    for (let page = 0; page < maxPages; page++) {
      const data = await this.get(`pedido/search?limit=${PAGE}&offset=${page * PAGE}&order_by=-data_criacao`);
      const objs = (data?.['objects'] as Record<string, unknown>[]) ?? [];
      if (!objs.length) break;

      let reachedOld = false;
      for (const p of objs) {
        const numero = Number(p['numero']);
        if (numero > maxNumber) maxNumber = numero;
        if (numero <= sinceNumber) {
          reachedOld = true; // ordenado por data desc → daqui pra frente é tudo antigo
          continue;
        }
        const awaiting = paymentStateFromSituacao(p['situacao'] as Record<string, unknown>) === 'awaiting_payment';
        orders.push({ numero: String(p['numero']), awaiting, placedAt: liDateToISO(p['data_criacao'] as string) });
      }
      if (reachedOld) break;
    }

    return { orders, maxNumber };
  }

  async listOrders({ offset, limit }: { offset: number; limit: number }): Promise<LiOrderSummary[]> {
    const lim = Math.min(Math.max(1, limit), 50); // a LI aceita no máximo 50
    const data = await this.get(`pedido/search?limit=${lim}&offset=${offset}&order_by=-data_criacao`);
    const objs = (data?.['objects'] as Record<string, unknown>[]) ?? [];
    return objs.map((p) => ({
      numero: String(p['numero']),
      paymentState: paymentStateFromSituacao(p['situacao'] as Record<string, unknown>),
      totalAmount: p['valor_total'] ? Number(p['valor_total']) : undefined,
      placedAt: liDateToISO(p['data_criacao'] as string),
    }));
  }

  /** Traduz o JSON cru da LI para o nosso formato normalizado. */
  private async normalize(liOrderId: string, raw: Record<string, unknown>): Promise<LiOrder> {
    // Situação vem como objeto: { codigo, aprovado, cancelado, final, ... }
    const paymentState = paymentStateFromSituacao(raw['situacao'] as Record<string, unknown>);

    // Cliente vem como link (ex: "/api/v1/cliente/123") — seguimos para pegar o telefone.
    let customer: LiOrder['customer'] = {};
    const clienteRef = raw['cliente'];
    if (typeof clienteRef === 'string') {
      try {
        const c = await this.get(clienteRef);
        if (c) {
          customer = {
            name: (c['nome'] as string)?.trim() || undefined,
            phone:
              (c['telefone_celular'] as string)?.trim() ||
              (c['telefone_principal'] as string)?.trim() ||
              undefined,
            email: (c['email'] as string)?.trim() || undefined,
          };
        }
      } catch (err) {
        logger.warn({ err, liOrderId }, 'Não foi possível resolver o cliente do pedido');
      }
    } else if (clienteRef && typeof clienteRef === 'object') {
      const c = clienteRef as Record<string, unknown>;
      customer = {
        name: (c['nome'] as string)?.trim() || undefined,
        phone: (c['telefone_celular'] as string) || (c['telefone_principal'] as string) || undefined,
        email: (c['email'] as string) || undefined,
      };
    }

    // Itens vêm embutidos no detalhe do pedido — montamos um resumo p/ a mensagem.
    const itens = Array.isArray(raw['itens']) ? (raw['itens'] as Record<string, unknown>[]) : [];
    const productSummary = itens.length
      ? itens
          .map((i) => `${i['nome']} x${Math.round(Number(i['quantidade']) || 1)}`)
          .join(', ')
      : undefined;

    return {
      liOrderId,
      paymentState,
      customer,
      productSummary,
      totalAmount: raw['valor_total'] ? Number(raw['valor_total']) : undefined,
      placedAt: liDateToISO(raw['data_criacao'] as string),
    };
  }
}

/**
 * Cliente mock — devolve o pedido como "aguardando pagamento" e permite
 * simular o pagamento marcando o id como pago via markPaid().
 * Usado enquanto a Chave de Aplicação não chega.
 */
class MockLiClient implements LiClient {
  private static paid = new Set<string>();

  static markPaid(liOrderId: string) {
    MockLiClient.paid.add(liOrderId);
  }

  async getOrder(liOrderId: string): Promise<LiOrder | null> {
    const paymentState: LiPaymentState = MockLiClient.paid.has(liOrderId)
      ? 'paid'
      : 'awaiting_payment';
    logger.debug({ liOrderId, paymentState }, '[MOCK] getOrder');
    return {
      liOrderId,
      paymentState,
      customer: { name: 'Cliente Teste', phone: '5511999999999', email: 'teste@exemplo.com' },
      productSummary: 'Produto Demo x1',
      totalAmount: 199.9,
      placedAt: new Date().toISOString(),
    };
  }

  // No mock não há listagem real — o fluxo de teste usa o webhook (npm run simulate).
  async listOrdersSince(): Promise<{ orders: LiOrderRef[]; maxNumber: number }> {
    return { orders: [], maxNumber: 0 };
  }

  async listOrders(): Promise<LiOrderSummary[]> {
    return [];
  }
}

export function makeLiClient(creds: StoreCredentials): LiClient {
  return env.LI_USE_MOCK ? new MockLiClient() : new RealLiClient(creds);
}

// Exposto para o script de simulação marcar um pedido como pago.
export const mockMarkPaid = MockLiClient.markPaid;

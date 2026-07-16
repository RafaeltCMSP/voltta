import { request } from 'undici';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface AiMessageContext {
  nome?: string;
  produto?: string;
  valor?: number;
  loja: string;
  diasDesdePedido?: number;
  cancelado?: boolean;
  /** Forma de pagamento escolhida (ex: "Pix") — deixa a pergunta mais certeira. */
  formaPagamento?: string;
  /** URL pública da página do produto (vai OBRIGATORIAMENTE na última mensagem, se existir). */
  link?: string;
}

export function aiConfigured(): boolean {
  return Boolean(env.MINIMAX_API_KEY);
}

const SYSTEM_PROMPT = `Você escreve sequências de mensagens de WhatsApp em nome de uma loja online brasileira, enviadas pelo dono da loja para clientes que fizeram um pedido mas NÃO concluíram o pagamento.

OBJETIVO: entender o que aconteceu e por que a pessoa não pagou — NÃO é pressionar. É uma conversa genuína pra descobrir se houve algum problema (pix expirou, boleto venceu, dúvida no produto, achou caro, desistiu) — e deixar o caminho aberto pra concluir a compra se ela quiser.

FORMATO DA RESPOSTA (obrigatório):
Responda SOMENTE com um array JSON de EXATAMENTE 3 strings — ["mensagem 1","mensagem 2","mensagem 3"] — sem markdown, sem crase, sem texto fora do JSON.

ESTRUTURA FIXA das 3 mensagens:
1. Saudação com o primeiro nome + apresentação DEIXANDO CLARO o nome da loja (ex.: "aqui é da <loja>"). Curta: 1 a 2 frases.
2. Menção natural ao pedido/produto + UMA pergunta aberta pra entender o que houve com o pagamento. Se a forma de pagamento for informada no contexto, use-a pra deixar a pergunta concreta (ex.: pix expirou? o boleto venceu? deu problema no cartão?). 1 a 2 frases.
3. Convite leve, sem pressão, pra concluir a compra se fizer sentido — e inclua o LINK DO PRODUTO exatamente como fornecido no contexto (não altere, não encurte). Se NENHUM link for fornecido, convide a pessoa a responder a mensagem, sem inventar link.

REGRAS:
- Português do Brasil, tom humano, caloroso e informal — como o dono da loja falando de verdade, não robô de cobrança.
- Cada mensagem é um balão de WhatsApp separado: curtas, sem numeração, sem "1/3".
- No máximo 1 emoji no total das 3 mensagens (e nem sempre).
- NUNCA invente links, descontos, prazos ou ameaças. O único link permitido é o fornecido no contexto.
- Não use "Prezado cliente" nem assinatura de atendente.
- Varie vocabulário e estrutura a cada geração: deve parecer escrita à mão.`;

function buildUserPrompt(ctx: AiMessageContext): string {
  const partes: string[] = [`Loja: ${ctx.loja}`];
  if (ctx.nome) partes.push(`Cliente: ${ctx.nome} (use só o primeiro nome)`);
  if (ctx.produto) partes.push(`Produto do pedido: ${ctx.produto}`);
  if (ctx.valor != null)
    partes.push(
      `Valor: ${ctx.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    );
  if (ctx.diasDesdePedido != null) partes.push(`Dias desde o pedido: ${ctx.diasDesdePedido}`);
  if (ctx.formaPagamento) partes.push(`Forma de pagamento escolhida: ${ctx.formaPagamento}`);
  if (ctx.cancelado) partes.push('Observação: o pedido consta como cancelado (abordagem de win-back).');
  partes.push(ctx.link ? `Link do produto (use na mensagem 3): ${ctx.link}` : 'Sem link disponível.');
  partes.push('Gere o array JSON com as 3 mensagens agora.');
  return partes.join('\n');
}

/** Extrai o array de mensagens da resposta do modelo, tolerando desvios de formato. */
function parseMessages(content: string): string[] | null {
  let text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  // Tenta JSON estrito primeiro.
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(arr)) {
        const msgs = arr.filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
        if (msgs.length >= 2) return msgs.slice(0, 3).map((m) => m.trim());
      }
    }
  } catch {
    // cai no fallback abaixo
  }
  // Fallback: divide por linha em branco / separador.
  const parts = text
    .split(/\n\s*(?:---+\s*)?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 3) : null;
}

/**
 * Gera a sequência de recuperação (3 mensagens) via MiniMax.
 * Retorna null em qualquer falha — o chamador decide o fallback (template).
 */
export async function generateRecoveryMessages(ctx: AiMessageContext): Promise<string[] | null> {
  if (!env.MINIMAX_API_KEY) return null;

  const url = `${env.MINIMAX_BASE_URL.replace(/\/$/, '')}/text/chatcompletion_v2`;
  try {
    const res = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.MINIMAX_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(ctx) },
        ],
        temperature: 1.0, // variedade — cada sequência sai diferente
        max_tokens: 500,
      }),
      headersTimeout: 30_000,
      bodyTimeout: 60_000,
    });

    const raw = await res.body.text();
    if (res.statusCode >= 400) {
      logger.error({ status: res.statusCode, body: raw }, 'MiniMax recusou a geração');
      return null;
    }

    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
      base_resp?: { status_code?: number; status_msg?: string };
    };
    // A MiniMax devolve HTTP 200 com erro dentro de base_resp — precisa checar.
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      logger.error({ baseResp: data.base_resp }, 'MiniMax retornou erro no base_resp');
      return null;
    }

    const content = data.choices?.[0]?.message?.content ?? '';
    const messages = parseMessages(content);
    if (!messages) {
      logger.error({ content }, 'MiniMax retornou formato inesperado');
      return null;
    }
    // Garantia dura: se há link, ele PRECISA estar na sequência (senão anexa à última).
    if (ctx.link && !messages.some((m) => m.includes(ctx.link!))) {
      messages[messages.length - 1] += `\n${ctx.link}`;
    }
    return messages.map((m) => (m.length > 700 ? m.slice(0, 700) : m));
  } catch (err) {
    logger.error({ err }, 'Falha ao chamar a MiniMax');
    return null;
  }
}

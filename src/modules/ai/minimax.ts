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
}

export function aiConfigured(): boolean {
  return Boolean(env.MINIMAX_API_KEY);
}

const SYSTEM_PROMPT = `Você escreve mensagens de WhatsApp em nome de uma loja online brasileira, enviadas pelo dono da loja para clientes que fizeram um pedido mas NÃO concluíram o pagamento.

OBJETIVO da mensagem: entender o que aconteceu e por que a pessoa não pagou — NÃO é vender nem pressionar. É uma conversa genuína pra descobrir se houve algum problema (boleto venceu, pix falhou, dúvida no produto, desistiu, achou caro, etc.) e se dar pra ajudar.

REGRAS:
- Português do Brasil, tom humano, caloroso e informal — como o dono da loja falando de verdade, não um robô de cobrança.
- CURTA: 2 a 4 frases no máximo. É WhatsApp.
- Cumprimente pelo primeiro nome (se houver) e mencione o pedido/produto de forma natural.
- Termine com UMA pergunta aberta convidando a pessoa a contar o que houve.
- NUNCA inclua links, valores de desconto inventados, prazos ou ameaças.
- Sem emojis em excesso (no máximo 1, e nem sempre).
- Não use saudação genérica tipo "Prezado cliente". Não assine com nome de atendente.
- Varie a estrutura: cada mensagem deve parecer escrita à mão, diferente das outras.

Responda SOMENTE com o texto final da mensagem, sem aspas, sem explicações.`;

function buildUserPrompt(ctx: AiMessageContext): string {
  const partes: string[] = [`Loja: ${ctx.loja}`];
  if (ctx.nome) partes.push(`Cliente: ${ctx.nome} (use só o primeiro nome)`);
  if (ctx.produto) partes.push(`Produto do pedido: ${ctx.produto}`);
  if (ctx.valor != null)
    partes.push(
      `Valor: ${ctx.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    );
  if (ctx.diasDesdePedido != null) partes.push(`Dias desde o pedido: ${ctx.diasDesdePedido}`);
  if (ctx.cancelado) partes.push('Observação: o pedido consta como cancelado (abordagem de win-back).');
  partes.push('Escreva a mensagem agora.');
  return partes.join('\n');
}

/**
 * Gera a mensagem de recuperação personalizada via MiniMax (chat completion).
 * Retorna null em qualquer falha — o chamador decide o fallback (template).
 */
export async function generateRecoveryMessage(ctx: AiMessageContext): Promise<string | null> {
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
        temperature: 1.0, // variedade — cada mensagem sai diferente
        max_tokens: 300,
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

    let text = data.choices?.[0]?.message?.content?.trim() ?? '';
    text = text.replace(/^["'"']+|["'"']+$/g, '').trim();
    if (!text) {
      logger.error({ raw }, 'MiniMax retornou resposta vazia');
      return null;
    }
    if (text.length > 700) text = text.slice(0, 700);
    return text;
  } catch (err) {
    logger.error({ err }, 'Falha ao chamar a MiniMax');
    return null;
  }
}

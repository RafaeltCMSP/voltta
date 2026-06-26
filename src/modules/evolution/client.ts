import { request } from 'undici';
import { logger } from '../../lib/logger.js';

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
}

export interface SendTextResult {
  success: boolean;
  error?: string;
}

/** Normaliza o telefone para o formato que a Evolution espera (DDI+DDD+número, só dígitos). */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // Se vier sem DDI (ex: 11 dígitos), assume Brasil (55).
  if (digits.length <= 11) digits = `55${digits}`;
  return digits;
}

/**
 * Envia uma mensagem de texto via Evolution API.
 * Endpoint padrão da Evolution v2: POST /message/sendText/{instance}
 * Header de auth: apikey
 */
export async function sendWhatsAppText(
  config: EvolutionConfig,
  phone: string,
  text: string,
): Promise<SendTextResult> {
  const number = normalizePhone(phone);
  const url = `${config.baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(config.instance)}`;

  try {
    const res = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
      body: JSON.stringify({ number, text }),
    });

    const body = await res.body.text();
    if (res.statusCode >= 400) {
      logger.error({ status: res.statusCode, body, number }, 'Evolution recusou o envio');
      return { success: false, error: `Evolution ${res.statusCode}: ${body}` };
    }

    logger.info({ number, instance: config.instance }, 'WhatsApp enviado');
    return { success: true };
  } catch (err) {
    logger.error({ err, number }, 'Falha ao chamar a Evolution API');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

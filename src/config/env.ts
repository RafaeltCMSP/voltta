import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3333),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_URL: z.string().url().default('http://localhost:3333'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  RECOVERY_DELAY_MINUTES: z.coerce.number().default(45),
  // Só recuperar pedidos a partir deste ano (foco atual: 2026).
  RECOVERY_MIN_YEAR: z.coerce.number().default(2026),

  // Monitor de polling: detecta pedidos novos consultando a LI periodicamente.
  MONITOR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  MONITOR_INTERVAL_SECONDS: z.coerce.number().default(60),

  // Painel web (/dashboard). Se definido, exige ?token=... para acessar (recomendado:
  // há dados de cliente). Vazio = painel aberto (use só em ambiente protegido).
  DASHBOARD_TOKEN: z.string().optional(),

  LI_USE_MOCK: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LI_API_BASE_URL: z.string().default('https://api.awsli.com.br/api/v1'),
  LI_WEBHOOK_SECRET: z.string().default('troque-este-segredo'),

  // ───────── Loja padrão (configuração por env — usada no deploy) ─────────
  // Se LI_API_KEY e LI_APPLICATION_KEY estiverem setadas, o app cria/atualiza
  // esta loja sozinho no boot (bootstrapStoreFromEnv). Ideal p/ deploy single-loja.
  STORE_ID: z.string().default('principal'),
  STORE_NAME: z.string().default('Minha Loja'),
  STORE_MESSAGE_TEMPLATE: z.string().optional(),
  LI_API_KEY: z.string().optional(), // "Chave de API" da loja
  LI_APPLICATION_KEY: z.string().optional(), // "Chave de Aplicação" do integrador
  EVOLUTION_BASE_URL: z.string().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_INSTANCE: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

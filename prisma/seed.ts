// Cria uma loja de exemplo para testar o fluxo end-to-end com o mock.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.upsert({
    where: { id: 'loja-demo' },
    update: {},
    create: {
      id: 'loja-demo',
      name: 'Loja Demo',
      liApiKey: 'CHAVE_API_DEMO',
      liApplicationKey: 'CHAVE_APP_DEMO',
      // Ajuste para a sua Evolution API real quando for testar o disparo de verdade:
      evolutionBaseUrl: 'http://localhost:8080',
      evolutionApiKey: 'EVOLUTION_API_KEY_DEMO',
      evolutionInstance: 'principal',
      recoveryDelayMinutes: 45,
    },
  });

  console.log(`Loja semeada: ${store.name} (id=${store.id})`);
  console.log(`Webhook desta loja: POST /webhooks/lojaintegrada/${store.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

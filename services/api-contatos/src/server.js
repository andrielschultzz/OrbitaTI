// Ponto de entrada do contêiner: monta a API e escuta na porta 3000.
// Configuração só pelo ambiente: DATABASE_URL_API, JWT_SEGREDO, PORTA (padrão 3000), LOG_NIVEL.
import { buildApp } from './app.js';

const app = buildApp();

// SIGTERM: o Docker e o Kubernetes mandam isto ao parar o contêiner. app.close() para de aceitar
// conexões, espera as requisições em andamento e fecha o pool (onClose), sem cortar transação no meio.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.once(sinal, async () => {
    app.log.info(`${sinal} recebido: encerrando`);
    await app.close();
    process.exit(0);
  });
}

try {
  // 0.0.0.0: dentro do contêiner, escutar só em 127.0.0.1 deixaria a API inalcançável de fora dele.
  // Quem restringe o acesso é a publicação da porta no compose (127.0.0.1:3000).
  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORTA ?? 3000) });
} catch (erro) {
  app.log.error({ err: erro }, 'falha ao iniciar');
  process.exit(1);
}

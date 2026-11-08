// Sobe o simulador na porta 3001 (SIM_PORTA para mudar).
// Cenários de falha por variável de ambiente:
//   SIM_FILA=fora       -> POST /importacoes responde 503 FILA_INDISPONIVEL e /saude mostra fila "fora"
//   SIM_LIMITE_RPM=5    -> rate limit por tenant estoura com 5 req/min
// Contas de demonstração (senha Demo@2026): marcelo@devsolo.dev e gestor@techconsult.com.br
import { buildSimulador } from './app.js';

const porta = Number(process.env.SIM_PORTA ?? 3001);
const app = buildSimulador({
  logger: {
    level: 'info',
    // nunca registra o token: o serializador padrão já não loga cabeçalhos; isto é garantia extra
    redact: ['req.headers.authorization'],
  },
});

await app.listen({ port: porta, host: '127.0.0.1' });
app.log.info(`Simulador do contrato no ar em http://127.0.0.1:${porta} (fila: ${process.env.SIM_FILA ?? 'ok'})`);

for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => app.close().then(() => process.exit(0)));

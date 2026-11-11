// Roda a exclusão LGPD (bloco 14) UMA vez, agora, sem esperar as 3 h. Para a demonstração e para o operador:
//   docker compose exec api-contatos node src/excluir-agora.js
//   kubectl -n orbitati exec deploy/api-contatos -- node src/excluir-agora.js
// É a mesma função do job diário (src/exclusao.js), com o mesmo papel do banco (api_contatos) e a mesma
// fila: prova a ligação de ponta a ponta (API -> fila exclusao-importacao -> worker de importação).
// Só apaga quem foi cancelado há mais de 30 dias. Rodar duas vezes não faz mal (a segunda acha 0).
import { criarPool } from './db.js';
import { excluirTenantsVencidos } from './exclusao.js';
import { criarFila } from './fila.js';

// Log em JSON, uma linha por evento, no mesmo formato do pino (sem depender dele direto: vem pelo Fastify).
const escrever = (level) => (obj, msg) =>
  console.log(JSON.stringify({ level, time: Date.now(), servico: 'exclusao-manual', ...obj, msg }));
const log = { info: escrever(30), warn: escrever(40), error: escrever(50) };
const pool = criarPool(process.env.DATABASE_URL_API, log);
const fila = criarFila(process.env.REDIS_URL);

// A fila não espera a conexão (enableOfflineQueue: false): aguarda até 10 s antes de começar.
for (let i = 0; i < 50 && !(await fila.verificar()); i++) await new Promise((r) => setTimeout(r, 200));

let codigo = 0;
try {
  const r = await excluirTenantsVencidos({ pool, fila, log });
  console.log(JSON.stringify(r));
  if (r.adiados.length) codigo = 2;
} catch (erro) {
  log.error({ err: erro.message }, 'exclusão manual falhou');
  codigo = 1;
} finally {
  await fila.fechar();
  await pool.end();
}
process.exit(codigo);

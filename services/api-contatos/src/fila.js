// Fila de importações (BullMQ sobre Redis), do lado da API: só ENFILEIRA. Quem consome é o worker.
//
// Regra de ouro: Redis fora NÃO derruba a API. Só o POST /importacoes responde 503, e o /saude informa
// {fila: "fora"} com status 200 (decisão 2). Para isso, nada aqui pode ficar esperando o Redis voltar:
//   - enableOfflineQueue: false  com o Redis fora, o comando falha na hora em vez de entrar numa fila
//                                em memória esperando a reconexão (o que travaria a requisição);
//   - skipWaitingForReady: true  o BullMQ não espera a conexão ficar "ready" antes do add();
//   - status === 'ready'         conferido antes de tudo: sem conexão, nem tenta;
//   - timeout de 2 s             última barreira: se algo mesmo assim demorar, a requisição não trava.
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const NOME_FILA = 'importacoes';
const TIMEOUT_MS = 2_000;

/** Opções de cada job (bloco 4, item 6; ADR-003). O worker lê attempts para saber quando desistir. */
export const OPCOES_JOB = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 }, // 2 s, 4 s entre as tentativas
  // O CSV (dado pessoal dos contatos, LGPD) vai no payload: não deve morar no Redis depois de usado.
  removeOnComplete: true,
  removeOnFail: { age: 24 * 60 * 60 }, // 24 h para investigar uma falha; depois some
};

/** Erro de "fila indisponível": a rota traduz para 503 FILA_INDISPONIVEL. */
export class FilaIndisponivel extends Error {}

function comTimeout(promessa, ms, mensagem) {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new FilaIndisponivel(mensagem)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

/**
 * @param {string} redisUrl  ex.: redis://redis:6379
 * @returns {{ enfileirar(dados: object, jobId: string): Promise<void>, verificar(): Promise<boolean>, fechar(): Promise<void> }}
 */
export function criarFila(redisUrl) {
  const redis = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: TIMEOUT_MS,
    // Reconecta sozinho, com espera crescente até 5 s: quando o Redis volta, a fila volta sem reiniciar a API.
    retryStrategy: (tentativa) => Math.min(tentativa * 200, 5_000),
    lazyConnect: false,
  });
  // Sem este listener, um erro de conexão vira "Unhandled error event" e polui o log a cada tentativa.
  // O estado real é lido em redis.status.
  redis.on('error', () => {});

  // A Queue é criada só quando a conexão já está "ready" (na primeira importação). Motivo: ao nascer, ela
  // manda um INFO ao Redis para checar a versão. Com a API subindo antes de a conexão ficar pronta e
  // enableOfflineQueue: false, esse INFO falha, e a Queue guarda a falha para sempre: todo add() seguinte
  // recebia "Stream isn't writeable" mesmo com o Redis no ar (achado no teste do bloco 4).
  // Se a inicialização falhar mesmo assim, a Queue é descartada e recriada na próxima tentativa.
  let fila = null;
  let pronta = null;
  function obterFila() {
    if (!fila) {
      fila = new Queue(NOME_FILA, { connection: redis, skipWaitingForReady: true, defaultJobOptions: OPCOES_JOB });
      fila.on('error', () => {});
      const esta = fila;
      pronta = fila.waitUntilReady().catch((erro) => {
        if (fila === esta) fila = null; // a próxima chamada cria outra
        throw erro;
      });
    }
    return pronta.then(() => fila);
  }

  return {
    async enfileirar(dados, jobId) {
      if (redis.status !== 'ready') throw new FilaIndisponivel(`redis ${redis.status}`);
      try {
        // jobId = importacao_id: o BullMQ ignora um segundo add com o mesmo id (regra 8, idempotência).
        const adicionar = obterFila().then((q) => q.add('importar', dados, { jobId }));
        await comTimeout(adicionar, TIMEOUT_MS, 'add demorou demais');
      } catch (erro) {
        throw erro instanceof FilaIndisponivel ? erro : new FilaIndisponivel(erro.message);
      }
    },

    async verificar() {
      if (redis.status !== 'ready') return false;
      try {
        return (await comTimeout(redis.ping(), TIMEOUT_MS, 'ping demorou demais')) === 'PONG';
      } catch {
        return false;
      }
    },

    async fechar() {
      await fila?.close().catch(() => {});
      redis.disconnect();
    },
  };
}

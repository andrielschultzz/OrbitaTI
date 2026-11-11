// Filas BullMQ (Redis), do lado da API: só ENFILEIRA. Quem consome são os workers.
//   importacoes  -> services/importacao    (bloco 4)
//   emails       -> services/notificacoes  (bloco 10). Mesma conexão Redis, mesmas regras abaixo.
//   exclusao-importacao -> services/importacao (bloco 14, LGPD): apagar o schema importacao do tenant.
//
// Regra de ouro: Redis fora NÃO derruba a API. Só o POST /importacoes responde 503, e o /saude informa
// {fila: "fora"} com status 200 (decisão 2). O cadastro conclui sem o e-mail (bloco 10, item 3). Para
// isso, nada aqui pode ficar esperando o Redis voltar:
//   - enableOfflineQueue: false  com o Redis fora, o comando falha na hora em vez de entrar numa fila
//                                em memória esperando a reconexão (o que travaria a requisição);
//   - skipWaitingForReady: true  o BullMQ não espera a conexão ficar "ready" antes do add();
//   - status === 'ready'         conferido antes de tudo: sem conexão, nem tenta;
//   - timeout de 2 s             última barreira: se algo mesmo assim demorar, a requisição não trava.
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const NOME_FILA = 'importacoes';
export const NOME_FILA_EMAILS = 'emails'; // o mesmo do services/notificacoes/src/worker.js
// Bloco 14: pedido para o worker de importação apagar o schema importacao de um tenant excluído.
export const NOME_FILA_EXCLUSAO_IMPORTACAO = 'exclusao-importacao'; // o mesmo do services/importacao/src/worker.js
const TIMEOUT_MS = 2_000;

/** Opções de cada job (bloco 4, item 6; ADR-003). O worker lê attempts para saber quando desistir. */
export const OPCOES_JOB = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 }, // 2 s, 4 s entre as tentativas
  // O CSV (dado pessoal dos contatos, LGPD) vai no payload: não deve morar no Redis depois de usado.
  removeOnComplete: true,
  removeOnFail: { age: 24 * 60 * 60 }, // 24 h para investigar uma falha; depois some
};

/**
 * Opções do job de e-mail (bloco 10).
 *   5 tentativas (espera de 2, 4, 8 e 16 s): o SMTP do provedor cai por segundos, não por horas.
 *   removeOnComplete   o payload tem o e-mail (dado pessoal) e o link com o token, que vale 24 h como
 *                      credencial: não fica no Redis depois de enviado.
 *   removeOnFail 24 h  tempo para investigar, igual à validade do token: depois disso o link já não
 *                      vale nada e o job some.
 */
export const OPCOES_JOB_EMAIL = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: { age: 24 * 60 * 60 },
};

/**
 * Opções do job de exclusão do schema importacao (bloco 14).
 *   10 tentativas, backoff exponencial de 30 s: cobre horas de banco ou worker fora (30 s, 1 min, 2 min...).
 *   removeOnFail 7 dias: quando chega aqui, a API já apagou o schema orbita e não pede de novo (o tenant
 *   sumiu do tenants_para_excluir). O job falho fica para alguém reprocessar à mão (evento
 *   exclusao_importacao_falhou no log do worker). O payload só tem o tenant_id: nada pessoal no Redis.
 */
export const OPCOES_JOB_EXCLUSAO = {
  attempts: 10,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 60 * 60 },
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
 * @returns {{
 *   enfileirar(dados: object, jobId: string): Promise<void>,
 *   enfileirarEmail(dados: object, jobId: string): Promise<void>,
 *   enfileirarExclusaoImportacao(tenantId: string): Promise<void>,
 *   verificar(): Promise<boolean>,
 *   fechar(): Promise<void>,
 * }}
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

  // Cada Queue é criada só quando a conexão já está "ready" (no primeiro add). Motivo: ao nascer, ela
  // manda um INFO ao Redis para checar a versão. Com a API subindo antes de a conexão ficar pronta e
  // enableOfflineQueue: false, esse INFO falha, e a Queue guarda a falha para sempre: todo add() seguinte
  // recebia "Stream isn't writeable" mesmo com o Redis no ar (achado no teste do bloco 4).
  // Se a inicialização falhar mesmo assim, a Queue é descartada e recriada na próxima tentativa.
  const filas = new Map(); // nome -> { fila, pronta }
  function obterFila(nome, defaultJobOptions) {
    let item = filas.get(nome);
    if (!item) {
      const fila = new Queue(nome, { connection: redis, skipWaitingForReady: true, defaultJobOptions });
      fila.on('error', () => {});
      const pronta = fila.waitUntilReady().catch((erro) => {
        if (filas.get(nome)?.fila === fila) filas.delete(nome); // a próxima chamada cria outra
        throw erro;
      });
      item = { fila, pronta };
      filas.set(nome, item);
    }
    return item.pronta.then(() => item.fila);
  }

  async function adicionar(nome, opcoesPadrao, tipoJob, dados, jobId) {
    if (redis.status !== 'ready') throw new FilaIndisponivel(`redis ${redis.status}`);
    try {
      const add = obterFila(nome, opcoesPadrao).then((q) => q.add(tipoJob, dados, { jobId }));
      await comTimeout(add, TIMEOUT_MS, 'add demorou demais');
    } catch (erro) {
      throw erro instanceof FilaIndisponivel ? erro : new FilaIndisponivel(erro.message);
    }
  }

  return {
    // jobId = importacao_id: o BullMQ ignora um segundo add com o mesmo id (regra 8, idempotência).
    enfileirar: (dados, jobId) => adicionar(NOME_FILA, OPCOES_JOB, 'importar', dados, jobId),

    // jobId SEM ":" — o BullMQ 6 recusa ":" em id próprio ("Custom Id cannot contain :"), porque é o
    // separador das chaves no Redis. Com ":", todo add falharia e o cadastro só registraria o aviso.
    enfileirarEmail: (dados, jobId) => adicionar(NOME_FILA_EMAILS, OPCOES_JOB_EMAIL, dados.tipo, dados, jobId),

    // jobId fixo por tenant: duas execuções do job diário (ex.: a manual e a agendada) não duplicam o pedido.
    enfileirarExclusaoImportacao: (tenantId) =>
      adicionar(NOME_FILA_EXCLUSAO_IMPORTACAO, OPCOES_JOB_EXCLUSAO, 'apagar-tenant', { tenant_id: tenantId }, `excluir-${tenantId}`),

    async verificar() {
      if (redis.status !== 'ready') return false;
      try {
        return (await comTimeout(redis.ping(), TIMEOUT_MS, 'ping demorou demais')) === 'PONG';
      } catch {
        return false;
      }
    },

    async fechar() {
      await Promise.all([...filas.values()].map(({ fila }) => fila.close().catch(() => {})));
      redis.disconnect();
    },
  };
}

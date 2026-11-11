// Ponto de entrada do contêiner "importacao": o worker BullMQ da fila "importacoes".
//
// Configuração só pelo ambiente:
//   DATABASE_URL_IMPORTACAO  papel importacao_svc (só o schema importacao)
//   REDIS_URL                fila
//   JWT_SERVICO_SEGREDO      assina o token de serviço das rotas /interno
//   API_URL_INTERNA          ex.: http://api-contatos:3000
//   IMPORT_LOTE              linhas por lote (padrão 100)            > o teste de carga troca os dois
//   IMPORT_PAUSA_MS          pausa entre lotes em ms (padrão 500)    > para comparar com e sem a mitigação
//   PORTA_SAUDE              porta do /saude interno (padrão 3001; sem porta publicada)
//   LOG_NIVEL                padrão info
import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { criarClienteApi } from './api.js';
import { apagarDadosDoTenant, criarPool } from './db.js';
import { esgotouTentativas, processarImportacao } from './processar.js';

const NOME_FILA = 'importacoes'; // o mesmo da API (services/api-contatos/src/fila.js)
// Bloco 14 (LGPD): a API pede aqui que o worker apague o schema importacao de um tenant excluído.
const NOME_FILA_EXCLUSAO = 'exclusao-importacao'; // o mesmo da API (fila.js, NOME_FILA_EXCLUSAO_IMPORTACAO)
// No máximo 2 importações tocam o banco ao mesmo tempo, somando TODOS os tenants (CLAUDE.md: é o que
// substitui o intervalo de 5 min do ADR-003).
const CONCORRENCIA = 2;
// Teto do lote: o mesmo maxItems da rota /interno/.../lotes da API.
const LOTE_MAXIMO = 5000;

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não definido`);
  return valor;
}
function inteiro(nome, padrao, min, max) {
  const valor = Number(process.env[nome] ?? padrao);
  if (!Number.isInteger(valor) || valor < min || valor > max) throw new Error(`${nome} precisa ser inteiro entre ${min} e ${max}`);
  return valor;
}

const log = pino({ level: process.env.LOG_NIVEL ?? 'info', base: { servico: 'importacao' } });
const segredo = exigir('JWT_SERVICO_SEGREDO');
if (segredo.length < 32) throw new Error('JWT_SERVICO_SEGREDO precisa ter pelo menos 32 caracteres.');
const lote = inteiro('IMPORT_LOTE', 100, 1, LOTE_MAXIMO);
const pausaMs = inteiro('IMPORT_PAUSA_MS', 500, 0, 60_000);

const pool = criarPool(exigir('DATABASE_URL_IMPORTACAO'), log);
const api = criarClienteApi({ baseUrl: exigir('API_URL_INTERNA'), segredo });
// maxRetriesPerRequest: null é exigência do BullMQ para o Worker (ele usa comandos bloqueantes).
// Diferente da API, aqui o Redis fora não tem "plano B": o worker espera reconectar e segue.
const redis = new Redis(exigir('REDIS_URL'), { maxRetriesPerRequest: null });
redis.on('error', (erro) => log.warn({ err: erro.message }, 'redis: erro de conexão'));

const worker = new Worker(
  NOME_FILA,
  async (job) => {
    // Todo log do job sai com reqId (o x-request-id do POST /importacoes) e tenant_id (observabilidade).
    const jobLog = log.child({ reqId: job.data.request_id, tenant_id: job.data.tenant_id, importacao_id: job.data.importacao_id });
    return processarImportacao(job, { pool, api, lote, pausaMs, log: jobLog });
  },
  { connection: redis, concurrency: CONCORRENCIA },
);

// Última tentativa falhou (ou erro sem conserto): avisa a API, senão a importação ficaria "processando"
// para sempre e o Portal esperaria sem fim (contrato, seção 8).
worker.on('failed', async (job, erro) => {
  if (!job) return;
  const jobLog = log.child({ reqId: job.data.request_id, tenant_id: job.data.tenant_id, importacao_id: job.data.importacao_id });
  if (!esgotouTentativas(job, erro)) {
    jobLog.warn({ tentativa: job.attemptsMade, err: erro.message }, 'importacao: tentativa falhou, vai tentar de novo');
    return;
  }
  jobLog.error({ tentativas: job.attemptsMade, err: erro.message }, 'importacao: falhou de vez');
  try {
    const ctx = { importacaoId: job.data.importacao_id, tenantId: job.data.tenant_id, requestId: job.data.request_id };
    await api.falha(ctx, erro.message);
  } catch (e) {
    // Ex.: 404 porque o tenant foi apagado. Não há mais o que fazer além de registrar.
    jobLog.error({ err: e.message }, 'importacao: não conseguiu avisar a falha à API');
  }
});
worker.on('error', (erro) => log.error({ err: erro.message }, 'worker: erro'));

// Exclusão de tenant (bloco 14, achado B1). Database-per-service: o job diário da API apaga o schema orbita
// e pede, por esta fila, que o worker apague o schema importacao do mesmo tenant. O payload só tem o
// tenant_id (nenhum dado pessoal). concurrency 1: é raro e não tem pressa.
const workerExclusao = new Worker(
  NOME_FILA_EXCLUSAO,
  async (job) => {
    const linhas = await apagarDadosDoTenant(pool, job.data.tenant_id);
    log.info({ evento: 'importacao_dados_excluidos', tenant_id: job.data.tenant_id, linhas }, 'exclusão: schema importacao do tenant apagado');
  },
  { connection: redis, concurrency: 1 },
);
workerExclusao.on('failed', (job, erro) => {
  if (!job) return;
  const ultima = job.attemptsMade >= (job.opts?.attempts ?? 1);
  // Na última tentativa, alguém precisa agir: a API já apagou o schema orbita e não vai pedir de novo.
  // O job fica 7 dias no Redis (removeOnFail) para ser reprocessado à mão (job.retry()).
  const nivel = ultima ? 'error' : 'warn';
  log[nivel](
    { evento: ultima ? 'exclusao_importacao_falhou' : undefined, tenant_id: job.data?.tenant_id, tentativa: job.attemptsMade, err: erro.message },
    ultima ? 'exclusão: desistiu de apagar o schema importacao do tenant' : 'exclusão: tentativa falhou, vai tentar de novo',
  );
});
workerExclusao.on('error', (erro) => log.error({ err: erro.message }, 'worker de exclusão: erro'));

// /saude interno (sem porta publicada): healthcheck do compose e, no bloco 6, as probes do kind.
// 200 só com banco E fila ok: sem qualquer um dos dois o worker não consegue trabalhar.
const servidorSaude = createServer(async (req, res) => {
  if (req.url !== '/saude') {
    res.writeHead(404).end();
    return;
  }
  const db = await pool.query('SELECT 1').then(() => 'ok', () => 'fora');
  const fila = redis.status === 'ready' && worker.isRunning() && workerExclusao.isRunning() ? 'ok' : 'fora';
  res.writeHead(db === 'ok' && fila === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ db, fila }));
});
servidorSaude.listen(Number(process.env.PORTA_SAUDE ?? 3001), '0.0.0.0');

log.info({ concorrencia: CONCORRENCIA, lote, pausaMs }, 'worker de importação no ar');

// SIGTERM: worker.close() para de pegar jobs novos e espera os em andamento. Se o Docker matar antes
// (stop_grace_period), o job fica "travado", o BullMQ o devolve à fila e outra tentativa recomeça:
// seguro, porque tudo é idempotente (T-IMP-14).
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.once(sinal, async () => {
    log.info(`${sinal} recebido: encerrando`);
    servidorSaude.close();
    await Promise.all([worker.close(), workerExclusao.close()]);
    await pool.end();
    redis.disconnect();
    process.exit(0);
  });
}

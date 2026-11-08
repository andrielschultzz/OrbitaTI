// Ponto de entrada do contêiner "notificacoes": o worker BullMQ da fila "emails" (bloco 10).
//
// Não tem banco: tudo o que precisa vem no job (para, nome, link). Por isso não há DATABASE_URL aqui, e o
// serviço não enxerga nenhum schema (nem orbita, nem importacao).
//
// Configuração só pelo ambiente:
//   REDIS_URL         fila
//   SMTP_HOST         ex.: mailpit (local e kind); na VM, o provedor de e-mail
//   SMTP_PORTA        padrão 1025 (Mailpit)
//   EMAIL_REMETENTE   ex.: "OrbitaTI <nao-responda@orbitati.local>"
//   PORTA_SAUDE       porta do /saude interno (padrão 3001; sem porta publicada)
//   LOG_NIVEL         padrão info
//
// O que NUNCA vai para o log: o e-mail completo (dado pessoal, LGPD) e o link (o token dele vale como
// credencial por 24 h). O log leva o e-mail mascarado (m***@dominio) e, em erro de SMTP, só os códigos:
// a mensagem de erro do servidor costuma repetir o destinatário.
import { createServer } from 'node:http';
import { UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { DadosInvalidos, mascararEmail, montarEmail } from './mensagens.js';

const NOME_FILA = 'emails'; // o mesmo da API (services/api-contatos/src/fila.js, NOME_FILA_EMAILS)
// 5 envios ao mesmo tempo: o trabalho é esperar a rede do SMTP, não CPU. Não toca banco nenhum.
const CONCORRENCIA = 5;

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não definido`);
  return valor;
}

const log = pino({ level: process.env.LOG_NIVEL ?? 'info', base: { servico: 'notificacoes' } });
const remetente = exigir('EMAIL_REMETENTE');
const smtpPorta = Number(process.env.SMTP_PORTA ?? 1025);
if (!Number.isInteger(smtpPorta) || smtpPorta < 1 || smtpPorta > 65535) throw new Error('SMTP_PORTA inválida');

// Sem autenticação e sem exigir TLS: é o Mailpit. O provedor real (VM) precisa de usuário, senha e
// requireTLS: pendência registrada em docs/pendencias-bloco-7.md.
// Timeouts: um SMTP mudo não pode segurar o job para sempre; falha, e o BullMQ tenta de novo.
const transporte = nodemailer.createTransport({
  host: exigir('SMTP_HOST'),
  port: smtpPorta,
  secure: false,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

// maxRetriesPerRequest: null é exigência do BullMQ para o Worker (comandos bloqueantes).
const redis = new Redis(exigir('REDIS_URL'), { maxRetriesPerRequest: null });
redis.on('error', (erro) => log.warn({ err: erro.message }, 'redis: erro de conexão'));

const logDoJob = (job) =>
  log.child({ reqId: job.data?.request_id, tenant_id: job.data?.tenant_id, job_id: job.id, tipo: job.data?.tipo });

const worker = new Worker(
  NOME_FILA,
  async (job) => {
    const jobLog = logDoJob(job);
    let email;
    try {
      email = montarEmail(job.data);
    } catch (erro) {
      // Dado ruim não melhora com nova tentativa: UnrecoverableError faz o BullMQ desistir já.
      if (erro instanceof DadosInvalidos) throw new UnrecoverableError(erro.message);
      throw erro;
    }
    const info = await transporte.sendMail({ from: remetente, ...email });
    jobLog.info(
      {
        evento: 'email_enviado',
        para: mascararEmail(email.to),
        message_id: info.messageId,
        tentativa: job.attemptsMade + 1,
        // Do POST /auth/cadastro (enfileirou) até o SMTP aceitar: a parte do CQ-03 que é nossa.
        ms_desde_enfileirado: Date.now() - job.timestamp,
      },
      'e-mail enviado',
    );
  },
  { connection: redis, concurrency: CONCORRENCIA },
);

worker.on('failed', (job, erro) => {
  if (!job) return;
  const ultima = erro instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  // Só códigos: erro.message do SMTP pode trazer o destinatário ("550 <fulano@x>: mailbox unavailable").
  const detalhe = {
    para: mascararEmail(job.data?.para),
    tentativa: job.attemptsMade,
    codigo: erro.code ?? erro.name,
    smtp: erro.responseCode,
    comando: erro.command,
    ...(erro instanceof UnrecoverableError ? { motivo: erro.message } : {}), // nossas mensagens, sem dado pessoal
  };
  if (ultima) logDoJob(job).error({ evento: 'email_falhou', ...detalhe }, 'e-mail: desistiu (job fica 24 h no Redis)');
  else logDoJob(job).warn(detalhe, 'e-mail: tentativa falhou, vai tentar de novo');
});
worker.on('error', (erro) => log.error({ err: erro.message }, 'worker: erro'));

// /saude interno (sem porta publicada): healthcheck do compose e probes do kind.
// 200 com a fila ok. O SMTP NÃO entra: se o provedor cair, o worker segue vivo e as tentativas do
// BullMQ cuidam do reenvio; reiniciar o contêiner não resolveria nada.
const servidorSaude = createServer((req, res) => {
  if (req.url !== '/saude') {
    res.writeHead(404).end();
    return;
  }
  const fila = redis.status === 'ready' && worker.isRunning() ? 'ok' : 'fora';
  res.writeHead(fila === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ fila }));
});
servidorSaude.listen(Number(process.env.PORTA_SAUDE ?? 3001), '0.0.0.0');

log.info({ concorrencia: CONCORRENCIA, smtp_porta: smtpPorta }, 'worker de notificações no ar');

// SIGTERM: worker.close() para de pegar jobs e espera os envios em andamento.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.once(sinal, async () => {
    log.info(`${sinal} recebido: encerrando`);
    servidorSaude.close();
    await worker.close();
    transporte.close();
    redis.disconnect();
    process.exit(0);
  });
}

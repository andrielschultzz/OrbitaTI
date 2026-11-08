// Rate limit (bloco 5): o vizinho barulhento não pode tirar a vez dos outros tenants (ADR-003, CQ-01).
//
// Três limites, cada um com a sua chave:
//   padrão          chave = tenant_id (do TOKEN)  máx = requisicoes_por_minuto do plano (60 | 600, planos.js)
//   POST /auth/login     chave = IP + e-mail      10/min: força bruta numa conta
//   POST /auth/cadastro  chave = IP               LIMITE_CADASTRO_POR_MIN (padrão 60)
//   GET /auth/confirmar  chave = IP               10/min (bloco 10)
//   /saude, /planos, /interno/*: sem limite (config.rateLimit = false; T-RL-07 confere)
//
// Por que roda no preHandler, e não no onRequest: o tenant só é conhecido DEPOIS da autenticação
// (onRequest, autenticacao.js), e a chave do login precisa do e-mail, que só existe depois de o corpo ser
// lido e validado. Consequência aceita: requisição sem token não conta (o 401 sai antes); rejeitá-la custa
// só um HMAC, e não há tenant para punir.
//
// Onde fica o contador: no Redis. A API roda com 2 réplicas no kind; em memória, cada réplica contaria
// separado e o limite dobraria. Redis fora: skipOnError, o limite é ignorado em vez de derrubar a API.
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import { ErroContrato } from './erros.js';
import { limitesDo } from './planos.js';

const UM_MINUTO_MS = 60_000;
export const LOGIN_POR_MINUTO = 10;
export const CADASTRO_POR_MINUTO_PADRAO = 60;

/** Config de rota: POST /auth/login. A chave junta IP e e-mail (o corpo já foi validado no preHandler). */
export const limiteLogin = {
  max: LOGIN_POR_MINUTO,
  timeWindow: UM_MINUTO_MS,
  keyGenerator: (req) => `login:${req.ip}:${req.body.email.toLowerCase()}`,
};

/** Config de rota: POST /auth/cadastro. */
export const limiteCadastro = (max) => ({
  max,
  timeWindow: UM_MINUTO_MS,
  keyGenerator: (req) => `cadastro:${req.ip}`,
});

/**
 * Config de rota: GET /auth/confirmar (bloco 10). Por IP: a rota é pública e não há tenant.
 * 10/min, o mesmo número do login: uma pessoa clica no link 1 ou 2 vezes. Adivinhar um token assinado
 * (HS256) é inviável; o limite protege o banco e a CPU de quem martela a rota com lixo.
 */
export const CONFIRMACAO_POR_MINUTO = 10;
export const limiteConfirmacao = {
  max: CONFIRMACAO_POR_MINUTO,
  timeWindow: UM_MINUTO_MS,
  keyGenerator: (req) => `confirmar:${req.ip}`,
};

/** Chave do limite padrão. Rota pública sem config própria é erro de programação: falha alto (T-RL-07). */
export function chaveDoTenant(req) {
  if (!req.user?.tenant_id) throw new Error(`rota ${req.routeOptions.url} sem tenant e sem rateLimit próprio`);
  return `tenant:${req.user.tenant_id}`;
}

/** Máximo do limite padrão: vem do plano do token (feature flag por plano, planos.js). */
export const maximoDoPlano = (req) => limitesDo(req.user.plano).requisicoes_por_minuto;

/**
 * Conexão do rate limit, separada da fila: se uma travar, a outra segue. Mesma filosofia da fila.js:
 *   enableOfflineQueue: false   Redis fora -> o comando falha NA HORA (e o skipOnError deixa passar),
 *                               em vez de esperar a reconexão segurando a requisição;
 *   commandTimeout: 1 s         Redis no ar mas travado também não segura a requisição.
 */
export function criarRedisDoLimite(redisUrl) {
  const redis = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    retryStrategy: (tentativa) => Math.min(tentativa * 200, 5_000),
  });
  redis.on('error', () => {}); // o estado é lido em redis.status; sem isto, cada reconexão polui o log
  return redis;
}

/**
 * Registra o @fastify/rate-limit. Precisa vir ANTES das rotas: ele se pendura em cada rota pelo onRoute.
 * @param {import('fastify').FastifyInstance} app
 * @param {{redis: import('ioredis').Redis | null}} opcoes  null = contador em memória (só testes)
 */
export function registrarLimite(app, { redis }) {
  app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    keyGenerator: chaveDoTenant,
    max: maximoDoPlano,
    timeWindow: UM_MINUTO_MS,
    ...(redis ? { redis, nameSpace: 'orbitati-limite:' } : {}),
    skipOnError: true,
    // Vira o erro do contrato: o setErrorHandler responde {erro, codigo: "LIMITE_REQUISICOES"}.
    // O Retry-After já foi posto na resposta pelo plugin antes deste ponto.
    errorResponseBuilder: () => new ErroContrato(429, 'LIMITE_REQUISICOES'),
  });
}

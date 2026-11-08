// Monta a API sem abrir porta. O server.js chama buildApp() e escuta; os testes (bloco 3, T-ISO-13)
// chamam buildApp() para inspecionar as rotas sem subir nada.
//
// Ordem do que acontece numa requisição:
//   onRequest (autenticacao.js)  token válido? senão 401, antes mesmo de ler o corpo
//   validação (JSON Schema)      corpo/query fora do schema -> 400; :id que não é UUID -> 404
//   preHandler (limite.js)       rate limit por tenant, login ou cadastro -> 429 LIMITE_REQUISICOES
//   rota                         só fala com o banco via withTenant (regra 2)
//   setErrorHandler              tudo vira {erro, codigo} (contrato, seção 2), sem stack trace
import { randomUUID } from 'node:crypto';
import proxyAddr from '@fastify/proxy-addr';
import Fastify from 'fastify';
import autenticacao from './autenticacao.js';
import { criarPool } from './db.js';
import { ErroContrato, MENSAGENS, camposDaValidacao } from './erros.js';
import { criarFila } from './fila.js';
import { CADASTRO_POR_MINUTO_PADRAO, criarRedisDoLimite, registrarLimite } from './limite.js';
import rotasAuth from './rotas/auth.js';
import rotasContatos from './rotas/contatos.js';
import rotasImportacoes from './rotas/importacoes.js';
import rotasInterno from './rotas/interno.js';
import rotasPlanos from './rotas/planos.js';
import rotasSaude from './rotas/saude.js';

// x-request-id que vem de fora só é aceito se for curto e "comportado": ele vai para todo log, e um
// valor com quebra de linha ou gigante poderia forjar ou poluir linhas de log.
const REQUEST_ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;

/** Inteiro de opção ou do ambiente, dentro de [min, max]. Valor fora disso impede a API de subir. */
function inteiro(nome, valor, padrao, min, max) {
  const n = Number(valor ?? padrao);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nome} precisa ser inteiro entre ${min} e ${max}.`);
  return n;
}

/**
 * Base do link dos e-mails (contrato, seção 4): ${PORTAL_URL}/confirmar-email?token=...
 * Obrigatória e validada na subida: sem ela, o link sairia quebrado em todo cadastro, e ninguém perceberia
 * até um cliente reclamar. Nunca há "localhost" no código: local é http://localhost:8080 pelo .env.
 */
export function validarPortalUrl(valor) {
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('PORTAL_URL precisa ser uma URL http(s), ex.: http://localhost:8080.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('PORTAL_URL precisa ser uma URL http(s), sem query string, ex.: http://localhost:8080.');
  }
  return url.href.replace(/\/+$/, ''); // sem barra no fim: o código acrescenta "/confirmar-email"
}

/**
 * Esconde o valor de ?token= na URL que vai para o log. O Fastify registra a URL inteira em todo
 * "incoming request", e o link de confirmação (24 h) e o de exportação (bloco 14, 30 dias) carregam o
 * token na query: no log, ele valeria como credencial para quem lesse o arquivo (T-OBS-04).
 */
export const ocultarToken = (url) => String(url).replace(/([?&]token=)[^&#]*/gi, '$1[oculto]');

// Rede interna: loopback (127/8, ::1), privadas (10/8, 172.16/12, 192.168/16, fc00::/7) e link-local.
// É de onde o Nginx do Portal fala com a API (rede do compose ou do cluster).
const redeInterna = proxyAddr.compile(['loopback', 'uniquelocal', 'linklocal']);

/**
 * Função de confiança do trustProxy: confia nos `saltos` proxies mais próximos, mas SÓ se o endereço de
 * cada um for de rede interna.
 *
 * Por que não `trustProxy: saltos` (número): desde a 5.12.1 o Fastify ignora o número e não confia em
 * ninguém (advisory GHSA-3m5p-2c4r-xxw2, CVE-2026-16732). Só a contagem não confere QUEM conectou: um
 * cliente que alcançasse a API direto mandaria X-Forwarded-For com o IP que quisesse. Exigir rede interna
 * fecha isso: se a API for exposta na internet por engano, o header de quem vem de fora é ignorado.
 * O que sobra (quem já está na rede interna pode forjar) está em docs/pendencias-bloco-7.md.
 *
 * proxy-addr chama trust(endereço, i) do mais próximo (i = 0, quem abriu a conexão) para o mais distante.
 * O primeiro endereço NÃO confiável vira o req.ip.
 */
export function confiarNoProxy(saltos) {
  if (saltos === 0) return false; // ninguém na frente: o header é ignorado
  return (endereco, i) => i < saltos && redeInterna(endereco, i);
}

/**
 * @param {object} [opcoes]
 * @param {string} [opcoes.jwtSegredo]  segredo HS256 dos tokens de usuário (padrão: env JWT_SEGREDO)
 * @param {string} [opcoes.jwtServicoSegredo]  segredo do token de serviço (padrão: env JWT_SERVICO_SEGREDO)
 * @param {import('pg').Pool} [opcoes.pool]  pool pronto (senão cria um com opcoes.databaseUrl / env DATABASE_URL_API)
 * @param {string} [opcoes.databaseUrl]
 * @param {{enfileirar: Function, verificar: Function, fechar?: Function}} [opcoes.fila]  fila pronta
 *        (senão cria a do BullMQ com opcoes.redisUrl / env REDIS_URL). Os testes passam uma simulada.
 * @param {string} [opcoes.redisUrl]  também guarda o rate limit (padrão: env REDIS_URL, obrigatório)
 * @param {boolean} [opcoes.limiteEmMemoria]  SÓ TESTES: contador do rate limit em memória, sem Redis
 * @param {number} [opcoes.limiteCadastroPorMin]  padrão: env LIMITE_CADASTRO_POR_MIN ou 60
 * @param {number} [opcoes.trustProxySaltos]  proxies confiáveis na frente da API (padrão: env TRUST_PROXY_SALTOS ou 1)
 * @param {string} [opcoes.portalUrl]  base dos links de e-mail (padrão: env PORTAL_URL, obrigatório)
 * @param {object|boolean} [opcoes.logger]
 */
export function buildApp(opcoes = {}) {
  const jwtSegredo = opcoes.jwtSegredo ?? process.env.JWT_SEGREDO;
  // HS256 com segredo curto pode ser quebrado por força bruta offline (basta um token qualquer).
  // Melhor a API não subir do que subir assinando tokens fracos.
  if (!jwtSegredo || jwtSegredo.length < 32) {
    throw new Error('JWT_SEGREDO precisa ter pelo menos 32 caracteres.');
  }
  // Segredo do token de serviço (worker -> /interno, regra 7). Mesmas exigências, e DIFERENTE do de
  // usuário: se fossem iguais, vazar um seria vazar os dois.
  const jwtServicoSegredo = opcoes.jwtServicoSegredo ?? process.env.JWT_SERVICO_SEGREDO;
  if (!jwtServicoSegredo || jwtServicoSegredo.length < 32) {
    throw new Error('JWT_SERVICO_SEGREDO precisa ter pelo menos 32 caracteres.');
  }
  if (jwtServicoSegredo === jwtSegredo) throw new Error('JWT_SERVICO_SEGREDO precisa ser diferente de JWT_SEGREDO.');

  // Sem Redis, a API NÃO sobe. Contar em memória "para não cair" parece seguro, mas com 2 réplicas no kind
  // cada uma contaria separado e o limite dobraria sem ninguém perceber. Memória só quando o teste pede.
  const redisUrl = opcoes.redisUrl ?? process.env.REDIS_URL;
  if (!opcoes.limiteEmMemoria && !redisUrl) throw new Error('REDIS_URL não definido (fila e rate limit dependem dele).');
  const limiteCadastroPorMin = inteiro(
    'LIMITE_CADASTRO_POR_MIN', opcoes.limiteCadastroPorMin ?? process.env.LIMITE_CADASTRO_POR_MIN, CADASTRO_POR_MINUTO_PADRAO, 1, 100_000,
  );
  // Quantos proxies confiáveis existem na frente da API. Com 1 (o Nginx do Portal), o req.ip passa a ser o
  // último endereço do X-Forwarded-For, que o Nginx escreve, e não o IP do próprio Nginx. Sem isso, os
  // limites de login (IP + e-mail) e de cadastro (IP) valeriam para todos os usuários juntos.
  // 0 = ninguém na frente (API exposta direto, ex.: NodePort do kind): o header é ignorado.
  // Ver confiarNoProxy() acima: só confia se o proxy tiver IP de rede interna.
  const trustProxySaltos = inteiro('TRUST_PROXY_SALTOS', opcoes.trustProxySaltos ?? process.env.TRUST_PROXY_SALTOS, 1, 0, 10);
  const portalUrl = validarPortalUrl(opcoes.portalUrl ?? process.env.PORTAL_URL);

  // Logger: o serializer de req é o padrão do Fastify, mas com o ?token= escondido (ocultarToken).
  // Vale também para o logger que o teste passa (opcoes.logger), para que o T-OBS-04 meça o que roda.
  const logger = opcoes.logger === false ? false : {
    level: process.env.LOG_NIVEL ?? 'info',
    ...(typeof opcoes.logger === 'object' ? opcoes.logger : {}),
    serializers: {
      req: (req) => ({
        method: req.method,
        url: ocultarToken(req.url),
        host: req.host,
        remoteAddress: req.ip,
        remotePort: req.socket?.remotePort,
      }),
    },
  };

  const app = Fastify({
    trustProxy: confiarNoProxy(trustProxySaltos),
    logger,
    requestIdHeader: false, // lido e validado no genReqId abaixo
    genReqId: (req) => {
      const recebido = req.headers['x-request-id'];
      return typeof recebido === 'string' && REQUEST_ID_VALIDO.test(recebido) ? recebido : randomUUID();
    },
    // allErrors: o 400 lista TODOS os campos com problema, não só o primeiro (o Portal destaca todos).
    // removeAdditional (padrão do Fastify) continua ligado: propriedade fora do schema é descartada em
    // silêncio, então um tenant_id no corpo ou na query some antes de chegar na rota (T-ISO-06/07).
    ajv: { customOptions: { allErrors: true } },
  });

  const criouPool = !opcoes.pool;
  const pool = opcoes.pool ?? criarPool(opcoes.databaseUrl ?? process.env.DATABASE_URL_API, app.log);
  if (criouPool) app.addHook('onClose', async () => pool.end());

  // Mesma ideia do pool: quem recebe a fila pronta (teste) cuida de fechá-la.
  const criouFila = !opcoes.fila;
  const fila = opcoes.fila ?? criarFila(redisUrl);
  if (criouFila) app.addHook('onClose', async () => fila.fechar());

  const redisDoLimite = opcoes.limiteEmMemoria ? null : criarRedisDoLimite(redisUrl);
  if (redisDoLimite) app.addHook('onClose', async () => redisDoLimite.disconnect());

  // Todo response leva o x-request-id: é o "código" que o usuário informa no suporte (500 ERRO_INTERNO).
  app.addHook('onSend', async (req, rep) => {
    rep.header('x-request-id', req.id);
  });

  // Decisão 6 (CQ-02): todo 404 em rota com :id vira um evento no log. Com RLS, a API não sabe se o id é
  // de outro tenant ou se não existe (as duas coisas são "0 linhas"), então registra os dois casos. O
  // tenant_id entra sozinho: o req.log já é o logger filho criado na autenticação. Fica aqui, num ponto
  // só, para que toda rota nova com :id ganhe o evento sem precisar lembrar dele.
  const registrarNaoEncontrado = (req) => {
    const id = req.params?.id;
    if (typeof id !== 'string') return; // 404 de rota sem :id (não há recurso para auditar)
    req.log.info(
      { evento: 'recurso_nao_encontrado', metodo: req.method, rota: req.routeOptions.url, id: id.slice(0, 64) },
      'recurso não encontrado',
    );
  };

  app.setErrorHandler((erro, req, rep) => {
    if (erro instanceof ErroContrato) {
      if (erro.status === 404) registrarNaoEncontrado(req);
      return rep.status(erro.status).send(erro.corpo);
    }

    if (erro.validation) {
      // :id fora do formato UUID: para quem chama é só um recurso que não existe (contrato, seção 1).
      // Assim o Postgres nunca recebe um texto que não é UUID (que daria 500).
      if (erro.validationContext === 'params') {
        registrarNaoEncontrado(req);
        const mensagem = req.routeOptions.config?.naoEncontrado ?? MENSAGENS.NAO_ENCONTRADO;
        return rep.status(404).send({ erro: mensagem, codigo: 'NAO_ENCONTRADO' });
      }
      return rep
        .status(400)
        .send({ erro: MENSAGENS.VALIDACAO, codigo: 'VALIDACAO', campos: camposDaValidacao(erro.validation) });
    }
    if (erro.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return rep.status(413).send({ erro: MENSAGENS.ARQUIVO_GRANDE, codigo: 'ARQUIVO_GRANDE' });
    }
    if (erro.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return rep.status(415).send({ erro: MENSAGENS.TIPO_NAO_SUPORTADO, codigo: 'TIPO_NAO_SUPORTADO' });
    }
    if (erro.statusCode === 400) {
      // JSON malformado, corpo vazio com Content-Type JSON etc.: não há campo específico para destacar.
      return rep.status(400).send({ erro: MENSAGENS.VALIDACAO, codigo: 'VALIDACAO', campos: [] });
    }

    // Inesperado: o detalhe vai só para o log (com reqId e tenant_id); a resposta não tem stack trace.
    req.log.error({ err: erro }, 'erro inesperado');
    return rep
      .status(500)
      .send({ erro: `Erro interno. Se continuar, informe o código ${req.id}.`, codigo: 'ERRO_INTERNO' });
  });

  app.setNotFoundHandler((req, rep) => {
    rep.status(404).send({ erro: 'Rota não encontrada.', codigo: 'NAO_ENCONTRADO' });
  });

  app.register(autenticacao, { segredo: jwtSegredo, servicoSegredo: jwtServicoSegredo });
  // Depois da autenticação e ANTES das rotas (limite.js explica a ordem).
  registrarLimite(app, { redis: redisDoLimite });
  app.register(rotasSaude, { pool, fila });
  app.register(rotasPlanos);
  app.register(rotasAuth, { pool, fila, limiteCadastroPorMin, portalUrl });
  app.register(rotasContatos, { pool });
  app.register(rotasImportacoes, { pool, fila });
  app.register(rotasInterno, { pool });

  return app;
}

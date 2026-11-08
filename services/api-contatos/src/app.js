// Monta a API sem abrir porta. O server.js chama buildApp() e escuta; os testes (bloco 3, T-ISO-13)
// chamam buildApp() para inspecionar as rotas sem subir nada.
//
// Ordem do que acontece numa requisição:
//   onRequest (autenticacao.js)  token válido? senão 401, antes mesmo de ler o corpo
//   validação (JSON Schema)      corpo/query fora do schema -> 400; :id que não é UUID -> 404
//   rota                         só fala com o banco via withTenant (regra 2)
//   setErrorHandler              tudo vira {erro, codigo} (contrato, seção 2), sem stack trace
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import autenticacao from './autenticacao.js';
import { criarPool } from './db.js';
import { ErroContrato, MENSAGENS, camposDaValidacao } from './erros.js';
import rotasAuth from './rotas/auth.js';
import rotasContatos from './rotas/contatos.js';
import rotasSaude from './rotas/saude.js';

// x-request-id que vem de fora só é aceito se for curto e "comportado": ele vai para todo log, e um
// valor com quebra de linha ou gigante poderia forjar ou poluir linhas de log.
const REQUEST_ID_VALIDO = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * @param {object} [opcoes]
 * @param {string} [opcoes.jwtSegredo]  segredo HS256 dos tokens de usuário (padrão: env JWT_SEGREDO)
 * @param {import('pg').Pool} [opcoes.pool]  pool pronto (senão cria um com opcoes.databaseUrl / env DATABASE_URL_API)
 * @param {string} [opcoes.databaseUrl]
 * @param {object|boolean} [opcoes.logger]
 */
export function buildApp(opcoes = {}) {
  const jwtSegredo = opcoes.jwtSegredo ?? process.env.JWT_SEGREDO;
  // HS256 com segredo curto pode ser quebrado por força bruta offline (basta um token qualquer).
  // Melhor a API não subir do que subir assinando tokens fracos.
  if (!jwtSegredo || jwtSegredo.length < 32) {
    throw new Error('JWT_SEGREDO precisa ter pelo menos 32 caracteres.');
  }

  const app = Fastify({
    logger: opcoes.logger ?? { level: process.env.LOG_NIVEL ?? 'info' },
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
  const pool = opcoes.pool ?? criarPool(opcoes.databaseUrl ?? process.env.DATABASE_URL_API);
  if (criouPool) app.addHook('onClose', async () => pool.end());

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

  app.register(autenticacao, { segredo: jwtSegredo });
  app.register(rotasSaude, { pool });
  app.register(rotasAuth, { pool });
  app.register(rotasContatos, { pool });

  return app;
}

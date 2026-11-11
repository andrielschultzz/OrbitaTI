// Autenticação por JWT (ADR-002): o tenant vem do token assinado, nunca da requisição.
//
// - Toda rota é protegida por padrão. Rota pública declara `config: { publica: true }` (/auth/*, /saude,
//   /planos). Proteger por padrão é mais seguro que o contrário: uma rota nova esquecida fica fechada.
// - Roda no onRequest, ANTES de ler e validar o corpo: sem token é 401, nunca 400.
// - Só HS256 é aceito. Sem essa trava, um token forjado poderia pedir outro algoritmo no cabeçalho.
//
// Dois tipos de token, com DOIS segredos (regra 7). Vazar um não compromete o outro:
//   usuário   JWT_SEGREDO          rotas normais. Token de serviço aqui falha na assinatura: 401 (T-ISO-12).
//   serviço   JWT_SERVICO_SEGREDO  só rotas com `config: { servico: true }` (/interno/*). Exige
//                                  iss "importacao", aud "api-contatos", exp e no máximo 60 s de vida.
//                                  JWT de usuário aqui falha na assinatura: 401 (T-IMP-10).
//
// O link do e-mail de confirmação (bloco 10) também é um JWT com JWT_SEGREDO, mas com o claim
// finalidade: "confirmar-email" e 24 h de vida. O link de exportação (bloco 14) segue o mesmo desenho, com
// finalidade: "exportar-conta" e validade até cancelado_em + 30 dias (T-LGPD-04). As duas portas conferem a finalidade EXPLICITAMENTE:
//   - aqui, todo token com "finalidade" é 401: um link de e-mail nunca vira uma sessão de 24 h (T-AUTH-11);
//   - no GET /auth/confirmar, só "confirmar-email" vale: token de sessão não confirma e-mail (T-AUTH-12).
// O claimsValidas abaixo também recusaria o de confirmação, por faltar plano e papel. Mas isso seria
// coincidência: se um dia o token de confirmação ganhar esses claims, a porta continua fechada.
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { createVerifier } from 'fast-jwt';
import { ErroContrato } from './erros.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLANOS = new Set(['individual', 'equipe']);
const PAPEIS = new Set(['admin', 'consultor', 'visualizador']);

/** Claim finalidade do token do link de confirmação de e-mail (bloco 10). */
export const FINALIDADE_CONFIRMAR_EMAIL = 'confirmar-email';
/** Validade do link de confirmação (contrato, seção 4). */
export const VALIDADE_CONFIRMACAO = '24h';
/**
 * Claim finalidade do link de exportação enviado no cancelamento (bloco 14). Mesma porta de entrada do
 * link de confirmação: o hook abaixo recusa como sessão todo token com finalidade, e a rota
 * GET /conta/exportacao/arquivo só aceita esta.
 */
export const FINALIDADE_EXPORTAR_CONTA = 'exportar-conta';
/** Dias de exportação depois do cancelamento; depois disso o job de exclusão apaga o tenant (docs/lgpd.md). */
export const DIAS_EXPORTACAO = 30;

/** Token assinado, mas com claims fora do esperado, também é 401: nunca usar um tenant_id malformado. */
const claimsValidas = (c) =>
  typeof c?.sub === 'string' && UUID.test(c.sub) && typeof c.tenant_id === 'string' && UUID.test(c.tenant_id) &&
  PLANOS.has(c.plano) && PAPEIS.has(c.papel);

/** Vida máxima do token de serviço (regra 7). */
const VIDA_TOKEN_SERVICO_S = 60;
/** Diferença de relógio aceita entre o worker e a API (contêineres diferentes, mesmo host ou não). */
const TOLERANCIA_RELOGIO_S = 5;

function criarVerificadorServico(segredo) {
  const verificar = createVerifier({
    key: segredo,
    algorithms: ['HS256'],
    allowedIss: 'importacao',
    allowedAud: 'api-contatos',
    requiredClaims: ['iss', 'aud', 'exp', 'tenant_id'],
    clockTolerance: TOLERANCIA_RELOGIO_S * 1000,
  });
  return (token) => {
    const claims = verificar(token); // lança se assinatura, iss, aud ou exp estiverem errados
    // O exp poderia ter sido posto lá longe por quem tem o segredo: um token de serviço de 1 ano que
    // vaze em log valeria por 1 ano. A API recusa qualquer um que ainda tenha mais de 60 s de vida.
    const restante = claims.exp - Math.floor(Date.now() / 1000);
    if (restante > VIDA_TOKEN_SERVICO_S + TOLERANCIA_RELOGIO_S) throw new Error('token de serviço longo demais');
    if (typeof claims.tenant_id !== 'string' || !UUID.test(claims.tenant_id)) throw new Error('tenant_id inválido');
    return claims;
  };
}

/** Lê o "Bearer <token>" do cabeçalho. */
function tokenDoCabecalho(req) {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ');
  return tipo === 'Bearer' && token ? token : null;
}

async function autenticacao(app, { segredo, servicoSegredo }) {
  await app.register(jwt, {
    secret: segredo,
    sign: { algorithm: 'HS256', expiresIn: '15m' }, // 15 min: números do projeto (T-AUTH-07)
    verify: { algorithms: ['HS256'] },
  });
  const verificarServico = criarVerificadorServico(servicoSegredo);

  app.addHook('onRequest', async (req, rep) => {
    if (req.is404 || req.routeOptions.config?.publica) return;

    if (req.routeOptions.config?.servico) {
      let claims;
      try {
        claims = verificarServico(tokenDoCabecalho(req));
      } catch {
        throw new ErroContrato(401, 'NAO_AUTENTICADO');
      }
      // Mesmo formato de req.user das rotas de usuário: a rota lê req.user.tenant_id (regra 1).
      req.user = { tenant_id: claims.tenant_id, servico: claims.iss };
      req.log = rep.log = req.log.child({ tenant_id: claims.tenant_id });
      return;
    }

    let claims;
    try {
      claims = await req.jwtVerify();
    } catch {
      throw new ErroContrato(401, 'NAO_AUTENTICADO'); // sem token, adulterado, expirado: mesma resposta
    }
    // Token com finalidade (link de e-mail) nunca abre sessão, mesmo assinado e dentro do prazo.
    if (claims?.finalidade !== undefined || !claimsValidas(claims)) throw new ErroContrato(401, 'NAO_AUTENTICADO');
    req.user = { sub: claims.sub, tenant_id: claims.tenant_id, plano: claims.plano, papel: claims.papel };
    // Daqui em diante, todo log desta requisição sai com o tenant (observabilidade, CLAUDE.md).
    // O rep.log também: é por ele que o Fastify escreve o "request completed" no fim.
    req.log = rep.log = req.log.child({ tenant_id: claims.tenant_id });
  });
}

// fastify-plugin: o hook vale para a aplicação inteira, não só dentro deste plugin.
export default fp(autenticacao, { name: 'autenticacao' });

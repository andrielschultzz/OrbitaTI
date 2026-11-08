// Autenticação por JWT (ADR-002): o tenant vem do token assinado, nunca da requisição.
//
// - Toda rota é protegida por padrão. Rota pública declara `config: { publica: true }` (/auth/*, /saude).
//   Proteger por padrão é mais seguro que o contrário: uma rota nova esquecida fica fechada, não aberta.
// - Roda no onRequest, ANTES de ler e validar o corpo: sem token é 401, nunca 400.
// - Só HS256 é aceito. Sem essa trava, um token forjado poderia pedir outro algoritmo no cabeçalho.
// - O token de serviço do worker (bloco 4) usa OUTRO segredo, então aqui ele falha na assinatura: 401.
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { ErroContrato } from './erros.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLANOS = new Set(['individual', 'equipe']);
const PAPEIS = new Set(['admin', 'consultor', 'visualizador']);

/** Token assinado, mas com claims fora do esperado, também é 401: nunca usar um tenant_id malformado. */
const claimsValidas = (c) =>
  typeof c?.sub === 'string' && UUID.test(c.sub) && typeof c.tenant_id === 'string' && UUID.test(c.tenant_id) &&
  PLANOS.has(c.plano) && PAPEIS.has(c.papel);

async function autenticacao(app, { segredo }) {
  await app.register(jwt, {
    secret: segredo,
    sign: { algorithm: 'HS256', expiresIn: '15m' }, // 15 min: números do projeto (T-AUTH-07)
    verify: { algorithms: ['HS256'] },
  });

  app.addHook('onRequest', async (req, rep) => {
    if (req.is404 || req.routeOptions.config?.publica) return;
    let claims;
    try {
      claims = await req.jwtVerify();
    } catch {
      throw new ErroContrato(401, 'NAO_AUTENTICADO'); // sem token, adulterado, expirado: mesma resposta
    }
    if (!claimsValidas(claims)) throw new ErroContrato(401, 'NAO_AUTENTICADO');
    req.user = { sub: claims.sub, tenant_id: claims.tenant_id, plano: claims.plano, papel: claims.papel };
    // Daqui em diante, todo log desta requisição sai com o tenant (observabilidade, CLAUDE.md).
    // O rep.log também: é por ele que o Fastify escreve o "request completed" no fim.
    req.log = rep.log = req.log.child({ tenant_id: claims.tenant_id });
  });
}

// fastify-plugin: o hook vale para a aplicação inteira, não só dentro deste plugin.
export default fp(autenticacao, { name: 'autenticacao' });

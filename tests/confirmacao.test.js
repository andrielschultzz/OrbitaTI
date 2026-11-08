// Confirmação de e-mail (bloco 10) contra a stack do compose: API, Redis, notificações e Mailpit de verdade.
//   T-AUTH-09  o link do e-mail confirma: grava email_confirmado_em; clicar de novo mantém a data
//   T-AUTH-10  link adulterado, vencido ou de usuário apagado -> 400 LINK_INVALIDO
//   T-AUTH-11  token do link numa rota protegida -> 401 (o unitário cobre os detalhes)
//   T-AUTH-12  token de sessão no GET /auth/confirmar -> 400 LINK_INVALIDO
//   T-AUTH-13  o login NÃO exige confirmação
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, assinar, cadastrar, chamar, comoDono, limparTenants, payload, randomUUID } from './apoio/api.js';
import { apagar, esperarMensagem, lerMensagem, tokenDoEmail } from './apoio/mailpit.js';

// Cada clique sai de um IP próprio (192.0.2.101 em diante, faixa de documentação da RFC 5737). O arquivo
// faz ~7 confirmações por execução e o limite é 10/min por IP: num IP só, duas execuções seguidas da suíte
// dariam 429. O limite em si é testado no services/api-contatos/test/limite.test.js (T-RL-08).
let cliques = 0;
const confirmar = (token) =>
  chamar('GET', `/auth/confirmar?token=${encodeURIComponent(token)}`, {
    headers: { 'x-forwarded-for': `192.0.2.${101 + (cliques++ % 150)}` },
  });
const dataNoBanco = (tenantId, usuarioId) =>
  comoDono(tenantId, async (c) => (await c.query('SELECT email_confirmado_em FROM orbita.usuarios WHERE id = $1', [usuarioId])).rows[0]);

let conta; // {token, tenantId, email}
let tokenLink;

beforeAll(async () => {
  conta = await cadastrar();
  const { mensagem } = await esperarMensagem(conta.email, { limiteMs: 15_000 });
  const completa = await lerMensagem(mensagem.ID);
  expect(completa.Subject).toBe('Confirme seu e-mail no OrbitaTI');
  tokenLink = tokenDoEmail(completa.Text);
});
afterAll(async () => {
  await apagar(conta?.email);
  await limparTenants();
});

describe('o e-mail que chegou ao Mailpit', () => {
  it('aponta para PORTAL_URL/confirmar-email (o Portal), não para a API', async () => {
    const { mensagem } = await esperarMensagem(conta.email);
    const texto = (await lerMensagem(mensagem.ID)).Text;
    // O mesmo PORTAL_URL do .env que a API recebeu (os testes leem o .env no tests/apoio/api.js).
    expect(texto).toContain(`${process.env.PORTAL_URL.replace(/\/+$/, '')}/confirmar-email?token=`);
  });
});

describe('T-AUTH-09: o link confirma o e-mail', () => {
  it('200 {confirmado_em}, a data vai para o banco e o segundo clique devolve a mesma', async () => {
    const usuarioId = payload(conta.token).sub;
    expect((await dataNoBanco(conta.tenantId, usuarioId)).email_confirmado_em).toBeNull();

    const r = await confirmar(tokenLink);
    expect(r.status).toBe(200);
    expect(Object.keys(r.corpo)).toEqual(['confirmado_em']);
    const gravada = (await dataNoBanco(conta.tenantId, usuarioId)).email_confirmado_em;
    expect(gravada.toISOString()).toBe(r.corpo.confirmado_em);

    const deNovo = await confirmar(tokenLink);
    expect(deNovo.corpo.confirmado_em).toBe(r.corpo.confirmado_em);
  });
});

describe('T-AUTH-10: link que não vale -> 400 LINK_INVALIDO', () => {
  const segredo = () => process.env.JWT_SEGREDO;

  it('vencido (assinado certo, exp no passado)', async () => {
    const claims = payload(tokenLink);
    const vencido = assinar({ ...claims, iat: claims.iat - 90_000, exp: claims.iat - 3_600 }, segredo());
    expect((await confirmar(vencido)).corpo.codigo).toBe('LINK_INVALIDO');
  });

  it('adulterado (outro sub com a assinatura antiga)', async () => {
    const [cab, , ass] = tokenLink.split('.');
    const outro = Buffer.from(JSON.stringify({ ...payload(tokenLink), sub: randomUUID() })).toString('base64url');
    const r = await confirmar(`${cab}.${outro}.${ass}`);
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('LINK_INVALIDO');
  });

  it('usuário que não existe (token bem assinado, sub inventado) -> 400, sem 500', async () => {
    const claims = { ...payload(tokenLink), sub: randomUUID() };
    expect((await confirmar(assinar(claims, segredo()))).corpo.codigo).toBe('LINK_INVALIDO');
  });

  it('link do tenant A não confirma usuário do tenant B (o UPDATE roda sob RLS com o tenant do token)', async () => {
    const b = await cadastrar();
    const misturado = assinar({ ...payload(tokenLink), sub: payload(b.token).sub }, segredo());
    expect((await confirmar(misturado)).corpo.codigo).toBe('LINK_INVALIDO');
    expect((await dataNoBanco(b.tenantId, payload(b.token).sub)).email_confirmado_em).toBeNull();
    await apagar(b.email);
  });
});

describe('T-AUTH-11 e T-AUTH-12: um token não serve no lugar do outro', () => {
  it('T-AUTH-11: token do link -> GET /contatos 401', async () => {
    const r = await chamar('GET', '/contatos', { token: tokenLink });
    expect(r.status).toBe(401);
  });

  it('T-AUTH-12: token de sessão -> GET /auth/confirmar 400 LINK_INVALIDO', async () => {
    const r = await confirmar(conta.token);
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('LINK_INVALIDO');
  });
});

describe('T-AUTH-13: o login não exige confirmação', () => {
  it('conta recém-criada, sem clicar no link, entra (200)', async () => {
    const nova = await cadastrar();
    const r = await chamar('POST', '/auth/login', { corpo: { email: nova.email, senha: SENHA } });
    expect(r.status).toBe(200);
    await apagar(nova.email);
  });
});

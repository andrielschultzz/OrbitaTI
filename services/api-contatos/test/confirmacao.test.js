// Bloco 10, unitário: e-mail de confirmação e GET /auth/confirmar, com banco e fila FALSOS (sem stack).
// Os mesmos fluxos contra o Postgres de verdade estão em tests/confirmacao.test.js.
//
//   T-AUTH-11  token do link de confirmação NÃO abre sessão (rota protegida -> 401)
//   T-AUTH-12  token de sessão NÃO confirma e-mail (GET /auth/confirmar -> 400 LINK_INVALIDO)
//   T-RES-06   fila fora: o cadastro conclui (201) e registra aviso no log
//   T-OBS-04   o log não leva o token nem o e-mail completo
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, ocultarToken, validarPortalUrl } from '../src/app.js';

const SEGREDO = 'x'.repeat(32);
const PORTAL = 'https://portal.exemplo.com.br';

/** Pool falso que registra a ordem dos comandos (para provar "enfileira DEPOIS do COMMIT"). */
function poolFalso(eventos) {
  const cliente = {
    query: async (sql) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) eventos.push(sql);
      if (sql.startsWith('UPDATE orbita.usuarios')) return { rows: [{ email_confirmado_em: new Date('2026-11-08T12:00:00Z') }] };
      return { rows: [{ id: randomUUID() }] };
    },
    release: () => {},
  };
  return { query: async () => ({ rows: [] }), connect: async () => cliente };
}

const abertos = [];
function montar({ fila, eventos = [], logs } = {}) {
  const app = buildApp({
    jwtSegredo: SEGREDO,
    jwtServicoSegredo: 'y'.repeat(32),
    pool: poolFalso(eventos),
    fila: fila ?? {
      verificar: async () => true,
      enfileirar: async () => {},
      enfileirarEmail: async (dados, jobId) => eventos.push({ dados, jobId }),
    },
    limiteEmMemoria: true,
    portalUrl: PORTAL,
    logger: logs ? { level: 'info', stream: { write: (l) => logs.push(l) } } : false,
  });
  abertos.push(app);
  return app;
}
afterEach(async () => {
  while (abertos.length) await abertos.pop().close();
});

const CADASTRO = { empresa: 'Empresa', plano: 'individual', nome: 'Marcelo', email: 'Marcelo@DevSolo.dev', senha: 'Senha@1234' };
const cadastrar = (app) => app.inject({ method: 'POST', url: '/auth/cadastro', payload: CADASTRO });
const confirmar = (app, token) => app.inject({ method: 'GET', url: `/auth/confirmar?token=${encodeURIComponent(token)}` });
const tokenDoLink = (link) => new URL(link).searchParams.get('token');

describe('cadastro enfileira o e-mail de confirmação', () => {
  it('depois do COMMIT, com jobId sem ":" e o link em PORTAL_URL/confirmar-email', async () => {
    const eventos = [];
    const app = montar({ eventos });
    const r = await cadastrar(app);
    expect(r.statusCode).toBe(201);

    const job = eventos.find((e) => typeof e === 'object');
    // Ordem: BEGIN, COMMIT e só então a fila. Antes do COMMIT, um ROLLBACK deixaria um e-mail órfão.
    expect(eventos.indexOf('COMMIT')).toBeLessThan(eventos.indexOf(job));
    expect(job.jobId).toMatch(/^confirmar-cadastro-[0-9a-f-]{36}$/);
    expect(job.jobId).not.toContain(':'); // o BullMQ 6 recusa ":" em id próprio
    expect(job.dados).toMatchObject({ tipo: 'confirmar-cadastro', para: 'marcelo@devsolo.dev', nome: 'Marcelo' });
    expect(job.dados.link.startsWith(`${PORTAL}/confirmar-email?token=`)).toBe(true);
  });

  it('o token do link tem finalidade "confirmar-email" e vale 24 h', async () => {
    const eventos = [];
    const app = montar({ eventos });
    await cadastrar(app);
    const claims = app.jwt.decode(tokenDoLink(eventos.find((e) => e.dados).dados.link));
    expect(claims.finalidade).toBe('confirmar-email');
    expect(claims.exp - claims.iat).toBe(24 * 60 * 60);
    expect(claims).not.toHaveProperty('plano');
  });
});

describe('T-AUTH-11 e T-AUTH-12: token de confirmação e token de sessão não se trocam', () => {
  it('T-AUTH-11: o token do link de e-mail numa rota protegida -> 401 (não vira sessão de 24 h)', async () => {
    const eventos = [];
    const app = montar({ eventos });
    await cadastrar(app);
    const tokenEmail = tokenDoLink(eventos.find((e) => e.dados).dados.link);
    const r = await app.inject({ method: 'GET', url: '/contatos', headers: { authorization: `Bearer ${tokenEmail}` } });
    expect(r.statusCode).toBe(401);
    expect(r.json().codigo).toBe('NAO_AUTENTICADO');
  });

  it('T-AUTH-11: mesmo com plano e papel no token, a finalidade fecha a porta', async () => {
    const app = montar();
    await app.ready();
    const disfarcado = app.jwt.sign({
      sub: randomUUID(), tenant_id: randomUUID(), plano: 'individual', papel: 'admin', finalidade: 'confirmar-email',
    });
    const r = await app.inject({ method: 'GET', url: '/contatos', headers: { authorization: `Bearer ${disfarcado}` } });
    expect(r.statusCode).toBe(401);
  });

  it('T-AUTH-12: o token de sessão (do cadastro) no GET /auth/confirmar -> 400 LINK_INVALIDO', async () => {
    const app = montar();
    const sessao = (await cadastrar(app)).json().token;
    const r = await confirmar(app, sessao);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ erro: 'Este link é inválido ou venceu.', codigo: 'LINK_INVALIDO' });
  });

  it('o token do link confirma: 200 {confirmado_em}', async () => {
    const eventos = [];
    const app = montar({ eventos });
    await cadastrar(app);
    const r = await confirmar(app, tokenDoLink(eventos.find((e) => e.dados).dados.link));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ confirmado_em: '2026-11-08T12:00:00.000Z' });
  });
});

describe('GET /auth/confirmar: todo link ruim é 400 LINK_INVALIDO (nunca VALIDACAO)', () => {
  const casos = [
    ['sem token', '/auth/confirmar'],
    ['token vazio', '/auth/confirmar?token='],
    ['não é JWT', '/auth/confirmar?token=abc'],
    ['gigante', `/auth/confirmar?token=${'a'.repeat(5000)}`],
  ];
  it.each(casos)('%s', async (_nome, url) => {
    const r = await montar().inject({ method: 'GET', url });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('LINK_INVALIDO');
  });

  it('expirado e adulterado (payload trocado, assinatura que não confere)', async () => {
    const app = montar();
    await app.ready();
    const claims = { sub: randomUUID(), tenant_id: randomUUID(), finalidade: 'confirmar-email' };
    const vencido = app.jwt.sign({ ...claims, iat: 1_000, exp: 2_000 });
    expect((await confirmar(app, vencido)).json().codigo).toBe('LINK_INVALIDO');
    const [cab] = vencido.split('.');
    const forjado = `${cab}.${Buffer.from(JSON.stringify({ ...claims, exp: 9_999_999_999 })).toString('base64url')}.assinatura`;
    expect((await confirmar(app, forjado)).json().codigo).toBe('LINK_INVALIDO');
  });
});

describe('T-RES-06: fila de e-mail fora não impede o cadastro', () => {
  it('201 com o token de sessão e aviso email_nao_enfileirado no log', async () => {
    const logs = [];
    const fila = {
      verificar: async () => false,
      enfileirar: async () => {},
      enfileirarEmail: async () => { throw new Error('redis connecting'); },
    };
    const app = montar({ fila, logs });
    const r = await cadastrar(app);
    expect(r.statusCode).toBe(201);
    expect(r.json().token).toBeTypeOf('string');
    const aviso = logs.map((l) => JSON.parse(l)).find((l) => l.evento === 'email_nao_enfileirado');
    expect(aviso).toMatchObject({ level: 40, motivo: 'redis connecting' }); // 40 = warn
    expect(aviso.tenant_id).toBeTypeOf('string');
  });
});

describe('T-OBS-04: o log não leva o token do link nem o e-mail', () => {
  it('cadastro (com e sem fila) e confirmação: nenhum token nem e-mail em nenhuma linha', async () => {
    const logs = [];
    const eventos = [];
    const app = montar({ eventos, logs });
    await cadastrar(app);
    const token = tokenDoLink(eventos.find((e) => e.dados).dados.link);
    expect((await confirmar(app, token)).statusCode).toBe(200);
    expect((await confirmar(app, `${token}x`)).statusCode).toBe(400);

    const semFila = montar({ logs, fila: { verificar: async () => false, enfileirar: async () => {}, enfileirarEmail: async () => { throw new Error('fora'); } } });
    await cadastrar(semFila);

    const tudo = logs.join('\n');
    expect(tudo).toContain('[oculto]'); // a URL da confirmação foi registrada, mas sem o token
    expect(tudo).not.toContain(token);
    expect(tudo).not.toContain(token.split('.')[2]); // nem a assinatura sozinha
    expect(tudo.toLowerCase()).not.toContain('marcelo@devsolo.dev');
  });

  it('ocultarToken troca só o valor de token, em qualquer posição da query', () => {
    expect(ocultarToken('/auth/confirmar?token=abc.def')).toBe('/auth/confirmar?token=[oculto]');
    expect(ocultarToken('/x?a=1&token=abc&b=2')).toBe('/x?a=1&token=[oculto]&b=2');
    expect(ocultarToken('/contatos?busca=token')).toBe('/contatos?busca=token');
  });
});

describe('PORTAL_URL', () => {
  it('obrigatória e http(s): sem ela a API não sobe', () => {
    const base = { jwtSegredo: SEGREDO, jwtServicoSegredo: 'y'.repeat(32), pool: poolFalso([]), limiteEmMemoria: true, logger: false };
    const antes = process.env.PORTAL_URL;
    delete process.env.PORTAL_URL;
    try {
      expect(() => buildApp(base)).toThrow(/PORTAL_URL/);
    } finally {
      if (antes !== undefined) process.env.PORTAL_URL = antes;
    }
    expect(() => validarPortalUrl('ftp://x')).toThrow(/PORTAL_URL/);
    expect(() => validarPortalUrl('http://x/?a=1')).toThrow(/PORTAL_URL/);
  });

  it('a barra final some: o link nunca sai com "//confirmar-email"', () => {
    expect(validarPortalUrl('http://localhost:8080/')).toBe('http://localhost:8080');
    expect(validarPortalUrl('https://orbitati.exemplo.com.br/app/')).toBe('https://orbitati.exemplo.com.br/app');
  });
});

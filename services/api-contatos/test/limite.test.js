// Rate limit (bloco 5). Unitário: buildApp() com banco e fila falsos e contador EM MEMÓRIA, sem stack.
// Os casos que precisam do Redis de verdade (contador compartilhado, trustProxy pela rede) estão em
// tests/rate-limit.test.js.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { maximoDoPlano } from '../src/limite.js';
import { PLANOS } from '../src/planos.js';

const SEGREDOS = { jwtSegredo: 'x'.repeat(32), jwtServicoSegredo: 'y'.repeat(32) };
const FILA_FALSA = { verificar: async () => true, enfileirar: async () => {} };

// Pool falso que deixa o cadastro terminar com 201: toda query devolve um "id" novo.
const cliente = { query: async () => ({ rows: [{ id: randomUUID() }] }), release: () => {} };
const POOL_FALSO = { query: async () => ({ rows: [] }), connect: async () => cliente };

const abertos = [];
function montar(extra = {}) {
  const app = buildApp({ ...SEGREDOS, pool: POOL_FALSO, fila: FILA_FALSA, limiteEmMemoria: true, logger: false, ...extra });
  abertos.push(app);
  return app;
}
afterEach(async () => {
  while (abertos.length) await abertos.pop().close();
});

describe('T-RL-02: o limite vem do plano', () => {
  it('individual 60 × 1 = 60; equipe 60 × 10 = 600 req/min', () => {
    expect(maximoDoPlano({ user: { plano: 'individual' } })).toBe(60);
    expect(maximoDoPlano({ user: { plano: 'equipe' } })).toBe(600);
    // E é o mesmo número que o GET /planos mostra ao Portal (uma fonte só).
    expect(PLANOS.individual.limites.requisicoes_por_minuto).toBe(60);
    expect(PLANOS.equipe.limites.requisicoes_por_minuto).toBe(600);
  });
});

describe('T-RL-04: limite de cadastro por IP', () => {
  const cadastro = (app) =>
    app.inject({
      method: 'POST',
      url: '/auth/cadastro',
      payload: { empresa: 'E', plano: 'individual', nome: 'N', email: `${randomUUID()}@x.dev`, senha: 'Senha@1234' },
    });

  it('com LIMITE_CADASTRO_POR_MIN = 3, o 4º cadastro do mesmo IP -> 429 LIMITE_REQUISICOES com Retry-After', async () => {
    const app = montar({ limiteCadastroPorMin: 3 });
    for (let i = 0; i < 3; i++) expect((await cadastro(app)).statusCode).toBe(201);
    const r = await cadastro(app);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toEqual({ erro: 'Muitas ações seguidas. Tente de novo em instantes.', codigo: 'LIMITE_REQUISICOES' });
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  }, 20_000); // 4 hashes Argon2
});

describe('T-RL-07: só /saude, /planos e /interno ficam fora do limite', () => {
  it('toda rota tem limite, menos as três isentas; login e cadastro têm limite próprio', async () => {
    const app = montar();
    const rotas = [];
    app.addHook('onRoute', (r) => rotas.push(r));
    await app.ready();

    const isenta = (url) => url === '/saude' || url === '/planos' || url.startsWith('/interno/');
    const semLimite = rotas.filter((r) => r.config?.rateLimit === false).map((r) => r.url);
    expect(semLimite.length).toBeGreaterThan(0);
    for (const url of semLimite) expect(isenta(url), `${url} está sem rate limit`).toBe(true);
    for (const r of rotas.filter((r) => isenta(r.url))) expect(r.config?.rateLimit, r.url).toBe(false);

    // Rota pública (sem token) precisa de limite PRÓPRIO: o padrão usa o tenant, que ela não tem.
    for (const r of rotas.filter((r) => r.config?.publica && !isenta(r.url))) {
      expect(typeof r.config.rateLimit, `${r.url} pública sem limite próprio`).toBe('object');
    }
  });
});

describe('configuração', () => {
  it('sem REDIS_URL (e fora do modo de teste) a API recusa subir', () => {
    const antes = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      expect(() => buildApp({ ...SEGREDOS, pool: POOL_FALSO, fila: FILA_FALSA, logger: false })).toThrow(/REDIS_URL/);
    } finally {
      if (antes !== undefined) process.env.REDIS_URL = antes;
    }
  });

  it('TRUST_PROXY_SALTOS e LIMITE_CADASTRO_POR_MIN inválidos impedem a subida', () => {
    expect(() => montar({ trustProxySaltos: -1 })).toThrow(/TRUST_PROXY_SALTOS/);
    expect(() => montar({ trustProxySaltos: 'um' })).toThrow(/TRUST_PROXY_SALTOS/);
    expect(() => montar({ limiteCadastroPorMin: 0 })).toThrow(/LIMITE_CADASTRO_POR_MIN/);
  });

});

describe('T-RL-06 (unitário): o X-Forwarded-For só vale quando vem de um proxy da rede interna', () => {
  // remoteAddress = quem abriu a conexão TCP com a API (o Nginx, no caso normal).
  const ipVisto = async (saltos, remoteAddress, xff = '198.51.100.20') => {
    const app = montar({ trustProxySaltos: saltos });
    app.get('/ip-de-teste', { config: { publica: true, rateLimit: false } }, (req) => ({ ip: req.ip }));
    const r = await app.inject({ method: 'GET', url: '/ip-de-teste', remoteAddress, headers: { 'x-forwarded-for': xff } });
    return r.json().ip;
  };

  it('proxy de rede interna (172.18.0.5, rede do compose) -> req.ip vem do header', async () => {
    expect(await ipVisto(1, '172.18.0.5')).toBe('198.51.100.20');
    expect(await ipVisto(1, '10.244.0.7')).toBe('198.51.100.20'); // rede de pods do kind
    expect(await ipVisto(1, '::ffff:172.18.0.5')).toBe('198.51.100.20'); // IPv4 escrito como IPv6
  });

  it('conexão de IP público (203.0.113.5) -> o header é ignorado e o req.ip é o 203.0.113.5', async () => {
    expect(await ipVisto(1, '203.0.113.5')).toBe('203.0.113.5');
  });

  it('1 salto: só o último endereço do header conta (o que o Nginx escreveu), não o que o cliente inventou', async () => {
    expect(await ipVisto(1, '172.18.0.5', '1.1.1.1, 198.51.100.20')).toBe('198.51.100.20');
  });

  it('0 saltos (NodePort do kind): o header é ignorado mesmo vindo da rede interna', async () => {
    expect(await ipVisto(0, '172.18.0.5')).toBe('172.18.0.5');
  });
});

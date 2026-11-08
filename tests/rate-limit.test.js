// Rate limit contra a API do compose, com o contador no Redis de verdade (bloco 5).
// Os casos que não precisam da stack (limite do plano, cadastro, rotas isentas, trustProxy por endereço)
// estão em services/api-contatos/test/limite.test.js.
//
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, cadastrar, chamar, emailUnico, limparTenants, payload, randomUUID, registrarTenant } from './apoio/api.js';

afterAll(limparTenants);

const LIMITE_INDIVIDUAL = 60; // planos.js: 60 req/min × 1 usuário

describe('T-RL-01: um tenant estoura o limite e o outro segue normal', () => {
  let a;
  let b;
  beforeAll(async () => {
    a = await cadastrar({ plano: 'individual' });
    b = await cadastrar({ plano: 'individual' });
  });

  it('A: 60 respostas normais e a 61ª -> 429 com Retry-After; B logo depois -> 200', async () => {
    // Alterna duas rotas: o contador é UM por tenant, somando todas as rotas (não 60 por rota).
    const rotas = ['/contatos', `/importacoes/${randomUUID()}`];
    const status = [];
    for (let i = 0; i < LIMITE_INDIVIDUAL; i++) status.push((await chamar('GET', rotas[i % 2], { token: a.token })).status);
    expect(status.filter((s) => s === 429)).toEqual([]); // nenhuma das 60 foi barrada
    expect(new Set(status)).toEqual(new Set([200, 404])); // /contatos -> 200; importação inexistente -> 404

    const estourou = await chamar('GET', '/contatos', { token: a.token });
    expect(estourou.status).toBe(429);
    expect(estourou.corpo).toEqual({ erro: 'Muitas ações seguidas. Tente de novo em instantes.', codigo: 'LIMITE_REQUISICOES' });
    const espera = Number(estourou.headers.get('retry-after'));
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThanOrEqual(60);

    // O vizinho não sente nada.
    const vizinho = await chamar('GET', '/contatos', { token: b.token });
    expect(vizinho.status).toBe(200);
    expect(Number(vizinho.headers.get('x-ratelimit-limit'))).toBe(LIMITE_INDIVIDUAL);
  }, 30_000);
});

describe('T-RL-03: força bruta no login (chave = IP + e-mail)', () => {
  it('10 logins passam, o 11º -> 429 mesmo com a senha certa; outro e-mail do mesmo IP -> normal', async () => {
    const alvo = await cadastrar();
    const outro = await cadastrar();
    const login = (email) => chamar('POST', '/auth/login', { corpo: { email, senha: SENHA } });

    for (let i = 0; i < 10; i++) expect((await login(alvo.email)).status).toBe(200);
    const bloqueado = await login(alvo.email);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.corpo.codigo).toBe('LIMITE_REQUISICOES');
    expect(Number(bloqueado.headers.get('retry-after'))).toBeGreaterThan(0);

    // E-mail em maiúsculas é a MESMA conta: não pode virar um contador novo.
    expect((await login(alvo.email.toUpperCase())).status).toBe(429);
    expect((await login(outro.email)).status).toBe(200);
  }, 30_000);
});

describe('T-RL-05: /saude e /planos ficam fora do limite', () => {
  it('70 GET /saude e 70 GET /planos seguidos -> nenhum 429', async () => {
    const status = [];
    for (let i = 0; i < 70; i++) {
      status.push((await chamar('GET', '/saude')).status, (await chamar('GET', '/planos')).status);
    }
    expect(status.filter((s) => s === 429)).toEqual([]);
    expect(new Set(status)).toEqual(new Set([200]));
  }, 30_000);
});

describe('T-RL-06: atrás do proxy, cada IP do X-Forwarded-For tem o seu contador de login', () => {
  // As chamadas do host chegam à API pela rede do Docker (IP interno), como o Nginx chegaria. Com
  // TRUST_PROXY_SALTOS=1, o req.ip vira o endereço do header. Sem o trustProxy, os dois "usuários" abaixo
  // seriam o mesmo IP, e o usuário B ficaria bloqueado pelos erros do A.
  it('mesmo e-mail: o IP A esgota as 10 tentativas, o IP B continua podendo tentar', async () => {
    const conta = await cadastrar();
    const tentar = (ip) =>
      chamar('POST', '/auth/login', { corpo: { email: conta.email, senha: 'senha-errada' }, headers: { 'x-forwarded-for': ip } });

    for (let i = 0; i < 10; i++) expect((await tentar('198.51.100.1')).status).toBe(401);
    expect((await tentar('198.51.100.1')).status).toBe(429);
    expect((await tentar('198.51.100.2')).status).toBe(401); // 401 = chegou a conferir a senha
  }, 30_000);
});

describe('limite de cadastro (padrão 60/min por IP)', () => {
  it('o cadastro informa o limite nos headers (o 429 em si é o T-RL-04, unitário)', async () => {
    const r = await chamar('POST', '/auth/cadastro', {
      corpo: { empresa: 'E', plano: 'individual', nome: 'N', email: emailUnico('cad'), senha: SENHA },
      headers: { 'x-forwarded-for': '198.51.100.30' },
    });
    expect(r.status).toBe(201);
    expect(Number(r.headers.get('x-ratelimit-limit'))).toBe(Number(process.env.LIMITE_CADASTRO_POR_MIN ?? 60));
    registrarTenant(payload(r.corpo.token).tenant_id);
  });
});

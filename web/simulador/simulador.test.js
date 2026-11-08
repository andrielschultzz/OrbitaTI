// Confere que o simulador segue o contrato nos pontos de que o Portal depende.
// Se o simulador mentir, o Portal passa nos testes aqui e quebra na API real (Fase 6).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSimulador } from './app.js';
import { assinar } from './jwt.js';

let app;
beforeEach(() => {
  app = buildSimulador();
});
afterEach(() => app.close());

async function entrar(email = 'marcelo@devsolo.dev') {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'Demo@2026' } });
  expect(r.statusCode).toBe(200);
  return { authorization: `Bearer ${r.json().token}` };
}

const semTenantId = (corpo) => expect(JSON.stringify(corpo)).not.toMatch(/tenant/i);

describe('simulador do contrato', () => {
  it('token tem os claims do contrato e dura 15 min', async () => {
    const { authorization } = await entrar();
    const claims = JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ plano: 'individual', papel: 'admin' });
    expect(claims.tenant_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.exp - claims.iat).toBe(900);
  });

  it('login errado: mesmo corpo para e-mail inexistente e senha errada', async () => {
    const a = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@x.com', senha: 'Demo@2026' } });
    const b = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'marcelo@devsolo.dev', senha: 'errada123' } });
    expect(a.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
    expect(a.json().codigo).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('sem token, token adulterado ou expirado: 401 NAO_AUTENTICADO (antes de validar o corpo)', async () => {
    const semToken = await app.inject({ method: 'POST', url: '/contatos', payload: {} });
    expect(semToken.statusCode).toBe(401);
    expect(semToken.json().codigo).toBe('NAO_AUTENTICADO');

    const { authorization } = await entrar();
    const adulterado = authorization.slice(0, -2) + (authorization.endsWith('A') ? 'BB' : 'AA');
    const r1 = await app.inject({ method: 'GET', url: '/contatos', headers: { authorization: adulterado } });
    expect(r1.statusCode).toBe(401);

    const vencido = assinar({ sub: 'x', tenant_id: 'y', plano: 'individual', papel: 'admin', iat: 1, exp: 2 });
    const r2 = await app.inject({ method: 'GET', url: '/contatos', headers: { authorization: `Bearer ${vencido}` } });
    expect(r2.statusCode).toBe(401);
  });

  it('isolamento: contato de outro tenant responde 404 igual a inexistente; :id não UUID também', async () => {
    const devsolo = await entrar();
    const tech = await entrar('gestor@techconsult.com.br');
    const lista = await app.inject({ method: 'GET', url: '/contatos', headers: tech });
    const idDaTech = lista.json().itens[0].id;

    const cruzado = await app.inject({ method: 'GET', url: `/contatos/${idDaTech}`, headers: devsolo });
    const inexistente = await app.inject({
      method: 'GET',
      url: '/contatos/00000000-0000-4000-8000-000000000000',
      headers: devsolo,
    });
    const naoUuid = await app.inject({ method: 'GET', url: '/contatos/abc', headers: devsolo });
    for (const r of [cruzado, inexistente, naoUuid]) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ erro: 'Contato não encontrado.', codigo: 'NAO_ENCONTRADO' });
    }
    const apagar = await app.inject({ method: 'DELETE', url: `/contatos/${idDaTech}`, headers: devsolo });
    expect(apagar.statusCode).toBe(404);
  });

  it('nenhuma resposta devolve tenant_id; tenant_id no corpo é descartado', async () => {
    const h = await entrar();
    const criado = await app.inject({
      method: 'POST',
      url: '/contatos',
      headers: h,
      payload: { nome: 'Só nome', tenant_id: '00000000-0000-4000-8000-000000000000' },
    });
    expect(criado.statusCode).toBe(201);
    semTenantId(criado.json());
    expect(criado.json()).toMatchObject({ nome: 'Só nome', email: null, estagio: 'lead', ultima_interacao_em: null });
    semTenantId((await app.inject({ method: 'GET', url: '/contatos', headers: h })).json());
    semTenantId((await app.inject({ method: 'GET', url: '/contatos/esfriando?limite=5', headers: h })).json());
  });

  it('validação 400 traz campos; e-mail duplicado 409 em minúsculas', async () => {
    const h = await entrar();
    const r = await app.inject({ method: 'POST', url: '/contatos', headers: h, payload: { email: 'ruim' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('VALIDACAO');
    expect(r.json().campos.map((c) => c.campo).sort()).toEqual(['email', 'nome']);

    await app.inject({ method: 'POST', url: '/contatos', headers: h, payload: { nome: 'A', email: 'Dup@X.com' } });
    const dup = await app.inject({ method: 'POST', url: '/contatos', headers: h, payload: { nome: 'B', email: 'dup@x.com' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('EMAIL_DUPLICADO');
  });

  it('esfriando: só frios, sem perdidos, do mais antigo para o mais novo, com campos extras', async () => {
    const h = await entrar('gestor@techconsult.com.br');
    const r = await app.inject({ method: 'GET', url: '/contatos/esfriando?limite=5', headers: h });
    const { itens, dias, limite } = r.json();
    expect({ dias, limite }).toEqual({ dias: 90, limite: 5 });
    expect(itens).toHaveLength(5);
    expect(itens.every((c) => c.dias_sem_interacao > 90 && c.estagio !== 'perdido')).toBe(true);
    const diasLista = itens.map((c) => c.dias_sem_interacao);
    expect(diasLista).toEqual([...diasLista].sort((a, b) => b - a));
    expect(itens.some((c) => c.nunca_contatado)).toBe(true);
  });

  it('interação: devolve o contato atualizado e usa GREATEST', async () => {
    const h = await entrar();
    const { id } = (await app.inject({ method: 'POST', url: '/contatos', headers: h, payload: { nome: 'C' } })).json();
    const hoje = await app.inject({ method: 'POST', url: `/contatos/${id}/interacoes`, headers: h, payload: { tipo: 'ligacao' } });
    expect(hoje.statusCode).toBe(201);
    const ultima = hoje.json().contato.ultima_interacao_em;
    const antiga = await app.inject({
      method: 'POST',
      url: `/contatos/${id}/interacoes`,
      headers: h,
      payload: { tipo: 'email', ocorrida_em: '2026-01-01T12:00:00.000Z' },
    });
    expect(antiga.json().contato.ultima_interacao_em).toBe(ultima);
    const futura = await app.inject({
      method: 'POST',
      url: `/contatos/${id}/interacoes`,
      headers: h,
      payload: { tipo: 'email', ocorrida_em: new Date(Date.now() + 3600e3).toISOString() },
    });
    expect(futura.statusCode).toBe(400);
    expect(futura.json().campos[0].campo).toBe('ocorrida_em');
  });

  it('importação: erros 413/415/422 e o fluxo na_fila -> concluida', async () => {
    const h = await entrar();
    const csv = (texto) => ({ method: 'POST', url: '/importacoes', headers: { ...h, 'content-type': 'text/csv' }, payload: texto });

    expect((await app.inject(csv('a'.repeat(1024 * 1024 + 1)))).json().codigo).toBe('ARQUIVO_GRANDE');
    const json = await app.inject({ method: 'POST', url: '/importacoes', headers: h, payload: { a: 1 } });
    expect(json.statusCode).toBe(415);
    expect((await app.inject(csv('nome;telefone\nA;1'))).json().codigo).toBe('CSV_SEM_COLUNAS');
    expect((await app.inject(csv('nome;email\n'))).json().codigo).toBe('CSV_VAZIO');
    const acima = await app.inject(csv('nome;email\n' + 'A;a@a.com\n'.repeat(101)));
    expect(acima.statusCode).toBe(422);
    expect(acima.json()).toMatchObject({ codigo: 'LINHAS_ACIMA_DO_PLANO', limite: 100, linhas: 101 });

    // BOM + cabeçalho com acento/hífen + 1 linha inválida (sem e-mail)
    const ok = await app.inject(csv('﻿Nome;E-mail;Observação\nNovo;novo@x.com;oi\nSem email;;x'));
    expect(ok.statusCode).toBe(202);
    const url = `/importacoes/${ok.json().importacao_id}`;
    const naFila = (await app.inject({ method: 'GET', url, headers: h })).json();
    expect(naFila).toMatchObject({ status: 'na_fila', total_linhas: 2, total_lotes: null, linhas_invalidas: null });
    await new Promise((r) => setTimeout(r, 1300));
    const fim = (await app.inject({ method: 'GET', url, headers: h })).json();
    expect(fim).toMatchObject({ status: 'concluida', total_lotes: 1, lotes_aplicados: 1, linhas_invalidas: 1 });
    semTenantId(fim);

    const outro = await entrar('gestor@techconsult.com.br');
    expect((await app.inject({ method: 'GET', url, headers: outro })).statusCode).toBe(404);
  });

  it('cenários de falha: fila fora (503) e rate limit com Retry-After', async () => {
    await app.close();
    app = buildSimulador({ fila: 'fora', limiteRpm: 3 });
    const h = await entrar();
    expect((await app.inject({ method: 'GET', url: '/saude' })).json()).toEqual({ db: 'ok', fila: 'fora' });
    const r = await app.inject({
      method: 'POST',
      url: '/importacoes',
      headers: { ...h, 'content-type': 'text/csv' },
      payload: 'nome;email\nA;a@a.com',
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().codigo).toBe('FILA_INDISPONIVEL');
    await app.inject({ method: 'GET', url: '/contatos', headers: h });
    await app.inject({ method: 'GET', url: '/contatos', headers: h });
    const estourou = await app.inject({ method: 'GET', url: '/contatos', headers: h });
    expect(estourou.statusCode).toBe(429);
    expect(Number(estourou.headers['retry-after'])).toBeGreaterThan(0);
    // /saude e /planos ficam fora do limite
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'GET', url: '/planos' })).statusCode).toBe(200);
  });

  it('/planos é público e traz preço em centavos; /conta só para admin', async () => {
    const r = await app.inject({ method: 'GET', url: '/planos' });
    expect(r.json().itens.map((p) => [p.plano, p.preco_mensal_centavos])).toEqual([
      ['individual', 4900],
      ['equipe', 24900],
    ]);
    const h = await entrar();
    const exp = await app.inject({ method: 'GET', url: '/conta/exportacao', headers: h });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-disposition']).toMatch(/attachment; filename="orbitati-exportacao-/);
    expect(JSON.stringify(exp.json())).not.toMatch(/senha_hash/);
  });

  it('x-request-id: devolve o recebido ou gera um', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/saude', headers: { 'x-request-id': 'abc-123' } });
    expect(r1.headers['x-request-id']).toBe('abc-123');
    const r2 = await app.inject({ method: 'GET', url: '/saude' });
    expect(r2.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

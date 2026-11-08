// T-ISO-13 (docs/plano-de-testes.md): nenhuma rota aceita tenant_id. É a regra 1 do CLAUDE.md e o
// ADR-002 ("o tenant vem só do JWT") conferidos por máquina, não por revisão de código.
//
// Como funciona: monta o app com buildApp() (sem abrir porta e sem banco), coleta cada rota pelo hook
// onRoute e procura "tenant" no caminho e nos NOMES de propriedade dos schemas de params, querystring
// e corpo. Se alguém criar /tenants/:tenant_id/contatos ou aceitar {"tenant_id": ...} no corpo, falha.
//
// Teste unitário: não precisa da stack do Docker no ar.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const SEGREDO_FALSO = 'x'.repeat(32); // buildApp exige 32+ caracteres; nenhum token é assinado aqui
const POOL_FALSO = { query: async () => ({ rows: [] }) }; // nenhuma rota é chamada, só registrada

/** Nomes de propriedade de um JSON Schema, em qualquer profundidade (objetos dentro de objetos, arrays). */
function nomesDePropriedade(schema, nomes = []) {
  if (!schema || typeof schema !== 'object') return nomes;
  for (const [chave, valor] of Object.entries(schema)) {
    if (chave === 'properties' && valor && typeof valor === 'object') nomes.push(...Object.keys(valor));
    if (chave === 'required' && Array.isArray(valor)) nomes.push(...valor);
    nomesDePropriedade(valor, nomes);
  }
  return nomes;
}

/** Monta o app, deixa `extra` registrar rotas a mais (contra-teste) e devolve as rotas registradas. */
async function rotasRegistradas(extra) {
  const app = buildApp({ jwtSegredo: SEGREDO_FALSO, pool: POOL_FALSO, logger: false });
  const rotas = [];
  app.addHook('onRoute', (rota) => rotas.push(rota));
  if (extra) app.register(extra);
  await app.ready(); // os plugins (e as rotas) só são carregados aqui
  await app.close();
  return rotas;
}

/** Lista de violações: "MÉTODO caminho: onde apareceu". Vazia = nenhuma rota aceita tenant. */
function violacoes(rotas) {
  const achados = [];
  for (const rota of rotas) {
    const nome = `${[rota.method].flat().join(',')} ${rota.url}`;
    if (/tenant/i.test(rota.url)) achados.push(`${nome}: no caminho`);
    for (const parte of ['params', 'querystring', 'body']) {
      const campos = nomesDePropriedade(rota.schema?.[parte]).filter((n) => /tenant/i.test(n));
      if (campos.length) achados.push(`${nome}: em ${parte} (${[...new Set(campos)].join(', ')})`);
    }
  }
  return achados;
}

describe('T-ISO-13: nenhuma rota aceita tenant_id', () => {
  it('nenhum caminho, querystring ou corpo menciona tenant', async () => {
    const rotas = await rotasRegistradas();
    expect(rotas.length).toBeGreaterThan(0); // se não coletou nada, o teste não provaria coisa nenhuma
    expect(violacoes(rotas)).toEqual([]);
  });

  // Contra-teste: prova que o verificador acusa de verdade. Sem isto, um bug no próprio teste (ex.: não
  // coletar rota nenhuma) faria ele passar sempre, e "passar sempre" é o pior defeito de um teste.
  it('contra-teste: acusa rota com tenant no caminho, na querystring e no corpo', async () => {
    const rotas = await rotasRegistradas(async (app) => {
      app.get('/tenants/:tenant_id/contatos', async () => ({}));
      app.get('/proibida', { schema: { querystring: { type: 'object', properties: { tenantId: { type: 'string' } } } } }, async () => ({}));
      app.post(
        '/proibida',
        { schema: { body: { type: 'object', properties: { dados: { type: 'object', properties: { tenant_id: { type: 'string' } } } } } } },
        async () => ({}),
      );
    });
    const achados = violacoes(rotas);
    expect(achados.some((a) => a.includes('/tenants/:tenant_id/contatos: no caminho'))).toBe(true);
    expect(achados.some((a) => a.includes('GET /proibida: em querystring'))).toBe(true);
    expect(achados.some((a) => a.includes('POST /proibida: em body (tenant_id)'))).toBe(true);
  });
});

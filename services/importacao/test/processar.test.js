// Processamento de um job (unitário, sem stack): banco, API e pausa simulados.
// O que se prova aqui é a ORDEM das chamadas e as decisões (pausa, desistir ou tentar de novo).
// O caminho real, com fila, banco e API, é o tests/importacao.test.js.
import { describe, expect, it } from 'vitest';
import { assinarTokenServico, ErroDefinitivo } from '../src/api.js';
import { esgotouTentativas, processarImportacao } from '../src/processar.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const IMP = '22222222-2222-4222-8222-222222222222';

/** Pool falso: aceita qualquer query (execucoes e erros_linha) e guarda o que foi pedido. */
function poolFalso() {
  const queries = [];
  const cliente = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [], rowCount: 0 }; }, release: () => {} };
  return { queries, connect: async () => cliente };
}

function cenario({ respostasLote = [], falhaNoLote } = {}) {
  const chamadas = [];
  const api = {
    inicio: async (_ctx, total, invalidas) => { chamadas.push(['inicio', total, invalidas]); return { status: 'processando' }; },
    lote: async (_ctx, numero, contatos) => {
      chamadas.push(['lote', numero, contatos.length]);
      if (falhaNoLote === numero) throw new ErroDefinitivo('API respondeu 404');
      return { aplicado: respostasLote[numero - 1] ?? true };
    },
  };
  const pausas = [];
  const job = (csv, attemptsMade = 0) => ({
    id: IMP, attemptsMade, opts: { attempts: 3 },
    data: { importacao_id: IMP, tenant_id: TENANT, request_id: 'req-1', csv },
    updateProgress: async () => {},
  });
  const log = { info: () => {}, error: () => {}, warn: () => {} };
  const deps = { pool: poolFalso(), api, lote: 100, pausaMs: 500, log, esperar: async (ms) => { pausas.push(ms); } };
  return { chamadas, pausas, job, deps };
}

const csv = (validas, invalidas = 0) =>
  ['nome,email', ...Array.from({ length: validas }, (_, i) => `N${i},n${i}@x.dev`), ...Array.from({ length: invalidas }, (_, i) => `Inv${i},`)].join('\n');

describe('processarImportacao', () => {
  it('250 válidas + 3 inválidas: inicio(3, 3), 3 lotes, 2 pausas de 500 ms (nenhuma depois do último)', async () => {
    const { chamadas, pausas, job, deps } = cenario();
    await processarImportacao(job(csv(250, 3)), deps);
    expect(chamadas).toEqual([['inicio', 3, 3], ['lote', 1, 100], ['lote', 2, 100], ['lote', 3, 50]]);
    expect(pausas).toEqual([500, 500]);
  });

  it('100 válidas + 3 inválidas: 1 lote (a API não conta as inválidas), sem pausa', async () => {
    const { chamadas, pausas, job, deps } = cenario();
    await processarImportacao(job(csv(100, 3)), deps);
    expect(chamadas).toEqual([['inicio', 1, 3], ['lote', 1, 100]]);
    expect(pausas).toEqual([]);
  });

  it('só inválidas: inicio(0, n) e nenhum lote (a API marca concluida)', async () => {
    const { chamadas, job, deps } = cenario();
    await processarImportacao(job(csv(0, 4)), deps);
    expect(chamadas).toEqual([['inicio', 0, 4]]);
  });

  it('retry: lote já aplicado ({aplicado:false}) não ganha pausa (não houve escrita)', async () => {
    const { pausas, job, deps } = cenario({ respostasLote: [false, false, true] });
    await processarImportacao(job(csv(250), 1), deps);
    expect(pausas).toEqual([]); // lote 1 e 2 já estavam lá; depois do 3 (último) não há pausa
  });

  it('4xx da API -> UnrecoverableError (não gasta as outras tentativas)', async () => {
    const { job, deps } = cenario({ falhaNoLote: 2 });
    await expect(processarImportacao(job(csv(250)), deps)).rejects.toMatchObject({ name: 'UnrecoverableError' });
  });

  it('CSV ilegível -> UnrecoverableError, e nem chama a API', async () => {
    const { chamadas, job, deps } = cenario();
    await expect(processarImportacao(job('nome,email\n"aberta,x@x.dev\n'), deps)).rejects.toMatchObject({ name: 'UnrecoverableError' });
    expect(chamadas).toEqual([]);
  });

  it('grava os erros de linha apagando os anteriores antes (retry não duplica)', async () => {
    const { job, deps } = cenario();
    await processarImportacao(job(csv(1, 2)), deps);
    const sqls = deps.pool.queries.map((q) => q.sql.replace(/\s+/g, ' ').trim());
    const del = sqls.findIndex((s) => s.startsWith('DELETE FROM importacao.erros_linha'));
    const ins = sqls.findIndex((s) => s.startsWith('INSERT INTO importacao.erros_linha'));
    expect(del).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(del);
  });
});

describe('esgotouTentativas', () => {
  const job = (attemptsMade) => ({ attemptsMade, opts: { attempts: 3 } });
  it('1ª e 2ª falha: tenta de novo; 3ª: desiste; UnrecoverableError: desiste já', () => {
    expect(esgotouTentativas(job(1), new Error('x'))).toBe(false);
    expect(esgotouTentativas(job(2), new Error('x'))).toBe(false);
    expect(esgotouTentativas(job(3), new Error('x'))).toBe(true);
    const definitivo = Object.assign(new Error('x'), { name: 'UnrecoverableError' });
    expect(esgotouTentativas(job(1), definitivo)).toBe(true);
  });
});

describe('token de serviço', () => {
  it('claims da regra 7: tenant_id, iss importacao, aud api-contatos, 60 s de vida', () => {
    const token = assinarTokenServico(TENANT, 's'.repeat(32), 1_000_000);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(claims).toEqual({ tenant_id: TENANT, iss: 'importacao', aud: 'api-contatos', iat: 1_000_000, exp: 1_000_060 });
  });
});

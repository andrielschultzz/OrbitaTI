// Importação de CSV (contrato, seção 7; ADR-003). Duas partes:
//   1. POST /importacoes: o que a API recusa NA HORA, antes da fila (415, 413, 422, 429, 503);
//   2. ponta a ponta com o worker: CSV -> fila -> worker -> /interno -> concluida (bloco 4, itens 9 e 11).
//
// Pré-requisito: docker compose up -d --build --wait (com o serviço importacao no ar para a parte 2)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../services/api-contatos/src/app.js';
import { FilaIndisponivel } from '../services/api-contatos/src/fila.js';
import { cadastrar, chamar, comoDono, criarImportacaoNoBanco, csvValido, limparTenants } from './apoio/api.js';

// Base fictícia dos links de e-mail (PORTAL_URL). Só precisa ser uma URL válida.
const PORTAL_URL_TESTE = 'http://portal.teste';

afterAll(limparTenants);

const importar = (quem, csv, tipo) => chamar('POST', '/importacoes', { token: quem.token, csv, tipo });
const importacoesNoBanco = (tenantId) =>
  comoDono(tenantId, async (c) => (await c.query('SELECT status FROM orbita.importacoes')).rows);

describe('POST /importacoes: recusas na hora (antes da fila)', () => {
  let ind; // individual sem importações
  beforeAll(async () => {
    ind = await cadastrar({ plano: 'individual', empresa: 'Importação recusas' });
  });

  it('415: corpo JSON ou text/plain não é CSV', async () => {
    const json = await chamar('POST', '/importacoes', { token: ind.token, corpo: { nome: 'x', email: 'x@x.dev' } });
    expect(json.status).toBe(415);
    expect(json.corpo.codigo).toBe('TIPO_NAO_SUPORTADO');
    const texto = await importar(ind, 'nome,email\nx,x@x.dev', 'text/plain');
    expect(texto.status).toBe(415);
    expect(texto.corpo.codigo).toBe('TIPO_NAO_SUPORTADO');
  });

  it.each([
    ['arquivo vazio', ''],
    ['só linhas em branco', '\n\n  \n'],
    ['só o cabeçalho', 'nome,email\n'],
    ['cabeçalho e linhas em branco', 'nome;email\r\n\r\n\r\n'],
  ])('422 CSV_VAZIO: %s', async (_nome, csv) => {
    const r = await importar(ind, csv);
    expect(r.status).toBe(422);
    expect(r.corpo.codigo).toBe('CSV_VAZIO');
  });

  it.each([
    ['sem a coluna email', 'nome,telefone\nAna,123'],
    ['sem a coluna nome', 'email,empresa\nana@x.dev,X'],
    ['dados sem cabeçalho', 'Ana,ana@x.dev\nBia,bia@x.dev'],
  ])('422 CSV_SEM_COLUNAS: %s', async (_nome, csv) => {
    const r = await importar(ind, csv);
    expect(r.status).toBe(422);
    expect(r.corpo.codigo).toBe('CSV_SEM_COLUNAS');
  });

  it('T-IMP-07: corpo com 1.048.577 bytes (1 MB + 1) -> 413 e nada gravado', async () => {
    const cabecalho = 'nome,email\n';
    const csv = cabecalho + 'x'.repeat(1_048_577 - cabecalho.length);
    expect(Buffer.byteLength(csv)).toBe(1_048_577);
    const r = await importar(ind, csv);
    expect(r.status).toBe(413);
    expect(r.corpo.codigo).toBe('ARQUIVO_GRANDE');
    expect(await importacoesNoBanco(ind.tenantId)).toEqual([]);
  });

  it('nenhuma recusa acima gravou importação', async () => {
    expect(await importacoesNoBanco(ind.tenantId)).toEqual([]);
  });
});

describe('T-IMP-05 e T-IMP-06: limite de linhas do plano', () => {
  it('T-IMP-05: individual com 101 linhas -> 422 com limite e linhas; com 100 -> 202', async () => {
    const ind = await cadastrar({ plano: 'individual', empresa: 'Importação T-IMP-05' });
    const acima = await importar(ind, csvValido(101));
    expect(acima.status).toBe(422);
    expect(acima.corpo).toMatchObject({ codigo: 'LINHAS_ACIMA_DO_PLANO', limite: 100, linhas: 101 });
    expect(acima.corpo.erro).toBe('Seu plano permite até 100 linhas por importação.');

    const noLimite = await importar(ind, csvValido(100));
    expect(noLimite.status).toBe(202);
    expect(noLimite.corpo.importacao_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('T-IMP-06: equipe com 5.001 linhas curtas -> 422 (não 413); com 5.000 -> 202', async () => {
    const eq = await cadastrar({ plano: 'equipe', empresa: 'Importação T-IMP-06' });
    const acima = csvValido(5001, { prefixo: 'c' });
    expect(Buffer.byteLength(acima)).toBeLessThan(1_048_576); // linhas de ~40 bytes: o 422 não vira 413
    expect((await importar(eq, acima)).corpo).toMatchObject({ codigo: 'LINHAS_ACIMA_DO_PLANO', limite: 5000, linhas: 5001 });
    const aceita = await importar(eq, csvValido(5000, { prefixo: 'c' }));
    expect(aceita.status).toBe(202);
    // Este teste é só sobre o limite. Encerrar a importação já evita 50 lotes × 0,5 s (25 s) de worker
    // ocupado durante o resto da suíte: com status final, cada lote volta {aplicado:false}, sem pausa.
    await comoDono(eq.tenantId, (c) =>
      c.query(`UPDATE orbita.importacoes SET status = 'falhou' WHERE id = $1`, [aceita.corpo.importacao_id]),
    );
  });

  it('Content-Type com charset também é CSV (text/csv; charset=utf-8)', async () => {
    const ind = await cadastrar({ plano: 'individual', empresa: 'Importação charset' });
    expect((await importar(ind, csvValido(2), 'text/csv; charset=utf-8')).status).toBe(202);
  });
});

describe('T-IMP-08: importações simultâneas contadas no banco', () => {
  // Fixture direta no banco (decisão do plano de testes): disparar importações reais e esperar 429
  // dependeria de quem termina primeiro.
  it('individual com 2 na_fila -> 429 (limite 2); equipe com 5 -> 429 (limite 5); individual vazio -> 202', async () => {
    const ind = await cadastrar({ plano: 'individual', empresa: 'Simultâneas individual' });
    const eq = await cadastrar({ plano: 'equipe', empresa: 'Simultâneas equipe' });
    const livre = await cadastrar({ plano: 'individual', empresa: 'Simultâneas livre' });
    for (let i = 0; i < 2; i++) await criarImportacaoNoBanco(ind.tenantId, { status: 'na_fila', totalLotes: null, linhasInvalidas: null });
    for (let i = 0; i < 5; i++) await criarImportacaoNoBanco(eq.tenantId, { status: i % 2 ? 'na_fila' : 'processando' });
    // Encerradas não contam:
    await criarImportacaoNoBanco(livre.tenantId, { status: 'concluida' });
    await criarImportacaoNoBanco(livre.tenantId, { status: 'falhou' });

    const r1 = await importar(ind, csvValido(1));
    expect(r1.status).toBe(429);
    expect(r1.corpo).toMatchObject({ codigo: 'IMPORTACOES_SIMULTANEAS', limite: 2 });
    const r2 = await importar(eq, csvValido(1));
    expect(r2.status).toBe(429);
    expect(r2.corpo).toMatchObject({ codigo: 'IMPORTACOES_SIMULTANEAS', limite: 5 });
    expect((await importar(livre, csvValido(1))).status).toBe(202); // a contagem é por tenant
  });
});

// ---------------------------------------------------------------------------------------------------
// Fila fora: API no próprio processo, com o banco de verdade e uma fila simulada (o Redis do compose não
// tem porta publicada). O ensaio com o Redis parado de verdade é o T-RES-03.
// ---------------------------------------------------------------------------------------------------
describe('T-IMP-22: 503 FILA_INDISPONIVEL (bloco 4, item 2)', () => {
  let pool;
  let ind;
  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.PGHOST_TESTES ?? '127.0.0.1',
      port: Number(process.env.PGPORT_TESTES ?? 5432),
      database: 'orbitati',
      user: 'api_contatos',
      password: process.env.DB_SENHA_API,
      max: 2,
    });
    ind = await cadastrar({ plano: 'individual', empresa: 'Fila fora' });
  });
  afterAll(() => pool?.end());

  async function comFila(fila, fn) {
    const app = buildApp({ pool, fila, limiteEmMemoria: true, portalUrl: PORTAL_URL_TESTE, logger: false });
    try {
      return await fn(app);
    } finally {
      await app.close();
    }
  }
  const postar = (app) =>
    app.inject({
      method: 'POST',
      url: '/importacoes',
      headers: { authorization: `Bearer ${ind.token}`, 'content-type': 'text/csv' },
      payload: csvValido(3),
    });
  const esperado = {
    erro: 'Importação indisponível no momento. O restante do sistema segue funcionando.',
    codigo: 'FILA_INDISPONIVEL',
  };

  it('Redis fora (verificar = false) -> 503 sem tocar o banco', async () => {
    const r = await comFila({ verificar: async () => false, enfileirar: async () => {}, enfileirarEmail: async () => {} }, postar);
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual(esperado);
    expect(await importacoesNoBanco(ind.tenantId)).toEqual([]);
  });

  it('Redis cai entre a verificação e o add -> 503 e o registro é desfeito (compensação)', async () => {
    let jobId;
    const fila = {
      verificar: async () => true,
      enfileirar: async (_dados, id) => {
        jobId = id;
        throw new FilaIndisponivel('simulado');
      },
    };
    const r = await comFila(fila, postar);
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual(esperado);
    expect(jobId).toBeDefined(); // chegou a gravar e tentar enfileirar...
    expect(await importacoesNoBanco(ind.tenantId)).toEqual([]); // ...e desfez: não ocupa vaga de simultâneas
  });

  it('payload do job: tenant do token, request_id, CSV inteiro; jobId = importacao_id', async () => {
    let recebido;
    const fila = { verificar: async () => true, enfileirar: async (dados, jobId) => { recebido = { dados, jobId }; } };
    const csv = csvValido(3);
    const r = await comFila(fila, (app) =>
      app.inject({
        method: 'POST',
        url: '/importacoes',
        headers: { authorization: `Bearer ${ind.token}`, 'content-type': 'text/csv', 'x-request-id': 'teste-payload-1' },
        payload: csv,
      }),
    );
    expect(r.statusCode).toBe(202);
    const { importacao_id: id } = r.json();
    expect(recebido.jobId).toBe(id);
    expect(recebido.dados).toEqual({ importacao_id: id, tenant_id: ind.tenantId, usuario_id: expect.any(String), request_id: 'teste-payload-1', csv });
    expect(await importacoesNoBanco(ind.tenantId)).toEqual([{ status: 'na_fila' }]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Ponta a ponta: CSV -> API -> fila -> worker -> /interno -> concluida. Precisa do serviço importacao.
// ---------------------------------------------------------------------------------------------------
const ESPERA_MS = 30_000;

/**
 * Consulta GET /importacoes/:id até concluir ou falhar (é o que o Portal faz). Devolve a importação final
 * e a SEQUÊNCIA de status observados (sem repetições), para o T-IMP-12.
 */
async function esperarFim(quem, id, esperaMs = ESPERA_MS) {
  const vistos = [];
  const limite = Date.now() + esperaMs;
  while (Date.now() < limite) {
    const r = await chamar('GET', `/importacoes/${id}`, { token: quem.token });
    expect(r.status).toBe(200);
    if (vistos.at(-1) !== r.corpo.status) vistos.push(r.corpo.status);
    if (r.corpo.status === 'concluida' || r.corpo.status === 'falhou') return { final: r.corpo, vistos };
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error(`importação ${id} não terminou em ${esperaMs / 1000} s (status: ${vistos.join(' -> ')})`);
}

/** Contatos e erros de linha do tenant, lidos direto no banco (o GET /contatos pagina em 100). */
const noBanco = (tenantId, importacaoId) =>
  comoDono(tenantId, async (c) => ({
    contatos: (await c.query('SELECT count(*)::int AS n FROM orbita.contatos')).rows[0].n,
    erros: (await c.query('SELECT linha, motivo FROM importacao.erros_linha WHERE importacao_id = $1 ORDER BY linha', [importacaoId ?? null])).rows,
  }));

const invalidas = ['Sem Email,', ',sem-nome@x.dev', 'Email Ruim,nao-e-email'];
const comInvalidas = (validas) => `${csvValido(validas)}\n${invalidas.join('\n')}`;

describe('ponta a ponta com o worker (bloco 4, itens 9 e 11)', () => {
  let eq;
  let outro;
  beforeAll(async () => {
    eq = await cadastrar({ plano: 'equipe', empresa: 'Ponta a ponta' });
    outro = await cadastrar({ plano: 'equipe', empresa: 'Ponta a ponta vizinho' });
  });

  it('T-IMP-01 e T-IMP-12: 250 válidas + 3 inválidas -> concluida, 3 lotes, 250 contatos, 3 erros de linha', async () => {
    const r = await importar(eq, comInvalidas(250));
    expect(r.status).toBe(202);
    const id = r.corpo.importacao_id;

    const { final, vistos } = await esperarFim(eq, id);
    expect(final).toMatchObject({
      status: 'concluida', total_linhas: 253, linhas_invalidas: 3, total_lotes: 3, lotes_aplicados: 3, // ⌈250 ÷ 100⌉ = 3
    });
    expect(final.concluida_em).not.toBeNull();
    // T-IMP-12: os status só andam para frente (na_fila -> processando -> concluida), nunca voltam.
    const ordem = ['na_fila', 'processando', 'concluida'];
    const posicoes = vistos.map((s) => ordem.indexOf(s));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    expect(vistos).toContain('processando'); // com 2 pausas de 500 ms, dá para ver o meio do caminho

    const { contatos, erros } = await noBanco(eq.tenantId, id);
    expect(contatos).toBe(250);
    expect(erros).toEqual([
      { linha: 252, motivo: 'e-mail vazio' },
      { linha: 253, motivo: 'nome vazio' },
      { linha: 254, motivo: 'e-mail inválido' },
    ]);
  });

  it('T-IMP-02: o tenant vizinho não vê nenhum dos 250', async () => {
    const r = await chamar('GET', '/contatos?busca=importado.dev', { token: outro.token });
    expect(r.corpo.itens).toEqual([]);
    expect((await noBanco(outro.tenantId)).contatos).toBe(0);
  });

  it('T-IMP-19: 100 válidas + 3 inválidas -> concluida com 1 lote (a API não conta as inválidas)', async () => {
    const r = await importar(eq, comInvalidas(100));
    const { final } = await esperarFim(eq, r.corpo.importacao_id);
    expect(final).toMatchObject({ status: 'concluida', total_linhas: 103, linhas_invalidas: 3, total_lotes: 1, lotes_aplicados: 1 });
  });

  it('T-IMP-20: CSV só com linhas inválidas -> concluida com 0 lotes', async () => {
    const r = await importar(eq, `nome,email\n${invalidas.join('\n')}`);
    const { final } = await esperarFim(eq, r.corpo.importacao_id);
    expect(final).toMatchObject({ status: 'concluida', total_linhas: 3, linhas_invalidas: 3, total_lotes: 0, lotes_aplicados: 0 });
  });

  it('T-IMP-03 e T-IMP-04: CSV do Excel (";" e BOM), vírgula dentro da célula, e-mail em maiúsculas e repetido', async () => {
    const csv =
      '﻿Nome;E-mail;Empresa;Observação\r\n' +
      'José da Silva;Jose@Excel.Dev;Silva, Souza & Cia;cliente antigo\r\n' +
      'Maria;MARIA@excel.dev;;\r\n' +
      'José de novo;jose@excel.dev;X;\r\n';
    const r = await importar(eq, csv);
    expect(r.status).toBe(202);
    const { final } = await esperarFim(eq, r.corpo.importacao_id);
    expect(final).toMatchObject({ status: 'concluida', total_linhas: 3, linhas_invalidas: 1, total_lotes: 1 });

    const itens = (await chamar('GET', '/contatos?busca=excel.dev', { token: eq.token })).corpo.itens;
    const porEmail = Object.fromEntries(itens.map((c) => [c.email, c]));
    expect(Object.keys(porEmail).sort()).toEqual(['jose@excel.dev', 'maria@excel.dev']);
    expect(porEmail['jose@excel.dev']).toMatchObject({ nome: 'José da Silva', empresa: 'Silva, Souza & Cia', observacao: 'cliente antigo' });
    expect(porEmail['maria@excel.dev'].empresa).toBeNull();
    expect((await noBanco(eq.tenantId, r.corpo.importacao_id)).erros).toEqual([
      { linha: 4, motivo: 'e-mail repetido (já aparece na linha 2)' },
    ]);
  });

  it('reimportar o mesmo e-mail atualiza em vez de duplicar (upsert por tenant + e-mail)', async () => {
    await esperarFim(eq, (await importar(eq, 'nome,email,telefone\nRe Importado,reimporta@x.dev,51 3333-0000')).corpo.importacao_id);
    await esperarFim(eq, (await importar(eq, 'nome,email,telefone\nRe Importado 2,REIMPORTA@x.dev,')).corpo.importacao_id);
    const itens = (await chamar('GET', '/contatos?busca=reimporta@x.dev', { token: eq.token })).corpo.itens;
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ nome: 'Re Importado 2', telefone: '51 3333-0000' }); // célula vazia não apagou
  });
});

// T-IMP-13: lento (~25 s). Roda só com TESTES_LENTOS=1 (CI e antes de entrega), como o plano de testes pede.
describe.runIf(process.env.TESTES_LENTOS === '1')('T-IMP-13: a pausa de 500 ms existe de verdade', () => {
  it('5.000 linhas (50 lotes) levam pelo menos 49 × 0,5 s = 24,5 s', async () => {
    const eq = await cadastrar({ plano: 'equipe', empresa: 'Pausa real' });
    const r = await importar(eq, csvValido(5000, { prefixo: 'p' }));
    const { final } = await esperarFim(eq, r.corpo.importacao_id, 120_000);
    expect(final).toMatchObject({ status: 'concluida', total_lotes: 50, lotes_aplicados: 50 });
    expect(new Date(final.concluida_em) - new Date(final.criado_em)).toBeGreaterThanOrEqual(24_500);
  }, 150_000);
});

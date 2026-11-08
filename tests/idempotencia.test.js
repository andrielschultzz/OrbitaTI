// Rotas internas da importação (contrato, seção 8), chamadas como o worker chama: token de serviço.
// T-IMP-09 (lote repetido), T-IMP-10 (JWT de usuário), T-IMP-11 (token de serviço errado), T-ISO-09
// (token de A em importação de B) e as regras de inicio/falha (T-IMP-15 a 18).
//
// Não depende do worker: as importações são criadas DIRETO no banco (sem job na fila) e o teste faz o
// papel do worker. Assim cada estado é exatamente o que o teste montou.
//
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assinar,
  cadastrar,
  chamar,
  criarImportacaoNoBanco,
  limparTenants,
  randomUUID,
  tokenServico,
} from './apoio/api.js';

let A;
let B;
beforeAll(async () => {
  A = await cadastrar({ plano: 'equipe', empresa: 'Idempotência A' });
  B = await cadastrar({ plano: 'equipe', empresa: 'Idempotência B' });
});
afterAll(limparTenants);

/** Chama uma rota interna como o worker do tenant `quem`. */
const interno = (quem, id, acao, corpo, token = tokenServico(quem.tenantId)) =>
  chamar('POST', `/interno/importacoes/${id}/${acao}`, { token, corpo });
const importacao = async (quem, id) => (await chamar('GET', `/importacoes/${id}`, { token: quem.token })).corpo;
const contatos = async (quem, busca) =>
  (await chamar('GET', `/contatos?busca=${encodeURIComponent(busca)}`, { token: quem.token })).corpo.itens;

describe('T-IMP-09: o mesmo lote enviado duas vezes', () => {
  let id;
  const lote1 = {
    numero: 1,
    contatos: [
      { nome: 'Ana Idem', email: 'Ana@Idem.dev', telefone: '51 99999-0001', empresa: 'Idem SA' },
      { nome: 'Bruno Idem', email: 'bruno@idem.dev' },
    ],
  };

  beforeAll(async () => {
    id = await criarImportacaoNoBanco(A.tenantId, { status: 'processando', totalLinhas: 3, totalLotes: 2 });
  });

  it('1º envio -> {aplicado:true}; 2º -> {aplicado:false}; nada duplica nem conta duas vezes', async () => {
    const primeiro = await interno(A, id, 'lotes', lote1);
    expect(primeiro.status).toBe(200);
    expect(primeiro.corpo).toEqual({ aplicado: true });
    const depoisDo1 = await contatos(A, '@idem.dev');

    const segundo = await interno(A, id, 'lotes', lote1);
    expect(segundo.status).toBe(200);
    expect(segundo.corpo).toEqual({ aplicado: false });

    expect(await contatos(A, '@idem.dev')).toEqual(depoisDo1); // mesmos contatos, nem atualizado_em mudou
    expect(depoisDo1.map((c) => c.email).sort()).toEqual(['ana@idem.dev', 'bruno@idem.dev']); // minúsculas (regra 8)
    expect(await importacao(A, id)).toMatchObject({ status: 'processando', lotes_aplicados: 1, total_lotes: 2 });
  });

  it('último lote -> concluida; e-mail já existente é atualizado, sem apagar o que a célula vazia não trouxe', async () => {
    const lote2 = { numero: 2, contatos: [{ nome: 'Ana Atualizada', email: 'ana@idem.dev', telefone: null }] };
    expect((await interno(A, id, 'lotes', lote2)).corpo).toEqual({ aplicado: true });

    const ana = (await contatos(A, 'ana@idem.dev'))[0];
    expect(ana.nome).toBe('Ana Atualizada'); // upsert ON CONFLICT (tenant_id, email)
    expect(ana.telefone).toBe('51 99999-0001'); // COALESCE: null no CSV não apaga o telefone
    expect(ana.empresa).toBe('Idem SA');
    expect(await contatos(A, '@idem.dev')).toHaveLength(2); // atualizou, não duplicou

    const imp = await importacao(A, id);
    expect(imp).toMatchObject({ status: 'concluida', lotes_aplicados: 2 });
    expect(imp.concluida_em).not.toBeNull();
    // Reenvio depois de concluída: não aplica e não volta atrás.
    expect((await interno(A, id, 'lotes', lote2)).corpo).toEqual({ aplicado: false });
    expect((await importacao(A, id)).status).toBe('concluida');
  });

  it('e-mail repetido dentro do mesmo lote não dá 500: vale a última ocorrência', async () => {
    const id2 = await criarImportacaoNoBanco(A.tenantId, { status: 'processando', totalLinhas: 2, totalLotes: 1 });
    const r = await interno(A, id2, 'lotes', {
      numero: 1,
      contatos: [
        { nome: 'Primeira', email: 'repetido@idem2.dev' },
        { nome: 'Segunda', email: 'REPETIDO@idem2.dev' },
      ],
    });
    expect(r.corpo).toEqual({ aplicado: true });
    expect((await contatos(A, 'repetido@idem2.dev')).map((c) => c.nome)).toEqual(['Segunda']);
  });

  it('lote com número além do total informado -> 400 VALIDACAO', async () => {
    const id3 = await criarImportacaoNoBanco(A.tenantId, { status: 'processando', totalLinhas: 1, totalLotes: 1 });
    const r = await interno(A, id3, 'lotes', { numero: 2, contatos: [{ nome: 'X', email: 'x@idem3.dev' }] });
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('VALIDACAO');
  });
});

describe('T-IMP-10 e T-IMP-11: só o token de serviço certo entra', () => {
  let id;
  const lote = { numero: 1, contatos: [{ nome: 'Token', email: 'token@idem.dev' }] };
  beforeAll(async () => {
    id = await criarImportacaoNoBanco(A.tenantId, { status: 'processando', totalLinhas: 1, totalLotes: 1 });
  });

  const agora = () => Math.floor(Date.now() / 1000);
  const casos = [
    ['T-IMP-10: JWT de usuário', () => A.token],
    ['T-IMP-11: aud diferente de api-contatos', () => tokenServico(A.tenantId, { aud: 'outra-api' })],
    ['T-IMP-11: iss diferente de importacao', () => tokenServico(A.tenantId, { iss: 'portal' })],
    ['T-IMP-11: exp no passado', () => tokenServico(A.tenantId, { iat: agora() - 120, exp: agora() - 60 })],
    ['T-IMP-11: assinado com JWT_SEGREDO (o de usuário)', () => tokenServico(A.tenantId, {}, process.env.JWT_SEGREDO)],
    ['T-IMP-11: vida maior que 60 s', () => tokenServico(A.tenantId, { exp: agora() + 3600 })],
    ['T-IMP-11: sem exp', () => assinar({ tenant_id: A.tenantId, iss: 'importacao', aud: 'api-contatos' }, process.env.JWT_SERVICO_SEGREDO)],
    ['T-IMP-11: sem token', () => undefined],
  ];

  it.each(casos)('%s -> 401 e nada gravado', async (_nome, gerar) => {
    for (const [acao, corpo] of [['lotes', lote], ['inicio', { total_lotes: 1, linhas_invalidas: 0 }], ['falha', { motivo: 'x' }]]) {
      const r = await chamar('POST', `/interno/importacoes/${id}/${acao}`, { token: gerar(), corpo });
      expect(r.status).toBe(401);
      expect(r.corpo.codigo).toBe('NAO_AUTENTICADO');
    }
    expect(await importacao(A, id)).toMatchObject({ status: 'processando', lotes_aplicados: 0 });
  });

  it('controle: o token de serviço correto passa (prova que os 401 acima vieram do token)', async () => {
    expect((await interno(A, id, 'lotes', lote)).corpo).toEqual({ aplicado: true });
  });
});

describe('T-ISO-09: token de serviço de A em importação de B', () => {
  let idB;
  beforeAll(async () => {
    idB = await criarImportacaoNoBanco(B.tenantId, { status: 'processando', totalLinhas: 1, totalLotes: 1 });
  });

  it('lotes, inicio e falha -> 404; nenhum contato novo em A nem em B; importação de B intacta', async () => {
    const antes = await importacao(B, idB);
    const lote = { numero: 1, contatos: [{ nome: 'Cruzado', email: 'cruzado@iso09.dev' }] };
    for (const [acao, corpo] of [['lotes', lote], ['inicio', { total_lotes: 0, linhas_invalidas: 0 }], ['falha', { motivo: 'x' }]]) {
      const r = await interno(A, idB, acao, corpo);
      expect(r.status).toBe(404);
      expect(r.corpo.codigo).toBe('NAO_ENCONTRADO');
    }
    expect(await contatos(A, 'cruzado@iso09.dev')).toEqual([]);
    expect(await contatos(B, 'cruzado@iso09.dev')).toEqual([]);
    expect(await importacao(B, idB)).toEqual(antes);
  });
});

describe('inicio e falha (contrato, seção 8)', () => {
  it('T-IMP-15: inicio com total_lotes 0 (CSV todo inválido) -> concluida na hora', async () => {
    const id = await criarImportacaoNoBanco(A.tenantId, { status: 'na_fila', totalLinhas: 4, totalLotes: null, linhasInvalidas: null });
    const r = await interno(A, id, 'inicio', { total_lotes: 0, linhas_invalidas: 4 });
    expect(r.corpo).toEqual({ status: 'concluida' });
    const imp = await importacao(A, id);
    expect(imp).toMatchObject({ status: 'concluida', total_lotes: 0, linhas_invalidas: 4, lotes_aplicados: 0 });
    expect(imp.concluida_em).not.toBeNull();
  });

  it('T-IMP-16: inicio repetido (retry) não muda nada; vale o primeiro', async () => {
    const id = await criarImportacaoNoBanco(A.tenantId, { status: 'na_fila', totalLinhas: 103, totalLotes: null, linhasInvalidas: null });
    expect((await interno(A, id, 'inicio', { total_lotes: 1, linhas_invalidas: 3 })).corpo).toEqual({ status: 'processando' });
    expect((await interno(A, id, 'inicio', { total_lotes: 9, linhas_invalidas: 0 })).corpo).toEqual({ status: 'processando' });
    expect(await importacao(A, id)).toMatchObject({ status: 'processando', total_lotes: 1, linhas_invalidas: 3 });
  });

  it('T-IMP-17: falha marca falhou; depois disso lote não é aplicado e inicio não reabre', async () => {
    const id = await criarImportacaoNoBanco(A.tenantId, { status: 'processando', totalLinhas: 1, totalLotes: 1 });
    expect((await interno(A, id, 'falha', { motivo: 'esgotou 3 tentativas' })).corpo).toEqual({ status: 'falhou' });
    const lote = { numero: 1, contatos: [{ nome: 'Atrasado', email: 'atrasado@idem.dev' }] };
    expect((await interno(A, id, 'lotes', lote)).corpo).toEqual({ aplicado: false });
    expect(await contatos(A, 'atrasado@idem.dev')).toEqual([]);
    expect((await interno(A, id, 'inicio', { total_lotes: 1, linhas_invalidas: 0 })).corpo).toEqual({ status: 'falhou' });
    expect((await importacao(A, id)).status).toBe('falhou');
  });

  it('T-IMP-18: falha numa importação concluída não a desfaz', async () => {
    const id = await criarImportacaoNoBanco(A.tenantId, { status: 'concluida', totalLinhas: 1, totalLotes: 1 });
    expect((await interno(A, id, 'falha', { motivo: 'tarde demais' })).corpo).toEqual({ status: 'concluida' });
    expect((await importacao(A, id)).status).toBe('concluida');
  });

  it('id inexistente -> 404 nas três', async () => {
    for (const [acao, corpo] of [['inicio', { total_lotes: 1, linhas_invalidas: 0 }], ['lotes', { numero: 1, contatos: [{ nome: 'X', email: 'x@x.dev' }] }], ['falha', { motivo: 'x' }]]) {
      expect((await interno(A, randomUUID(), acao, corpo)).status).toBe(404);
    }
  });
});

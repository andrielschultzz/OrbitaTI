// Produto (bloco 12): interações, estágio e "Saindo de órbita". T-PROD-01 a 03 do docs/plano-de-testes.md,
// mais as regras do contrato (seções 5 e 6) que não têm número próprio. O isolamento destas rotas
// (T-ISO-16 e 17) está no tests/isolamento.test.js, junto com a tabela de rotas.
//
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cadastrar, chamar, comoDono, limparTenants, payload } from './apoio/api.js';

const DIA = 24 * 60 * 60 * 1000;
const diasAtras = (n) => new Date(Date.now() - n * DIA).toISOString();
const CAMPOS_INTERACAO = ['contato_id', 'criado_em', 'id', 'nota', 'ocorrida_em', 'tipo', 'usuario_id'];

let T; // um tenant por arquivo (plano equipe: folga no rate limit para os vários POSTs)
const criarContato = async (corpo) => {
  const r = await chamar('POST', '/contatos', { token: T.token, corpo });
  expect(r.status).toBe(201);
  return r.corpo;
};
const interagir = (id, corpo) => chamar('POST', `/contatos/${id}/interacoes`, { token: T.token, corpo });
const esfriando = (qs = '') => chamar('GET', `/contatos/esfriando${qs}`, { token: T.token });

/** Fixture: recua o criado_em (a API sempre grava now(); só o dono do banco consegue envelhecer o cadastro). */
const envelhecerCadastro = (id, dias) =>
  comoDono(T.tenantId, (c) =>
    c.query('UPDATE orbita.contatos SET criado_em = now() - make_interval(days => $2) WHERE id = $1', [id, dias]),
  );

beforeAll(async () => {
  T = await cadastrar({ plano: 'equipe', empresa: 'Produto' });
});
afterAll(limparTenants);

describe('estagio', () => {
  it('nasce "lead"; POST e PATCH aceitam os quatro valores', async () => {
    const c = await criarContato({ nome: 'Estágio Padrão' });
    expect(c.estagio).toBe('lead');
    expect((await criarContato({ nome: 'Já Proposta', estagio: 'proposta' })).estagio).toBe('proposta');
    for (const estagio of ['proposta', 'cliente', 'perdido', 'lead']) {
      const r = await chamar('PATCH', `/contatos/${c.id}`, { token: T.token, corpo: { estagio } });
      expect(r.status).toBe(200);
      expect(r.corpo.estagio).toBe(estagio);
    }
  });
});

describe('T-PROD-03: valores fora do domínio -> 400', () => {
  let c;
  beforeAll(async () => {
    c = await criarContato({ nome: 'Domínio' });
  });

  it.each([
    ['PATCH estagio inválido', 'PATCH', '', { estagio: 'ganho' }, 'estagio'],
    ['PATCH estagio null (a coluna é NOT NULL)', 'PATCH', '', { estagio: null }, 'estagio'],
    ['interação com tipo inválido', 'POST', '/interacoes', { tipo: 'telegrama' }, 'tipo'],
    ['interação sem tipo', 'POST', '/interacoes', { nota: 'sem tipo' }, 'tipo'],
    ['nota com 2.001 caracteres', 'POST', '/interacoes', { tipo: 'outro', nota: 'x'.repeat(2001) }, 'nota'],
    ['ocorrida_em que não é data', 'POST', '/interacoes', { tipo: 'outro', ocorrida_em: 'ontem' }, 'ocorrida_em'],
    ['ocorrida_em amanhã', 'POST', '/interacoes', { tipo: 'outro', ocorrida_em: diasAtras(-1) }, 'ocorrida_em'],
  ])('%s', async (_nome, metodo, sufixo, corpo, campo) => {
    const r = await chamar(metodo, `/contatos/${c.id}${sufixo}`, { token: T.token, corpo });
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('VALIDACAO');
    expect(r.corpo.campos.map((x) => x.campo)).toContain(campo);
    // Nada foi gravado: nem interação, nem mudança no contato.
    expect((await chamar('GET', `/contatos/${c.id}/interacoes`, { token: T.token })).corpo.itens).toEqual([]);
    expect((await chamar('GET', `/contatos/${c.id}`, { token: T.token })).corpo).toMatchObject({ estagio: 'lead', ultima_interacao_em: null });
  });

  it('ocorrida_em 2 min no futuro passa (tolerância de 5 min para o relógio do celular)', async () => {
    const outro = await criarContato({ nome: 'Relógio Adiantado' });
    const r = await interagir(outro.id, { tipo: 'whatsapp', ocorrida_em: new Date(Date.now() + 2 * 60 * 1000).toISOString() });
    expect(r.status).toBe(201);
  });
});

describe('T-PROD-01: registrar interação atualiza o contato na mesma transação', () => {
  it('201 {interacao, contato}; ultima_interacao_em = ocorrida_em; o GET devolve o mesmo', async () => {
    const c = await criarContato({ nome: 'Primeira Conversa' });
    const ocorrida = diasAtras(3);
    const r = await interagir(c.id, { tipo: 'ligacao', nota: '  Pediu orçamento até sexta  ', ocorrida_em: ocorrida });
    expect(r.status).toBe(201);
    expect(Object.keys(r.corpo).sort()).toEqual(['contato', 'interacao']);
    expect(Object.keys(r.corpo.interacao).sort()).toEqual(CAMPOS_INTERACAO);
    expect(r.corpo.interacao).toMatchObject({
      contato_id: c.id,
      usuario_id: payload(T.token).sub, // quem registrou vem do token, nunca do corpo
      tipo: 'ligacao',
      nota: 'Pediu orçamento até sexta', // sem espaços nas pontas
      ocorrida_em: ocorrida,
    });
    expect(r.corpo.contato).toMatchObject({ id: c.id, ultima_interacao_em: ocorrida });
    expect(r.corpo.contato).not.toHaveProperty('tenant_id');
    expect((await chamar('GET', `/contatos/${c.id}`, { token: T.token })).corpo).toEqual(r.corpo.contato);
  });

  it('sem ocorrida_em vale "agora" (interação e contato com o mesmo instante)', async () => {
    const c = await criarContato({ nome: 'Agora Mesmo' });
    const antes = Date.now();
    const r = await interagir(c.id, { tipo: 'reuniao' });
    expect(r.status).toBe(201);
    expect(r.corpo.interacao.nota).toBeNull();
    expect(Math.abs(Date.parse(r.corpo.interacao.ocorrida_em) - antes)).toBeLessThan(60_000);
    expect(r.corpo.contato.ultima_interacao_em).toBe(r.corpo.interacao.ocorrida_em);
  });

  it('interação antiga lançada depois NÃO faz o contato voltar no tempo (GREATEST)', async () => {
    const c = await criarContato({ nome: 'Ligação Esquecida' });
    const recente = diasAtras(2);
    expect((await interagir(c.id, { tipo: 'whatsapp', ocorrida_em: recente })).status).toBe(201);
    const antiga = await interagir(c.id, { tipo: 'ligacao', ocorrida_em: diasAtras(40) });
    expect(antiga.status).toBe(201);
    expect(antiga.corpo.contato.ultima_interacao_em).toBe(recente);
  });

  it('GET /contatos/:id/interacoes: da mais recente para a mais antiga', async () => {
    const c = await criarContato({ nome: 'Histórico' });
    for (const [tipo, dias] of [['email', 10], ['ligacao', 1], ['reuniao', 30]]) {
      expect((await interagir(c.id, { tipo, ocorrida_em: diasAtras(dias) })).status).toBe(201);
    }
    const r = await chamar('GET', `/contatos/${c.id}/interacoes`, { token: T.token });
    expect(r.status).toBe(200);
    expect(r.corpo.itens.map((i) => i.tipo)).toEqual(['ligacao', 'email', 'reuniao']);
  });
});

describe('T-PROD-02: regra do "esfriando" (referência = COALESCE(ultima_interacao_em, criado_em))', () => {
  const ids = {};
  beforeAll(async () => {
    // Um tenant só para este bloco: a lista não pode ter frios de outros describe.
    T = await cadastrar({ plano: 'equipe', empresa: 'Esfriando' });
    const com = async (nome, dias) => {
      const c = await criarContato({ nome });
      expect((await interagir(c.id, { tipo: 'email', ocorrida_em: diasAtras(dias) })).status).toBe(201);
      ids[nome] = c.id;
    };
    await com('Interação há 100 dias', 100);
    await com('Interação há 10 dias', 10);
    await com('Interação há 400 dias', 400);
    const nunca = await criarContato({ nome: 'Nunca contatado, cadastro há 120 dias' });
    await envelhecerCadastro(nunca.id, 120);
    ids.nunca = nunca.id;
    ids.recem = (await criarContato({ nome: 'Recém-criado, nunca contatado' })).id;
    const perdido = await criarContato({ nome: 'Perdido e frio', estagio: 'perdido' });
    expect((await interagir(perdido.id, { tipo: 'email', ocorrida_em: diasAtras(200) })).status).toBe(201);
    ids.perdido = perdido.id;
  });

  it('dias=90: os frios do mais frio ao mais recente; nem o de 10 dias, nem o recém-criado, nem o perdido', async () => {
    const r = await esfriando('?dias=90');
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ dias: 90, limite: 100 });
    expect(r.corpo.itens.map((c) => c.nome)).toEqual([
      'Interação há 400 dias',
      'Nunca contatado, cadastro há 120 dias',
      'Interação há 100 dias',
    ]);
    const [q400, nunca, q100] = r.corpo.itens;
    expect(q400).toMatchObject({ dias_sem_interacao: 400, nunca_contatado: false });
    expect(nunca).toMatchObject({ dias_sem_interacao: 120, nunca_contatado: true, ultima_interacao_em: null });
    expect(q100).toMatchObject({ dias_sem_interacao: 100, nunca_contatado: false, estagio: 'lead' });
    expect(q100).not.toHaveProperty('tenant_id');
  });

  it('padrão é 90 dias e limite 100', async () => {
    const r = await esfriando();
    expect(r.corpo).toMatchObject({ dias: 90, limite: 100 });
    expect(r.corpo.itens).toHaveLength(3);
  });

  it('respeita os dias: dias=150 tira o de 100 e o de 120; dias=5 inclui o de 10', async () => {
    expect((await esfriando('?dias=150')).corpo.itens.map((c) => c.nome)).toEqual(['Interação há 400 dias']);
    const cinco = (await esfriando('?dias=5')).corpo.itens.map((c) => c.id);
    expect(cinco).toContain(ids['Interação há 10 dias']);
    expect(cinco).not.toContain(ids.recem); // recém-criado: referência = criado_em = agora
    expect(cinco).not.toContain(ids.perdido);
  });

  it('limite corta a lista mantendo a ordem (o Portal pede limite=5)', async () => {
    const r = await esfriando('?limite=2');
    expect(r.corpo.limite).toBe(2);
    expect(r.corpo.itens.map((c) => c.nome)).toEqual(['Interação há 400 dias', 'Nunca contatado, cadastro há 120 dias']);
  });

  it('interação nova tira o contato da lista', async () => {
    const id = ids['Interação há 100 dias'];
    expect((await interagir(id, { tipo: 'whatsapp' })).status).toBe(201);
    expect((await esfriando()).corpo.itens.map((c) => c.id)).not.toContain(id);
  });

  it.each([
    ['dias=0', '?dias=0'],
    ['dias=366', '?dias=366'],
    ['limite=0', '?limite=0'],
    ['limite=101', '?limite=101'],
    ['dias=abc', '?dias=abc'],
  ])('%s -> 400 VALIDACAO', async (_nome, qs) => {
    const r = await esfriando(qs);
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('VALIDACAO');
  });
});

describe('excluir contato com interações (ON DELETE CASCADE)', () => {
  it('DELETE -> 204, o contato some e as interações vão junto', async () => {
    const c = await criarContato({ nome: 'Com Histórico' });
    for (const tipo of ['ligacao', 'email']) expect((await interagir(c.id, { tipo })).status).toBe(201);
    const r = await chamar('DELETE', `/contatos/${c.id}`, { token: T.token });
    expect(r.status).toBe(204);
    expect((await chamar('GET', `/contatos/${c.id}/interacoes`, { token: T.token })).status).toBe(404);
    const restantes = await comoDono(T.tenantId, (db) =>
      db.query('SELECT count(*)::int AS n FROM orbita.interacoes WHERE contato_id = $1', [c.id]),
    );
    expect(restantes.rows[0].n).toBe(0);
  });
});

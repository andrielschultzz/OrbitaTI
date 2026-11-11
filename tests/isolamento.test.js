// Isolamento pela API (CQ-02): T-ISO-01 a 07, 10, 11, 15 a 17 e 19 do docs/plano-de-testes.md.
// O T-ISO-13 (nenhuma rota aceita tenant_id) está em services/api-contatos/test/rotas-sem-tenant.test.js.
//
// A ideia central: o tenant A tenta mexer, pelo id direto, em um contato do tenant B. A resposta tem de
// ser 404, idêntica à de um id que não existe, e o contato de B tem de continuar intacto.
//
// Pré-requisito: docker compose up -d --build --wait
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../services/api-contatos/src/app.js';
import {
  assinar,
  cadastrar,
  chamar,
  comoDono,
  criarImportacaoNoBanco,
  limparTenants,
  payload,
  randomUUID,
  tokenServico,
} from './apoio/api.js';

// Base fictícia dos links de e-mail (PORTAL_URL). Só precisa ser uma URL válida.
const PORTAL_URL_TESTE = 'http://portal.teste';

// ---------------------------------------------------------------------------------------------------
// A TABELA. Toda rota que lê ou grava dado de tenant entra aqui. Rota nova com :id = uma linha nova em
// ROTAS_COM_ID, e ela passa a ser atacada pelos testes T-ISO-01 a 03, 05 e 19 sem escrever mais nada.
// O T-ISO-15 (no fim do arquivo) falha se existir rota registrada na API que não esteja nesta tabela.
// ---------------------------------------------------------------------------------------------------
//   recurso  de quem é o id atacado: 'contato' (padrão) ou 'importacao'
//   token    'usuario' (padrão) ou 'servico' (rotas /interno: token de serviço com tenant_id = A, regra 7)
const LOTE_INVASOR = { numero: 1, contatos: [{ nome: 'Invasor', email: 'invasor-lote@a.com' }] };
const ROTAS_COM_ID = [
  { metodo: 'GET', caminho: '/contatos/:id', caso: 'T-ISO-01' },
  { metodo: 'PATCH', caminho: '/contatos/:id', caso: 'T-ISO-02', corpo: { nome: 'Invasor', email: 'invasor@a.com' } },
  { metodo: 'DELETE', caminho: '/contatos/:id', caso: 'T-ISO-03' },
  { metodo: 'GET', caminho: '/contatos/:id/interacoes', caso: 'T-ISO-16' },
  // ocorrida_em no presente: se o isolamento falhasse, o ultima_interacao_em de B mudaria e o
  // dadosDeBIntactos pegaria (além da interação a mais na lista de B).
  { metodo: 'POST', caminho: '/contatos/:id/interacoes', caso: 'T-ISO-16', corpo: { tipo: 'ligacao', nota: 'Invasor' } },
  { metodo: 'GET', caminho: '/importacoes/:id', caso: 'T-ISO-08', recurso: 'importacao' },
  {
    metodo: 'POST', caminho: '/interno/importacoes/:id/inicio', caso: 'T-ISO-09', recurso: 'importacao', token: 'servico',
    corpo: { total_lotes: 0, linhas_invalidas: 0 }, // 0 marcaria a importação de B como concluída
  },
  { metodo: 'POST', caminho: '/interno/importacoes/:id/lotes', caso: 'T-ISO-09', recurso: 'importacao', token: 'servico', corpo: LOTE_INVASOR },
  {
    metodo: 'POST', caminho: '/interno/importacoes/:id/falha', caso: 'T-ISO-09', recurso: 'importacao', token: 'servico',
    corpo: { motivo: 'ataque' },
  },
];

// Rotas de tenant SEM :id: não dá para "pedir o recurso do outro" pelo caminho; cada uma tem teste próprio.
const ROTAS_SEM_ID = [
  { metodo: 'GET', caminho: '/contatos', caso: 'T-ISO-04 e T-ISO-07' },
  { metodo: 'POST', caminho: '/contatos', caso: 'T-ISO-06' },
  { metodo: 'GET', caminho: '/contatos/esfriando', caso: 'T-ISO-17' },
  { metodo: 'POST', caminho: '/importacoes', caso: 'T-IMP-02' }, // tests/importacao.test.js
  { metodo: 'GET', caminho: '/conta/exportacao', caso: 'T-ISO-18' }, // tests/lgpd.test.js (bloco 14)
  { metodo: 'POST', caminho: '/conta/cancelamento', caso: 'T-LGPD-02' }, // tests/lgpd.test.js: só o próprio tenant
];

// Rotas públicas (config.publica: sem token, logo sem tenant). Lista FIXA de propósito: marcar uma rota
// como pública tira ela da autenticação E da tabela acima. Sem esta lista, esse seria um jeito de escapar
// das duas coisas com uma linha só. GET /auth/confirmar (bloco 10) e GET /conta/exportacao/arquivo
// (bloco 14) entram com rate limit por IP; o tenant da segunda vem do token ASSINADO do link (T-LGPD-04).
// GET /planos (bloco 4) não tem dado de tenant: a resposta é a mesma para qualquer pessoa.
const ROTAS_PUBLICAS = [
  'GET /saude', 'GET /planos', 'POST /auth/cadastro', 'POST /auth/login', 'GET /auth/confirmar', 'GET /conta/exportacao/arquivo',
];

const chave = (r) => `${r.metodo} ${r.caminho}`;
const comId = (rota, id) => rota.caminho.replace(':id', id);

let A; // tenant A: o "atacante"
let B; // tenant B: o dono do contato e da importação
let contatoB; // contato de B, como B o vê
let importacaoB; // importação de B, como B a vê

beforeAll(async () => {
  A = await cadastrar({ empresa: 'Isolamento A' });
  B = await cadastrar({ empresa: 'Isolamento B' });
  const r = await chamar('POST', '/contatos', {
    token: B.token,
    corpo: { nome: 'Cliente Secreto de B', email: 'secreto@empresa-b.com.br', empresa: 'Empresa B', observacao: 'só B vê' },
  });
  expect(r.status).toBe(201);
  contatoB = r.corpo;

  // Importação de B criada direto no banco (sem job): o worker não a altera durante o teste, então
  // "intacta" quer dizer intacta. Status processando com 1 lote esperado: se o isolamento falhasse,
  // o lote do invasor seria aplicado e a concluiria. É o pior caso, de propósito.
  const id = await criarImportacaoNoBanco(B.tenantId, { status: 'processando', totalLinhas: 1, totalLotes: 1 });
  importacaoB = (await chamar('GET', `/importacoes/${id}`, { token: B.token })).corpo;
  expect(importacaoB.status).toBe('processando');
});
afterAll(limparTenants);

const idDeB = (rota) => (rota.recurso === 'importacao' ? importacaoB.id : contatoB.id);
const tokenDeA = (rota) => (rota.token === 'servico' ? tokenServico(A.tenantId) : A.token);

/** B relê o próprio contato e a própria importação: têm de estar exatamente como foram criados. */
async function dadosDeBIntactos() {
  const c = await chamar('GET', `/contatos/${contatoB.id}`, { token: B.token });
  expect(c.status).toBe(200);
  expect(c.corpo).toEqual(contatoB);
  // T-ISO-16: nenhuma interação foi plantada no contato de B.
  const hist = await chamar('GET', `/contatos/${contatoB.id}/interacoes`, { token: B.token });
  expect(hist.status).toBe(200);
  expect(hist.corpo.itens).toEqual([]);
  const i = await chamar('GET', `/importacoes/${importacaoB.id}`, { token: B.token });
  expect(i.status).toBe(200);
  expect(i.corpo).toEqual(importacaoB);
  // O lote do invasor não entrou em lugar nenhum: nem em B (alvo) nem em A (dono do token).
  for (const quem of [A, B]) {
    const busca = await chamar('GET', '/contatos?busca=invasor-lote', { token: quem.token });
    expect(busca.corpo.itens).toEqual([]);
  }
}

describe('T-ISO-01 a 03, 05, 08 e 09: A ataca o contato e a importação de B pelo id', () => {
  it.each(ROTAS_COM_ID)('$caso: $metodo $caminho -> 404, igual a um id inexistente', async (rota) => {
    const token = tokenDeA(rota);
    const cruzado = await chamar(rota.metodo, comId(rota, idDeB(rota)), { token, corpo: rota.corpo });
    const inexistente = await chamar(rota.metodo, comId(rota, randomUUID()), { token, corpo: rota.corpo });

    expect(cruzado.status).toBe(404);
    expect(cruzado.corpo.codigo).toBe('NAO_ENCONTRADO');
    // T-ISO-05: mesmo status e mesmo corpo. Se fossem diferentes, A descobriria que o id existe em outro tenant.
    expect(cruzado.status).toBe(inexistente.status);
    expect(cruzado.corpo).toEqual(inexistente.corpo);
    // Nenhum dado de B no corpo.
    const texto = JSON.stringify(cruzado.corpo);
    for (const valor of [contatoB.nome, contatoB.email, contatoB.empresa, importacaoB.id]) expect(texto).not.toContain(valor);

    await dadosDeBIntactos(); // PATCH não alterou, DELETE não apagou, inicio/lotes/falha não mexeram
  });
});

describe('T-ISO-04 e T-ISO-07: listagem e busca não misturam tenants', () => {
  beforeAll(async () => {
    // A tem um contato de nome parecido: a busca por "Secreto" acha o de A, nunca o de B.
    const r = await chamar('POST', '/contatos', { token: A.token, corpo: { nome: 'Cliente Secreto de A' } });
    expect(r.status).toBe(201);
  });

  const consultas = [
    ['T-ISO-04: GET /contatos', '/contatos'],
    ['T-ISO-04: GET /contatos?busca=<termo comum>', '/contatos?busca=Secreto'],
    ['T-ISO-04: busca pelo e-mail de B', `/contatos?busca=${encodeURIComponent('secreto@empresa-b')}`],
    ['T-ISO-07: GET /contatos?tenant_id=<B>', '/contatos?tenant_id=TENANT_B'],
  ];
  it.each(consultas)('%s -> nenhum contato de B', async (_nome, caminho) => {
    const r = await chamar('GET', caminho.replace('TENANT_B', B.tenantId), { token: A.token });
    expect(r.status).toBe(200);
    expect(r.corpo.itens.map((c) => c.id)).not.toContain(contatoB.id);
    expect(JSON.stringify(r.corpo)).not.toContain('empresa-b');
  });

  it('controle: a busca de A acha o contato de A (prova que a busca funciona, não que volta vazia)', async () => {
    const r = await chamar('GET', '/contatos?busca=Secreto', { token: A.token });
    expect(r.corpo.itens.map((c) => c.nome)).toEqual(['Cliente Secreto de A']);
  });
});

describe('T-ISO-17: "esfriando" não mostra contatos de outro tenant', () => {
  const DIA = 24 * 60 * 60 * 1000;
  const frios = {}; // nome -> id, dos dois tenants

  /** Contato com uma interação de `dias` atrás (ou, com dias = null, nunca contatado e cadastrado há 200 dias). */
  async function contatoFrio(tenant, nome, dias) {
    const r = await chamar('POST', '/contatos', { token: tenant.token, corpo: { nome } });
    expect(r.status).toBe(201);
    if (dias === null) {
      // A API grava criado_em = now(); só o dono do banco consegue "envelhecer" o cadastro (fixture).
      await comoDono(tenant.tenantId, (c) =>
        c.query("UPDATE orbita.contatos SET criado_em = now() - interval '200 days' WHERE id = $1", [r.corpo.id]),
      );
    } else {
      const i = await chamar('POST', `/contatos/${r.corpo.id}/interacoes`, {
        token: tenant.token,
        corpo: { tipo: 'email', ocorrida_em: new Date(Date.now() - dias * DIA).toISOString() },
      });
      expect(i.status).toBe(201);
    }
    frios[nome] = r.corpo.id;
  }

  beforeAll(async () => {
    await contatoFrio(B, 'Frio de B com interação', 300);
    await contatoFrio(B, 'Frio de B nunca contatado', null);
    await contatoFrio(A, 'Frio de A', 150);
  });

  it.each([
    ['padrão (90 dias)', '/contatos/esfriando'],
    ['dias=1 e limite=100', '/contatos/esfriando?dias=1&limite=100'],
    ['com ?tenant_id=<B>', '/contatos/esfriando?tenant_id=TENANT_B'],
  ])('%s -> só contatos de A', async (_nome, caminho) => {
    const r = await chamar('GET', caminho.replace('TENANT_B', B.tenantId), { token: A.token });
    expect(r.status).toBe(200);
    const ids = r.corpo.itens.map((c) => c.id);
    expect(ids).toContain(frios['Frio de A']); // controle: a lista funciona, não volta vazia
    expect(ids).not.toContain(frios['Frio de B com interação']);
    expect(ids).not.toContain(frios['Frio de B nunca contatado']);
    expect(JSON.stringify(r.corpo)).not.toContain('de B');
  });

  it('controle: B vê os dois frios dele (prova que o filtro acima não é só "ninguém é frio")', async () => {
    const r = await chamar('GET', '/contatos/esfriando', { token: B.token });
    expect(r.corpo.itens.map((c) => c.nome)).toEqual(['Frio de B com interação', 'Frio de B nunca contatado']);
  });
});

describe('T-ISO-06: tenant_id no corpo é ignorado', () => {
  it('A cria contato mandando tenant_id de B -> o contato fica em A e B não o vê', async () => {
    const r = await chamar('POST', '/contatos', {
      token: A.token,
      corpo: { nome: 'Tentativa de Plantar em B', tenant_id: B.tenantId },
    });
    expect(r.status).toBe(201);
    expect(r.corpo).not.toHaveProperty('tenant_id');
    expect((await chamar('GET', `/contatos/${r.corpo.id}`, { token: A.token })).status).toBe(200);
    expect((await chamar('GET', `/contatos/${r.corpo.id}`, { token: B.token })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------
// Tokens (ADR-002). assinar() está em apoio/api.js: HMAC-SHA256 de "cabeçalho.payload" com o segredo.
// ---------------------------------------------------------------------------------------------------
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

describe('T-ISO-12: token de serviço não serve em rota de usuário (dois segredos, regra 7)', () => {
  it.each([
    ['GET', '/contatos'],
    ['GET', `/importacoes/${randomUUID()}`],
    ['POST', '/contatos'],
  ])('%s %s com token de serviço válido -> 401', async (metodo, caminho) => {
    const corpo = metodo === 'POST' ? { nome: 'Pelo worker' } : undefined;
    const r = await chamar(metodo, caminho, { token: tokenServico(A.tenantId), corpo });
    expect(r.status).toBe(401);
    expect(r.corpo.codigo).toBe('NAO_AUTENTICADO');
  });
});

describe('T-ISO-10 e T-ISO-11: token adulterado ou expirado', () => {
  it('T-ISO-10: trocar o tenant_id do payload para o de B, sem reassinar -> 401', async () => {
    const [cabecalho, , assinatura] = A.token.split('.');
    const adulterado = `${cabecalho}.${b64({ ...payload(A.token), tenant_id: B.tenantId })}.${assinatura}`;
    for (const caminho of ['/contatos', `/contatos/${contatoB.id}`]) {
      const r = await chamar('GET', caminho, { token: adulterado });
      expect(r.status).toBe(401);
      expect(r.corpo.codigo).toBe('NAO_AUTENTICADO');
    }
  });

  it('T-ISO-11: token assinado com o segredo certo, mas com exp no passado -> 401', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const expirado = assinar({ ...payload(A.token), iat: agora - 3600, exp: agora - 60 }, process.env.JWT_SEGREDO);
    const r = await chamar('GET', '/contatos', { token: expirado });
    expect(r.status).toBe(401);
    expect(r.corpo.codigo).toBe('NAO_AUTENTICADO');

    // Controle: o mesmo token, com exp no futuro, passa. Prova que o 401 acima veio do exp, não da assinatura.
    const valido = assinar({ ...payload(A.token), iat: agora, exp: agora + 60 }, process.env.JWT_SEGREDO);
    expect((await chamar('GET', '/contatos', { token: valido })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------
// T-ISO-15 e T-ISO-19 sobem a API dentro deste processo (buildApp + inject): o T-ISO-15 precisa da lista
// de rotas registradas e o T-ISO-19 precisa ler o log. Mesmo banco e mesmo segredo do compose.
// ---------------------------------------------------------------------------------------------------
describe('API no próprio processo', () => {
  const logs = [];
  const rotas = [];
  let app;
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.PGHOST_TESTES ?? '127.0.0.1',
      port: Number(process.env.PGPORT_TESTES ?? 5432),
      database: 'orbitati',
      user: 'api_contatos',
      password: process.env.DB_SENHA_API,
      max: 2,
    });
    app = buildApp({
      portalUrl: PORTAL_URL_TESTE,
      pool,
      // O Redis do compose não tem porta publicada, e nenhuma rota da tabela enfileira: fila simulada.
      fila: { verificar: async () => true, enfileirar: async () => {}, enfileirarEmail: async () => {} },
      limiteEmMemoria: true, // o Redis do compose não tem porta publicada
      // O log em JSON vai para esta lista em vez do terminal: é o que o T-ISO-19 inspeciona.
      logger: { level: 'info', stream: { write: (linha) => logs.push(JSON.parse(linha)) } },
    });
    app.addHook('onRoute', (rota) => rotas.push(rota));
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  describe('T-ISO-15: toda rota de tenant está na tabela, e as públicas são só as previstas', () => {
    const registradas = () =>
      rotas.flatMap((r) => [r.method].flat().filter((m) => m !== 'HEAD').map((m) => ({ metodo: m, caminho: r.url, publica: !!r.config?.publica })));

    it('as rotas públicas são exatamente as da lista fixa', () => {
      const publicas = registradas().filter((r) => r.publica).map(chave).sort();
      expect(publicas).toEqual([...ROTAS_PUBLICAS].sort());
    });

    it('toda rota não pública está em ROTAS_COM_ID ou ROTAS_SEM_ID (e a tabela não tem rota fantasma)', () => {
      const naoPublicas = registradas().filter((r) => !r.publica).map(chave).sort();
      const tabela = [...ROTAS_COM_ID, ...ROTAS_SEM_ID].map(chave).sort();
      expect(naoPublicas).toEqual(tabela);
    });
  });

  describe('T-ISO-19: todo 404 em rota com :id gera o evento recurso_nao_encontrado (decisão 6)', () => {
    const eventos = () => logs.filter((l) => l.evento === 'recurso_nao_encontrado');

    it.each(ROTAS_COM_ID)('$metodo $caminho no recurso de B -> log com tenant_id de A, rota e id', async (rota) => {
      const antes = eventos().length;
      const r = await app.inject({
        method: rota.metodo,
        url: comId(rota, idDeB(rota)),
        headers: { authorization: `Bearer ${tokenDeA(rota)}` },
        payload: rota.corpo,
      });
      expect(r.statusCode).toBe(404);
      const novos = eventos().slice(antes);
      expect(novos).toHaveLength(1);
      expect(novos[0]).toMatchObject({
        tenant_id: A.tenantId, // quem tentou (B não aparece: com RLS, a API nem sabe de quem é o id)
        metodo: rota.metodo,
        rota: rota.caminho,
        id: idDeB(rota),
      });
    });

    it(':id que não é UUID também gera o evento (404 pela validação, antes do banco)', async () => {
      const antes = eventos().length;
      const r = await app.inject({ method: 'GET', url: '/contatos/nao-e-uuid', headers: { authorization: `Bearer ${A.token}` } });
      expect(r.statusCode).toBe(404);
      expect(eventos().slice(antes)).toMatchObject([{ tenant_id: A.tenantId, rota: '/contatos/:id', id: 'nao-e-uuid' }]);
    });

    it('rota inexistente não gera o evento (não há recurso para auditar)', async () => {
      const antes = eventos().length;
      const r = await app.inject({ method: 'GET', url: '/nao-existe/123', headers: { authorization: `Bearer ${A.token}` } });
      expect(r.statusCode).toBe(404);
      expect(eventos().length).toBe(antes);
    });
  });
});

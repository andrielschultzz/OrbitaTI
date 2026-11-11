// LGPD (bloco 14): exportação, cancelamento, link de 30 dias e exclusão.
//   T-LGPD-01  exportação só para admin e sem senha_hash (consultor e visualizador: 403)
//   T-ISO-18   a exportação de A não contém nada de B
//   T-LGPD-02  tenant cancelado não entra (login 401, mesmo corpo de senha errada)
//   T-LGPD-04  link de exportação: baixa o arquivo; não serve como sessão, e sessão não serve como link
//   T-LGPD-05  pedir o link de novo (cancelar de novo) gera um e-mail novo; fila fora -> 503 e nada muda
//   T-LGPD-03  exclusão: só quem foi cancelado há mais de 30 dias, nos dois schemas
//
// A parte "API no próprio processo" (fim do arquivo) sobe a API com buildApp + inject, como o
// isolamento.test.js: precisa de fila simulada (503, jobIds) e do log em memória (token fora do log).
// Pré-requisito: docker compose up -d --build --wait
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../services/api-contatos/src/app.js';
import { excluirTenantsVencidos } from '../services/api-contatos/src/exclusao.js';
import { FilaIndisponivel } from '../services/api-contatos/src/fila.js';
import { apagarDadosDoTenant } from '../services/importacao/src/db.js';
import { SENHA, assinar, cadastrar, chamar, comoDono, conectar, criarImportacaoNoBanco, limparTenants, payload, randomUUID } from './apoio/api.js';
import { apagar, buscar, lerMensagem } from './apoio/mailpit.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const ASSUNTO_EXPORTACAO = 'Sua conta no OrbitaTI foi cancelada: baixe seus dados';

// Cada download pelo link sai de um IP próprio (198.51.100.N, faixa de documentação da RFC 5737): o limite
// é 10/min por IP, e duas execuções seguidas da suíte passariam disso num IP só.
let downloads = 0;
const baixarPeloLink = (token) =>
  chamar('GET', `/conta/exportacao/arquivo?token=${encodeURIComponent(token)}`, {
    headers: { 'x-forwarded-for': `198.51.100.${1 + (downloads++ % 250)}` },
  });

/** Token de outro papel no MESMO tenant (ainda não existe convite: a API confia no token assinado). */
const comPapel = (conta, papel) => assinar({ ...payload(conta.token), papel }, process.env.JWT_SEGREDO);

/** Espera `quantos` e-mails de exportação para `email` e devolve os tokens dos links (do mais novo ao mais antigo). */
async function tokensDosEmails(email, quantos, limiteMs = 15_000) {
  const inicio = Date.now();
  for (;;) {
    const mensagens = (await buscar(email)).filter((m) => m.Subject === ASSUNTO_EXPORTACAO);
    if (mensagens.length >= quantos) {
      const textos = await Promise.all(mensagens.map(async (m) => (await lerMensagem(m.ID)).Text));
      return textos.map((t) => new URL(t.match(/https?:\/\/\S+\/api\/conta\/exportacao\/arquivo\?token=\S+/)[0]));
    }
    if (Date.now() - inicio > limiteMs) throw new Error(`esperava ${quantos} e-mail(s) de exportação para ${email}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

let A; // admin do tenant A (exporta)
let B; // tenant B (não pode aparecer na exportação de A)
let C; // tenant C (é cancelado)
const segredoB = {};

beforeAll(async () => {
  A = await cadastrar({ empresa: 'LGPD A' });
  B = await cadastrar({ empresa: 'LGPD B Segredo' });
  C = await cadastrar({ empresa: 'LGPD C' });

  const contatoA = await chamar('POST', '/contatos', { token: A.token, corpo: { nome: 'Cliente de A', email: `cli-a-${randomUUID()}@a.dev` } });
  expect(contatoA.status).toBe(201);
  await chamar('POST', `/contatos/${contatoA.corpo.id}/interacoes`, { token: A.token, corpo: { tipo: 'ligacao', nota: 'nota de A' } });

  const contatoB = await chamar('POST', '/contatos', {
    token: B.token,
    corpo: { nome: `Cliente Secreto ${randomUUID()}`, email: `secreto-${randomUUID()}@b.dev`, observacao: 'só B vê' },
  });
  expect(contatoB.status).toBe(201);
  const interacaoB = await chamar('POST', `/contatos/${contatoB.corpo.id}/interacoes`, {
    token: B.token,
    corpo: { tipo: 'reuniao', nota: `nota secreta ${randomUUID()}` },
  });
  expect(interacaoB.status).toBe(201);
  Object.assign(segredoB, {
    tenant: B.tenantId,
    usuario: B.email,
    usuarioId: payload(B.token).sub,
    contatoId: contatoB.corpo.id,
    contatoNome: contatoB.corpo.nome,
    contatoEmail: contatoB.corpo.email,
    interacaoId: interacaoB.corpo.interacao.id,
    interacaoNota: interacaoB.corpo.interacao.nota,
    importacaoId: await criarImportacaoNoBanco(B.tenantId, { status: 'concluida' }),
  });
});
afterAll(async () => {
  for (const conta of [A, B, C]) if (conta) await apagar(conta.email);
  await limparTenants();
});

describe('T-LGPD-01: exportação só para admin, sem senha', () => {
  it('admin -> 200, download JSON com as cinco listas e sem senha_hash', async () => {
    const r = await chamar('GET', '/conta/exportacao', { token: A.token });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="orbitati-exportacao-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(Object.keys(r.corpo).sort()).toEqual(['contatos', 'importacoes', 'interacoes', 'tenant', 'usuarios']);
    expect(r.corpo.tenant).toMatchObject({ id: A.tenantId, nome: 'LGPD A', cancelado_em: null });
    expect(r.corpo.usuarios).toHaveLength(1);
    expect(Object.keys(r.corpo.usuarios[0]).sort()).toEqual(['criado_em', 'email', 'email_confirmado_em', 'id', 'nome', 'papel']);
    expect(JSON.stringify(r.corpo)).not.toMatch(/senha|argon2/i);
    expect(r.corpo.contatos).toHaveLength(1);
    expect(r.corpo.interacoes).toHaveLength(1);
  });

  it.each(['consultor', 'visualizador'])('%s -> 403 SEM_PERMISSAO na exportação e no cancelamento (e nada é cancelado)', async (papel) => {
    const token = comPapel(A, papel);
    for (const [metodo, caminho] of [['GET', '/conta/exportacao'], ['POST', '/conta/cancelamento']]) {
      const r = await chamar(metodo, caminho, { token });
      expect(r.status).toBe(403);
      expect(r.corpo.codigo).toBe('SEM_PERMISSAO');
    }
    const t = await comoDono(A.tenantId, async (c) => (await c.query('SELECT cancelado_em FROM orbita.tenants')).rows[0]);
    expect(t.cancelado_em).toBeNull();
  });

  it('sem token -> 401', async () => {
    expect((await chamar('GET', '/conta/exportacao')).status).toBe(401);
    expect((await chamar('POST', '/conta/cancelamento')).status).toBe(401);
  });
});

describe('T-ISO-18: a exportação de A não contém nada de B', () => {
  it('nenhum id, e-mail, nome ou nota de B aparece no JSON de A', async () => {
    const r = await chamar('GET', '/conta/exportacao', { token: A.token });
    expect(r.status).toBe(200);
    const texto = JSON.stringify(r.corpo);
    for (const [campo, valor] of Object.entries(segredoB)) expect(texto, `vazou ${campo} de B`).not.toContain(valor);
    expect(texto).not.toContain('LGPD B Segredo');
    // Controle: a mesma busca acha os dados de B na exportação de B (o teste sabe procurar).
    const deB = JSON.stringify((await chamar('GET', '/conta/exportacao', { token: B.token })).corpo);
    for (const valor of Object.values(segredoB)) expect(deB).toContain(valor);
  });
});

describe('cancelamento (C)', () => {
  let cancelamento;
  let links;

  beforeAll(async () => {
    const r = await chamar('POST', '/conta/cancelamento', { token: C.token });
    expect(r.status).toBe(200);
    cancelamento = r.corpo;
    links = await tokensDosEmails(C.email, 1);
  });

  it('T-LGPD-02: responde as duas datas, com 30 dias entre elas', () => {
    const cancelado = new Date(cancelamento.cancelado_em).getTime();
    expect(Math.abs(cancelado - Date.now())).toBeLessThan(60_000);
    expect(new Date(cancelamento.exportacao_disponivel_ate).getTime() - cancelado).toBe(30 * DIA_MS);
  });

  it('T-LGPD-02: depois de cancelar, o login responde 401 com o mesmo corpo da senha errada', async () => {
    const cancelado = await chamar('POST', '/auth/login', { corpo: { email: C.email, senha: SENHA } });
    const senhaErrada = await chamar('POST', '/auth/login', { corpo: { email: A.email, senha: 'Errada@2026' } });
    expect(cancelado.status).toBe(401);
    expect(cancelado.corpo).toEqual(senhaErrada.corpo);
  });

  it('T-LGPD-04: o link do e-mail aponta para PORTAL_URL/api e vence junto com o prazo (cancelado_em + 30 dias)', () => {
    const [link] = links;
    expect(`${link.origin}${link.pathname}`).toBe(`${process.env.PORTAL_URL}/api/conta/exportacao/arquivo`);
    const claims = payload(link.searchParams.get('token'));
    expect(claims).toMatchObject({ tenant_id: C.tenantId, finalidade: 'exportar-conta' });
    expect(Math.abs(claims.exp * 1000 - new Date(cancelamento.exportacao_disponivel_ate).getTime())).toBeLessThan(5_000);
  });

  it('T-LGPD-04: o link baixa a exportação de C (direto na API e pelo Portal)', async () => {
    const token = links[0].searchParams.get('token');
    const r = await baixarPeloLink(token);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="orbitati-exportacao-/);
    expect(r.corpo.tenant).toMatchObject({ id: C.tenantId, cancelado_em: cancelamento.cancelado_em });
    // Pelo nginx do Portal: é o endereço que vai no e-mail.
    const peloPortal = await fetch(links[0], { headers: { 'x-forwarded-for': '198.51.100.251' } });
    expect(peloPortal.status).toBe(200);
    expect((await peloPortal.json()).tenant.id).toBe(C.tenantId);
  });

  it('T-LGPD-04: o token do link não abre sessão (401), e o token de sessão não serve como link (400)', async () => {
    const token = links[0].searchParams.get('token');
    expect((await chamar('GET', '/contatos', { token })).status).toBe(401);
    expect((await chamar('GET', '/conta/exportacao', { token })).status).toBe(401);
    const sessao = await baixarPeloLink(A.token);
    expect(sessao.status).toBe(400);
    expect(sessao.corpo.codigo).toBe('LINK_INVALIDO');
  });

  it.each([
    ['ausente', ''],
    ['adulterado', () => `${links[0].searchParams.get('token').slice(0, -2)}xx`],
    ['de confirmação de e-mail', () => assinar({ sub: payload(C.token).sub, tenant_id: C.tenantId, finalidade: 'confirmar-email', exp: Math.floor(Date.now() / 1000) + 600 }, process.env.JWT_SEGREDO)],
    ['vencido', () => assinar({ sub: payload(C.token).sub, tenant_id: C.tenantId, finalidade: 'exportar-conta', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SEGREDO)],
    ['gigante', 'x'.repeat(3000)],
  ])('T-LGPD-04: token %s -> 400 LINK_INVALIDO', async (_nome, token) => {
    const r = await baixarPeloLink(typeof token === 'function' ? token() : token);
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('LINK_INVALIDO');
  });

  it('T-LGPD-05: cancelar de novo (com o token ainda válido) mantém a data e manda um e-mail NOVO', async () => {
    const r = await chamar('POST', '/conta/cancelamento', { token: C.token });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual(cancelamento);
    const dois = await tokensDosEmails(C.email, 2);
    expect(dois).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------
// API no próprio processo: fila simulada (503 e jobIds) e log em memória (o token nunca vai para o log).
// ---------------------------------------------------------------------------------------------------
describe('API no próprio processo', () => {
  const logs = [];
  const emails = [];
  let filaFora = false;
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
      portalUrl: 'http://portal.teste',
      pool,
      fila: {
        verificar: async () => !filaFora,
        enfileirar: async () => {},
        enfileirarEmail: async (dados, jobId) => {
          if (filaFora) throw new FilaIndisponivel('redis simulado fora');
          emails.push({ dados, jobId });
        },
      },
      limiteEmMemoria: true,
      logger: { level: 'info', stream: { write: (linha) => logs.push(linha) } },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const cancelar = (conta) => app.inject({ method: 'POST', url: '/conta/cancelamento', headers: { authorization: `Bearer ${conta.token}` } });
  const canceladoEm = async (conta) =>
    comoDono(conta.tenantId, async (c) => (await c.query('SELECT cancelado_em FROM orbita.tenants')).rows[0].cancelado_em);

  it('T-LGPD-05: fila de e-mail fora -> 503 FILA_INDISPONIVEL e a conta NÃO é cancelada', async () => {
    const D = await cadastrar({ empresa: 'LGPD D' });
    filaFora = true;
    try {
      const r = await cancelar(D);
      expect(r.statusCode).toBe(503);
      expect(r.json().codigo).toBe('FILA_INDISPONIVEL');
      expect(r.json().erro).toMatch(/cancelar/);
    } finally {
      filaFora = false;
    }
    expect(await canceladoEm(D)).toBeNull();
    expect((await chamar('POST', '/auth/login', { corpo: { email: D.email, senha: SENHA } })).status).toBe(200);
  });

  it('T-LGPD-05: cada pedido usa um jobId novo (um envio falho no Redis não engole o pedido seguinte)', async () => {
    const E = await cadastrar({ empresa: 'LGPD E' });
    expect((await cancelar(E)).statusCode).toBe(200);
    expect((await cancelar(E)).statusCode).toBe(200);
    const ids = emails.filter((e) => e.dados.tenant_id === E.tenantId).map((e) => e.jobId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id.startsWith(`exportacao-${E.tenantId}-`)).toBe(true);
      expect(id).not.toContain(':'); // o BullMQ 6 recusa ":" em id próprio
    }
  });

  it('T-OBS-04: o token do link não aparece no log, nem quando o download dá certo', async () => {
    const F = await cadastrar({ empresa: 'LGPD F' });
    expect((await cancelar(F)).statusCode).toBe(200);
    const { link } = emails.find((e) => e.dados.tenant_id === F.tenantId).dados;
    const token = new URL(link).searchParams.get('token');
    const r = await app.inject({ method: 'GET', url: `/conta/exportacao/arquivo?token=${token}` });
    expect(r.statusCode).toBe(200);
    const texto = logs.join('');
    expect(texto).toContain('[oculto]');
    expect(texto).not.toContain(token);
    expect(texto).not.toContain(token.split('.')[2]); // nem a assinatura sozinha
  });
});

// ---------------------------------------------------------------------------------------------------
// T-LGPD-03: o job de exclusão. Roda a MESMA função do job diário (excluirTenantsVencidos), como
// api_contatos, e a MESMA função do worker de importação (apagarDadosDoTenant), como importacao_svc.
// A fila entre as duas é simulada: o Redis do compose não tem porta publicada. A ligação real pela fila é
// conferida com o src/excluir-agora.js (docs/lgpd.md, "Como verificar").
// A data do cancelamento é simulada pelo comoDono (31 e 29 dias atrás), sem esperar 30 dias.
// ---------------------------------------------------------------------------------------------------
describe('T-LGPD-03: exclusão 30 dias após o cancelamento, só de quem deve, nos dois schemas', () => {
  const poolDe = (user, password) =>
    new pg.Pool({
      host: process.env.PGHOST_TESTES ?? '127.0.0.1',
      port: Number(process.env.PGPORT_TESTES ?? 5432),
      database: 'orbitati',
      user,
      password,
      max: 2,
    });
  const log = { info: () => {}, warn: () => {}, error: () => {} };
  let poolApi;
  let poolWorker;
  const T = {}; // vencido (31 dias), recente (29 dias), ativo
  let linkVencido;
  let resultado;
  const pedidos = []; // o que a API enfileirou para o worker de importação

  /** Toda tabela com tenant_id nos dois schemas, lida do catálogo: tabela nova entra sozinha no teste. */
  async function tabelasComTenant() {
    const dono = await conectar('migrador');
    try {
      const { rows } = await dono.query(
        `SELECT table_schema || '.' || table_name AS tabela, column_name AS coluna FROM information_schema.columns
          WHERE table_schema IN ('orbita', 'importacao') AND column_name = 'tenant_id'
         UNION ALL SELECT 'orbita.tenants', 'id' ORDER BY 1`,
      );
      return rows;
    } finally {
      await dono.end();
    }
  }
  const contar = (tenantId, tabelas) =>
    comoDono(tenantId, async (c) => {
      const n = {};
      for (const { tabela, coluna } of tabelas) {
        n[tabela] = Number((await c.query(`SELECT count(*) AS n FROM ${tabela} WHERE ${coluna} = $1`, [tenantId])).rows[0].n);
      }
      return n;
    });

  beforeAll(async () => {
    poolApi = poolDe('api_contatos', process.env.DB_SENHA_API);
    poolWorker = poolDe('importacao_svc', process.env.DB_SENHA_IMPORTACAO);
    for (const [nome, dias] of [['vencido', 31], ['recente', 29], ['ativo', null]]) {
      const conta = await cadastrar({ empresa: `LGPD exclusão ${nome}` });
      const contato = await chamar('POST', '/contatos', {
        token: conta.token,
        corpo: { nome: `Contato ${nome}`, email: `${nome}-${randomUUID()}@x.dev` },
      });
      await chamar('POST', `/contatos/${contato.corpo.id}/interacoes`, { token: conta.token, corpo: { tipo: 'email' } });
      const importacaoId = await criarImportacaoNoBanco(conta.tenantId, { status: 'concluida' });
      await comoDono(conta.tenantId, async (c) => {
        await c.query('INSERT INTO orbita.lotes_aplicados (importacao_id, numero) VALUES ($1, 1)', [importacaoId]);
        await c.query(
          "INSERT INTO importacao.execucoes (job_id, importacao_id, tentativa, status) VALUES ($1, $2, 1, 'concluida')",
          [`job-${importacaoId}`, importacaoId],
        );
        await c.query("INSERT INTO importacao.erros_linha (importacao_id, linha, motivo) VALUES ($1, 2, 'e-mail ausente: Fulano')", [
          importacaoId,
        ]);
        if (dias !== null) await c.query('UPDATE orbita.tenants SET cancelado_em = now() - make_interval(days => $1)', [dias]);
      });
      T[nome] = conta;
    }
    // Um link de exportação válido do vencido: depois da exclusão ele tem de morrer (400 LINK_INVALIDO).
    linkVencido = assinar(
      { sub: payload(T.vencido.token).sub, tenant_id: T.vencido.tenantId, finalidade: 'exportar-conta', exp: Math.floor(Date.now() / 1000) + 3600 },
      process.env.JWT_SEGREDO,
    );
    expect((await baixarPeloLink(linkVencido)).status).toBe(200); // controle: antes da exclusão, funciona

    const fila = { enfileirarExclusaoImportacao: async (id) => { pedidos.push(id); } };
    resultado = await excluirTenantsVencidos({ pool: poolApi, fila, log });
    for (const id of pedidos) await apagarDadosDoTenant(poolWorker, id); // o que o worker faz com cada pedido
  });
  afterAll(async () => {
    await poolApi?.end();
    await poolWorker?.end();
  });

  it('o vencido (31 dias) foi excluído e pedido ao worker; o recente (29) e o ativo não', () => {
    expect(resultado.excluidos).toContain(T.vencido.tenantId);
    expect(pedidos).toContain(T.vencido.tenantId);
    for (const lista of [resultado.excluidos, pedidos]) {
      expect(lista).not.toContain(T.recente.tenantId);
      expect(lista).not.toContain(T.ativo.tenantId);
    }
  });

  it('o vencido sumiu de TODAS as tabelas com tenant_id, nos dois schemas', async () => {
    const tabelas = await tabelasComTenant();
    expect(tabelas.map((t) => t.tabela)).toEqual(
      expect.arrayContaining(['importacao.erros_linha', 'importacao.execucoes', 'orbita.interacoes', 'orbita.lotes_aplicados', 'orbita.tenants']),
    );
    const n = await contar(T.vencido.tenantId, tabelas);
    expect(Object.values(n).every((v) => v === 0), JSON.stringify(n)).toBe(true);
  });

  it('o recente e o ativo continuam com pelo menos uma linha em cada tabela', async () => {
    const tabelas = await tabelasComTenant();
    for (const nome of ['recente', 'ativo']) {
      const n = await contar(T[nome].tenantId, tabelas);
      expect(Object.values(n).every((v) => v >= 1), `${nome}: ${JSON.stringify(n)}`).toBe(true);
    }
  });

  it('o link de exportação do excluído agora responde 400 LINK_INVALIDO', async () => {
    const r = await baixarPeloLink(linkVencido);
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('LINK_INVALIDO');
  });

  it('fila fora: o tenant é adiado e NADA dele é apagado (nem orbita)', async () => {
    const G = await cadastrar({ empresa: 'LGPD exclusão adiada' });
    await comoDono(G.tenantId, (c) => c.query("UPDATE orbita.tenants SET cancelado_em = now() - interval '40 days'"));
    const foraDoAr = { enfileirarExclusaoImportacao: async () => { throw new FilaIndisponivel('simulado'); } };
    const r = await excluirTenantsVencidos({ pool: poolApi, fila: foraDoAr, log });
    expect(r.adiados).toContain(G.tenantId);
    expect(r.excluidos).not.toContain(G.tenantId);
    expect((await contar(G.tenantId, [{ tabela: 'orbita.tenants', coluna: 'id' }]))['orbita.tenants']).toBe(1);
  });
});

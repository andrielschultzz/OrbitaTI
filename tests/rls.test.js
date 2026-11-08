// Isolamento no banco (RLS): T-RLS-01 a T-RLS-19 do docs/plano-de-testes.md, seção 2.1.
//
// Conecta DIRETO no Postgres com cada papel, como a API e o worker farão, e prova que o isolamento
// é do banco e não depende do código. Os testes rodam no host (Windows): a conexão é 127.0.0.1:5432,
// montada com as senhas do .env. As URLs do .env usam o host "postgres", que só existe dentro do compose.
//
// Cada execução cria os próprios tenants (UUID e e-mails únicos) e apaga tudo no fim.
// Pré-requisito: docker compose up -d --build --wait  (o migrate roda antes da API, dentro do up)
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

if (existsSync('.env')) process.loadEnvFile('.env');

const SENHAS = {
  migrador: process.env.DB_SENHA_MIGRADOR,
  api_contatos: process.env.DB_SENHA_API,
  importacao_svc: process.env.DB_SENHA_IMPORTACAO,
};

const abertas = [];
async function conectar(papel) {
  const cliente = new pg.Client({
    host: process.env.PGHOST_TESTES ?? '127.0.0.1',
    port: Number(process.env.PGPORT_TESTES ?? 5432),
    database: 'orbitati',
    user: papel,
    password: SENHAS[papel],
  });
  await cliente.connect();
  abertas.push(cliente);
  return cliente;
}

/** Igual ao withTenant da API (regra 2): transação + set_config(..., true), que vale só nesta transação. */
async function comTenant(cliente, tenantId, fn) {
  await cliente.query('BEGIN');
  try {
    await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  }
}

const execucao = `${Date.now()}-${process.pid}`;
const emailUnico = (nome) => `${nome}-${execucao}@exemplo.com.br`;

let api; // api_contatos
let worker; // importacao_svc
let dono; // migrador
const A = { id: randomUUID(), contatos: [] };
const B = { id: randomUUID(), contatos: [] };
const C = { id: randomUUID() }; // tenant cancelado
const criadosExtras = []; // tenants criados dentro dos testes (T-RLS-18), para limpar no fim

/** Cadastro de tenant como a API fará (T-RLS-18): fixa o UUID novo e insere tenant + primeiro usuário. */
async function cadastrar(tenant, { nome, plano = 'individual', emailUsuario, cancelado = false }) {
  await comTenant(api, tenant.id, async (c) => {
    await c.query('INSERT INTO orbita.tenants (id, nome, plano, cancelado_em) VALUES ($1, $2, $3, $4)', [
      tenant.id,
      nome,
      plano,
      cancelado ? new Date() : null,
    ]);
    await c.query(
      "INSERT INTO orbita.usuarios (nome, email, senha_hash, papel) VALUES ('Admin', $1, 'hash-de-teste', 'admin')",
      [emailUsuario],
    );
  });
  tenant.emailUsuario = emailUsuario;
}

beforeAll(async () => {
  const faltando = Object.entries(SENHAS).filter(([, s]) => !s).map(([p]) => p);
  if (faltando.length) throw new Error(`.env sem a senha de: ${faltando.join(', ')} (rode npm run env)`);

  api = await conectar('api_contatos');
  worker = await conectar('importacao_svc');
  dono = await conectar('migrador');

  await cadastrar(A, { nome: 'Empresa A', emailUsuario: emailUnico('admin-a') });
  await cadastrar(B, { nome: 'Empresa B', plano: 'equipe', emailUsuario: emailUnico('admin-b') });
  await cadastrar(C, { nome: 'Empresa C (cancelada)', emailUsuario: emailUnico('admin-c'), cancelado: true });

  for (const [tenant, qtd] of [[A, 3], [B, 2]]) {
    await comTenant(api, tenant.id, async (c) => {
      for (let i = 1; i <= qtd; i++) {
        const { rows } = await c.query('INSERT INTO orbita.contatos (nome) VALUES ($1) RETURNING id', [`Contato ${i}`]);
        tenant.contatos.push(rows[0].id);
      }
    });
  }

  // Erros de linha de A e B, gravados pelo worker no schema dele (T-RLS-16).
  for (const [tenant, qtd] of [[A, 2], [B, 3]]) {
    await comTenant(worker, tenant.id, async (c) => {
      for (let i = 1; i <= qtd; i++) {
        await c.query('INSERT INTO importacao.erros_linha (importacao_id, linha, motivo) VALUES ($1, $2, $3)', [
          randomUUID(),
          i + 1,
          'e-mail ausente',
        ]);
      }
    });
  }
});

afterAll(async () => {
  // A exclusão de tenant é por tenant (RLS): fixa cada um e apaga. O CASCADE leva usuários e contatos.
  if (api) {
    for (const id of [A.id, B.id, C.id, ...criadosExtras]) {
      await comTenant(api, id, (c) => c.query('DELETE FROM orbita.tenants WHERE id = $1', [id])).catch(() => {});
    }
  }
  // O CASCADE não chega ao schema importacao (sem FK entre os schemas): o worker apaga o dele.
  if (worker) {
    for (const id of [A.id, B.id]) {
      await comTenant(worker, id, (c) => c.query('DELETE FROM importacao.erros_linha')).catch(() => {});
    }
  }
  await Promise.all(abertas.map((c) => c.end().catch(() => {})));
});

const contar = async (c, sql, params) => Number((await c.query(sql, params)).rows[0].n);

// ===========================================================================================
describe('isolamento por tenant (api_contatos)', () => {
  it('T-RLS-01: sessão de A, SEM WHERE, só vê os contatos de A', async () => {
    const linhas = await comTenant(api, A.id, async (c) => (await c.query('SELECT id, tenant_id FROM orbita.contatos')).rows);
    expect(linhas).toHaveLength(A.contatos.length);
    expect(linhas.every((l) => l.tenant_id === A.id)).toBe(true);
  });

  it('T-RLS-02: sessão sem tenant não vê nada e não dá erro', async () => {
    expect(await contar(api, 'SELECT count(*) AS n FROM orbita.contatos')).toBe(0);
  });

  it('T-RLS-03: conexão reaproveitada depois do COMMIT não herda o tenant (NULLIF trata o "")', async () => {
    const naTransacao = await comTenant(api, A.id, (c) => contar(c, 'SELECT count(*) AS n FROM orbita.contatos'));
    expect(naTransacao).toBe(A.contatos.length);
    // Mesma conexão, fora da transação: o valor virou '' (e não NULL). Sem o NULLIF, ''::uuid daria erro.
    expect((await api.query("SELECT current_setting('app.tenant_id', true) AS v")).rows[0].v).toBe('');
    expect(await contar(api, 'SELECT count(*) AS n FROM orbita.contatos')).toBe(0);
  });

  it('T-RLS-04: INSERT com tenant_id de outro tenant é barrado pelo WITH CHECK', async () => {
    await expect(
      comTenant(api, A.id, (c) => c.query("INSERT INTO orbita.contatos (tenant_id, nome) VALUES ($1, 'Intruso')", [B.id])),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') });
    const deB = await comTenant(api, B.id, (c) => contar(c, "SELECT count(*) AS n FROM orbita.contatos WHERE nome = 'Intruso'"));
    expect(deB).toBe(0);
  });

  it('T-RLS-05: UPDATE em registro de outro tenant afeta 0 linhas, sem erro', async () => {
    const alvo = B.contatos[0];
    const r = await comTenant(api, A.id, (c) => c.query("UPDATE orbita.contatos SET nome = 'Alterado por A' WHERE id = $1", [alvo]));
    expect(r.rowCount).toBe(0);
    const nome = await comTenant(api, B.id, async (c) => (await c.query('SELECT nome FROM orbita.contatos WHERE id = $1', [alvo])).rows[0].nome);
    expect(nome).toBe('Contato 1');
  });

  it('T-RLS-06: DELETE em registro de outro tenant afeta 0 linhas', async () => {
    const alvo = B.contatos[1];
    const r = await comTenant(api, A.id, (c) => c.query('DELETE FROM orbita.contatos WHERE id = $1', [alvo]));
    expect(r.rowCount).toBe(0);
    expect(await comTenant(api, B.id, (c) => contar(c, 'SELECT count(*) AS n FROM orbita.contatos WHERE id = $1', [alvo]))).toBe(1);
  });

  it('T-RLS-10: api_contatos não lê usuarios sem tenant (só pela função de login)', async () => {
    expect(await contar(api, 'SELECT count(*) AS n FROM orbita.usuarios')).toBe(0);
  });

  it('T-RLS-13: tenant_id vem do DEFAULT, sem o código informar', async () => {
    const tenantGravado = await comTenant(api, A.id, async (c) => {
      const { rows } = await c.query("INSERT INTO orbita.contatos (nome) VALUES ('Sem tenant explícito') RETURNING id, tenant_id");
      A.contatos.push(rows[0].id);
      return rows[0].tenant_id;
    });
    expect(tenantGravado).toBe(A.id);
  });
});

// ===========================================================================================
describe('cadastro, login e unicidade', () => {
  it('T-RLS-18: a API cadastra tenant fixando o UUID novo antes; com outro id, o RLS barra', async () => {
    const novo = randomUUID();
    criadosExtras.push(novo);
    await comTenant(api, novo, async (c) => {
      await c.query("INSERT INTO orbita.tenants (id, nome, plano) VALUES ($1, 'Empresa nova', 'individual')", [novo]);
      await c.query(
        "INSERT INTO orbita.usuarios (nome, email, senha_hash, papel) VALUES ('Nova', $1, 'hash', 'admin')",
        [emailUnico('admin-nova')],
      );
    });
    expect(await comTenant(api, novo, (c) => contar(c, 'SELECT count(*) AS n FROM orbita.tenants'))).toBe(1);

    // Fixar um UUID e inserir outro: barrado. Sem tenant fixado: barrado também.
    await expect(
      comTenant(api, randomUUID(), (c) => c.query("INSERT INTO orbita.tenants (id, nome, plano) VALUES ($1, 'Outra', 'individual')", [randomUUID()])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      api.query("INSERT INTO orbita.tenants (id, nome, plano) VALUES ($1, 'Sem tenant', 'individual')", [randomUUID()]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('T-RLS-09: buscar_credencial acha o usuário sem tenant fixado; empresa cancelada não entra', async () => {
    const { rows } = await api.query('SELECT * FROM orbita.buscar_credencial($1)', [A.emailUsuario]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: A.id, papel: 'admin', plano: 'individual', senha_hash: 'hash-de-teste' });
    expect(rows[0].usuario_id).toMatch(/^[0-9a-f-]{36}$/);
    // E-mail digitado com maiúsculas também acha (a função compara com lower).
    expect((await api.query('SELECT * FROM orbita.buscar_credencial($1)', [A.emailUsuario.toUpperCase()])).rows).toHaveLength(1);
    expect((await api.query('SELECT * FROM orbita.buscar_credencial($1)', [C.emailUsuario])).rows).toHaveLength(0);
  });

  it('T-RLS-11: upsert do mesmo lote não duplica; o mesmo e-mail em outro tenant é outro contato', async () => {
    const lote = [1, 2, 3].map((i) => [`Lote ${i}`, emailUnico(`lote${i}`)]);
    const upsert = async (c) => {
      for (const [nome, email] of lote) {
        await c.query(
          `INSERT INTO orbita.contatos (nome, email) VALUES ($1, $2)
           ON CONFLICT (tenant_id, email) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now()`,
          [nome, email],
        );
      }
    };
    const doLote = 'SELECT count(*) AS n FROM orbita.contatos WHERE email = ANY($1)';
    const emails = lote.map(([, e]) => e);
    for (const tenant of [A, B]) {
      await comTenant(api, tenant.id, upsert);
      await comTenant(api, tenant.id, upsert); // o mesmo lote de novo (worker reenviando)
      expect(await comTenant(api, tenant.id, (c) => contar(c, doLote, [emails]))).toBe(3);
    }
  });

  it('T-RLS-12: e-mail de usuário é único na base inteira (mesmo em outro tenant)', async () => {
    await expect(
      comTenant(api, B.id, (c) =>
        c.query("INSERT INTO orbita.usuarios (nome, email, senha_hash, papel) VALUES ('Clone', $1, 'hash', 'consultor')", [
          A.emailUsuario,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('T-RLS-17: e-mail com maiúsculas é recusado pelo banco', async () => {
    await expect(
      comTenant(api, A.id, (c) => c.query("INSERT INTO orbita.contatos (nome, email) VALUES ('Fulano', 'Fulano@X.com')")),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// ===========================================================================================
describe('papéis', () => {
  it('T-RLS-07: importacao_svc não tem acesso ao schema orbita (com e sem tenant)', async () => {
    const negado = { code: '42501', message: expect.stringContaining('permission denied for schema orbita') };
    await expect(worker.query('SELECT * FROM orbita.contatos')).rejects.toMatchObject(negado);
    await expect(comTenant(worker, A.id, (c) => c.query('SELECT * FROM orbita.contatos'))).rejects.toMatchObject(negado);
  });

  it('T-RLS-08: o dono das tabelas (migrador) também passa pelo RLS (FORCE): sem tenant vê 0', async () => {
    expect(await contar(dono, 'SELECT count(*) AS n FROM orbita.contatos')).toBe(0);
    expect(await contar(dono, 'SELECT count(*) AS n FROM orbita.usuarios')).toBe(0);
  });

  it('T-RLS-14: nenhum papel de aplicação tem BYPASSRLS; orbita_auth tem e não faz login', async () => {
    const { rows } = await api.query(
      "SELECT rolname, rolbypassrls, rolcanlogin, rolsuper FROM pg_roles WHERE rolname IN ('migrador','api_contatos','importacao_svc','orbita_auth')",
    );
    const papel = Object.fromEntries(rows.map((r) => [r.rolname, r]));
    for (const nome of ['migrador', 'api_contatos', 'importacao_svc']) {
      expect(papel[nome]).toMatchObject({ rolbypassrls: false, rolcanlogin: true, rolsuper: false });
    }
    expect(papel.orbita_auth).toMatchObject({ rolbypassrls: true, rolcanlogin: false, rolsuper: false });
  });

  it('T-RLS-16: o schema importacao também isola por tenant', async () => {
    const linhas = await comTenant(worker, A.id, async (c) => (await c.query('SELECT tenant_id FROM importacao.erros_linha')).rows);
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => l.tenant_id === A.id)).toBe(true);
    expect(await contar(worker, 'SELECT count(*) AS n FROM importacao.erros_linha')).toBe(0);
  });
});

// ===========================================================================================
describe('guardas para objetos futuros', () => {
  it('T-RLS-15: toda tabela com tenant_id (e orbita.tenants) tem RLS ENABLE + FORCE e a política com NULLIF', async () => {
    // pg_catalog e não information_schema: o information_schema só mostra tabelas em que o papel tem
    // privilégio, e uma tabela nova sem GRANT passaria despercebida.
    const { rows } = await dono.query(`
      SELECT n.nspname || '.' || c.relname AS tabela, c.relrowsecurity AS enable, c.relforcerowsecurity AS force,
             p.qual, p.with_check
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname AND p.policyname = 'isolamento_tenant'
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
             OR (n.nspname = 'orbita' AND c.relname = 'tenants'))`);
    expect(rows.map((r) => r.tabela).sort()).toEqual(
      expect.arrayContaining(['importacao.erros_linha', 'importacao.execucoes', 'orbita.contatos', 'orbita.importacoes', 'orbita.lotes_aplicados', 'orbita.tenants', 'orbita.usuarios']),
    );
    const foraDaRegra = rows.filter(
      (r) => !r.enable || !r.force || !/NULLIF/i.test(r.qual ?? '') || !/NULLIF/i.test(r.with_check ?? ''),
    );
    expect(foraDaRegra.map((r) => r.tabela)).toEqual([]);
  });

  it('T-RLS-19: nenhuma função SECURITY DEFINER de orbita é executável por PUBLIC ou importacao_svc; só buscar_credencial, e só pela API', async () => {
    const { rows } = await dono.query(`
      SELECT p.oid::regprocedure::text AS funcao, p.proname,
             has_function_privilege('public', p.oid, 'EXECUTE') AS publico,
             has_function_privilege('importacao_svc', p.oid, 'EXECUTE') AS worker,
             has_function_privilege('api_contatos', p.oid, 'EXECUTE') AS api
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'orbita' AND p.prosecdef`);
    expect(rows.map((r) => r.proname)).toContain('buscar_credencial');
    expect(rows.filter((r) => r.publico || r.worker).map((r) => r.funcao)).toEqual([]);
    expect(rows.filter((r) => r.api).map((r) => r.proname)).toEqual(['buscar_credencial']);
  });

  it('T-RLS-19: função NOVA criada pelo migrador já nasce sem EXECUTE para PUBLIC (privilégio padrão)', async () => {
    // Simula a função do bloco 14 dentro de uma transação desfeita: nada fica no banco.
    await dono.query('BEGIN');
    try {
      await dono.query(`CREATE FUNCTION orbita.funcao_futura_teste() RETURNS int LANGUAGE sql SECURITY DEFINER
                        SET search_path = orbita, pg_temp AS 'SELECT 1'`);
      const { rows } = await dono.query(`
        SELECT has_function_privilege('public', 'orbita.funcao_futura_teste()', 'EXECUTE') AS publico,
               has_function_privilege('importacao_svc', 'orbita.funcao_futura_teste()', 'EXECUTE') AS worker,
               has_function_privilege('api_contatos', 'orbita.funcao_futura_teste()', 'EXECUTE') AS api`);
      expect(rows[0]).toEqual({ publico: false, worker: false, api: false });
    } finally {
      await dono.query('ROLLBACK');
    }
  });
});

// Apoio dos testes que falam com a API rodando no compose (auth, contatos, isolamento, importação).
// Não termina em .test.js, então o Vitest não o executa sozinho.
//
// Pré-requisito: docker compose up -d --build --wait
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

export const BASE = process.env.API_URL_TESTES ?? 'http://localhost:3000';
export const SENHA = 'Senha@Teste2026';

const execucao = `${Date.now()}-${process.pid}`;
let sequencia = 0;
/** E-mail único por execução: os testes rodam de novo sem apagar o banco e sem colidir. */
export const emailUnico = (nome = 'u') => `${nome}-${execucao}-${++sequencia}@teste.orbitati.dev`;

/**
 * Chama a API e devolve {status, corpo, headers}. corpo = JSON, ou null quando não há corpo (204).
 * `corpo` vai como JSON; `csv` vai como texto com Content-Type `tipo` (POST /importacoes).
 */
export async function chamar(metodo, caminho, { token, corpo, csv, tipo = 'text/csv', headers = {} } = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(csv !== undefined ? { 'content-type': tipo } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: csv ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined),
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null, headers: resposta.headers };
}

/** Lê o payload do JWT SEM verificar a assinatura (é o que o Portal faz; quem verifica é a API). */
export const payload = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

const tenantsCriados = new Set();

/** Cadastra uma empresa nova pela API e devolve {token, tenantId, email}. Registra para a limpeza. */
export async function cadastrar({ plano = 'individual', empresa = 'Empresa de Teste', email = emailUnico() } = {}) {
  const r = await chamar('POST', '/auth/cadastro', {
    corpo: { empresa, plano, nome: 'Pessoa de Teste', email, senha: SENHA },
  });
  if (r.status !== 201) throw new Error(`cadastro falhou: ${r.status} ${JSON.stringify(r.corpo)}`);
  const tenantId = payload(r.corpo.token).tenant_id;
  tenantsCriados.add(tenantId);
  return { token: r.corpo.token, tenantId, email };
}

/** Marca para limpeza um tenant criado fora do cadastrar() (ex.: no próprio teste de cadastro). */
export const registrarTenant = (tenantId) => tenantsCriados.add(tenantId);

/** Conexão direta no Postgres com um papel (host do Windows: 127.0.0.1:5432). */
export async function conectar(papel) {
  const senhas = {
    migrador: process.env.DB_SENHA_MIGRADOR,
    api_contatos: process.env.DB_SENHA_API,
    importacao_svc: process.env.DB_SENHA_IMPORTACAO,
  };
  const cliente = new pg.Client({
    host: process.env.PGHOST_TESTES ?? '127.0.0.1',
    port: Number(process.env.PGPORT_TESTES ?? 5432),
    database: 'orbitati',
    user: papel,
    password: senhas[papel],
  });
  await cliente.connect();
  return cliente;
}

/** Roda fn(cliente) como migrador, numa transação com app.tenant_id = tenantId (o migrador também está sob FORCE RLS). */
export async function comoDono(tenantId, fn) {
  const dono = await conectar('migrador');
  try {
    await dono.query('BEGIN');
    await dono.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const resultado = await fn(dono);
    await dono.query('COMMIT');
    return resultado;
  } finally {
    await dono.end();
  }
}

/**
 * Fixture: importação criada DIRETO no banco, sem job na fila. O worker nunca a toca, então o estado só
 * muda pelo que o teste fizer (determinístico). Devolve a linha como o GET /importacoes/:id a devolveria.
 */
export async function criarImportacaoNoBanco(tenantId, { status = 'processando', totalLinhas = 10, totalLotes = 1, linhasInvalidas = 0 } = {}) {
  return comoDono(tenantId, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO orbita.importacoes (status, total_linhas, total_lotes, linhas_invalidas)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [status, totalLinhas, totalLotes, linhasInvalidas],
    );
    return rows[0].id;
  });
}

// ---------------------------------------------------------------------------------------------------
// Tokens. HS256 = HMAC-SHA256 de "cabeçalho.payload" com o segredo. Os testes assinam à mão para poder
// montar tokens errados de propósito (claim trocado, vencido, segredo errado).
// ---------------------------------------------------------------------------------------------------
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
export function assinar(claims, segredo) {
  const corpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  return `${corpo}.${createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}

/** Token de serviço como o worker assina (regra 7). `extra` sobrescreve claims (para os casos de erro). */
export function tokenServico(tenantId, extra = {}, segredo = process.env.JWT_SERVICO_SEGREDO) {
  const agora = Math.floor(Date.now() / 1000);
  return assinar({ tenant_id: tenantId, iss: 'importacao', aud: 'api-contatos', iat: agora, exp: agora + 60, ...extra }, segredo);
}

/** CSV com cabeçalho `nome,email` e n linhas válidas com e-mails únicos. `sep` troca o separador. */
export function csvValido(n, { prefixo = 'contato', sep = ',' } = {}) {
  const tag = `${execucao}-${++sequencia}`;
  const linhas = Array.from({ length: n }, (_, i) => `${prefixo} ${i + 1}${sep}${prefixo}-${tag}-${i + 1}@importado.dev`);
  return [`nome${sep}email`, ...linhas].join('\n');
}

/**
 * Apaga os tenants criados nesta execução (usuários, contatos e importações vão junto pelo ON DELETE
 * CASCADE). O schema importacao não tem chave estrangeira para orbita (fronteira entre serviços), então
 * o CASCADE não chega lá: apagamos à mão (é o mesmo cuidado que a exclusão de tenant do bloco 14 terá).
 * Roda como migrador, que também está sob FORCE RLS: por isso fixa app.tenant_id de cada um antes.
 */
export async function limparTenants() {
  if (tenantsCriados.size === 0) return;
  const dono = await conectar('migrador');
  try {
    for (const id of tenantsCriados) {
      await dono.query('BEGIN');
      await dono.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
      await dono.query('DELETE FROM importacao.erros_linha WHERE tenant_id = $1', [id]);
      await dono.query('DELETE FROM importacao.execucoes WHERE tenant_id = $1', [id]);
      await dono.query('DELETE FROM orbita.tenants WHERE id = $1', [id]);
      await dono.query('COMMIT');
    }
    tenantsCriados.clear();
  } finally {
    await dono.end();
  }
}

export { randomUUID };

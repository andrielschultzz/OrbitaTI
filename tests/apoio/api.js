// Apoio dos testes que falam com a API rodando no compose (auth, contatos e, no bloco 3, isolamento).
// Não termina em .test.js, então o Vitest não o executa sozinho.
//
// Pré-requisito: docker compose up -d --build --wait
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

export const BASE = process.env.API_URL_TESTES ?? 'http://localhost:3000';
export const SENHA = 'Senha@Teste2026';

const execucao = `${Date.now()}-${process.pid}`;
let sequencia = 0;
/** E-mail único por execução: os testes rodam de novo sem apagar o banco e sem colidir. */
export const emailUnico = (nome = 'u') => `${nome}-${execucao}-${++sequencia}@teste.orbitati.dev`;

/** Chama a API e devolve {status, corpo, headers}. corpo = JSON, ou null quando não há corpo (204). */
export async function chamar(metodo, caminho, { token, corpo, headers = {} } = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
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
  const senhas = { migrador: process.env.DB_SENHA_MIGRADOR, api_contatos: process.env.DB_SENHA_API };
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

/**
 * Apaga os tenants criados nesta execução (usuários e contatos vão junto pelo ON DELETE CASCADE).
 * Roda como migrador, que também está sob FORCE RLS: por isso fixa app.tenant_id de cada um antes.
 */
export async function limparTenants() {
  if (tenantsCriados.size === 0) return;
  const dono = await conectar('migrador');
  try {
    for (const id of tenantsCriados) {
      await dono.query('BEGIN');
      await dono.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
      await dono.query('DELETE FROM orbita.tenants WHERE id = $1', [id]);
      await dono.query('COMMIT');
    }
    tenantsCriados.clear();
  } finally {
    await dono.end();
  }
}

export { randomUUID };

// Acesso ao banco da API. Conecta como `api_contatos` (sujeito ao RLS, sem BYPASSRLS).
//
// Regra 2 do CLAUDE.md: toda query em tabela de tenant passa por withTenant(). Nunca pool.query direto
// nessas tabelas: sem app.tenant_id, o RLS esconde todas as linhas (e um INSERT falha no WITH CHECK).
import pg from 'pg';

/**
 * Pool da API. connectionTimeoutMillis curto: com o banco fora, o /saude responde 503 em ~2 s, não trava.
 *
 * pool.on('error') é OBRIGATÓRIO (achado K7, docs/pendencias-bloco-7.md). Quando o Postgres cai ou
 * reinicia, ele encerra as conexões OCIOSAS do pool, e o pg avisa com o evento 'error'. No Node, evento
 * 'error' sem ouvinte derruba o processo: no kind, as 2 réplicas reiniciavam juntas a cada queda do
 * banco. Com o ouvinte, o pg só descarta a conexão quebrada e abre outra quando o banco voltar; enquanto
 * isso o /saude responde 503 e a readiness tira a réplica do Service, sem reiniciar nada (T-RES-07).
 */
export function criarPool(connectionString, log) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (erro) => log.warn({ evento: 'banco_conexao_perdida', err: erro.message }, 'banco: conexão ociosa perdida'));
  return pool;
}

/**
 * Roda fn(cliente) numa transação com app.tenant_id fixado.
 *
 * - set_config(..., true) = SET LOCAL: o valor some no COMMIT/ROLLBACK, então a conexão volta ao pool
 *   sem tenant. Usamos set_config porque SET LOCAL não aceita parâmetro ($1), e concatenar o valor no
 *   SQL abriria espaço para injeção.
 * - Qualquer erro dentro de fn desfaz tudo (ROLLBACK) e é repassado.
 * - release(erro) descarta a conexão do pool se o próprio ROLLBACK falhar (conexão quebrada).
 */
export async function withTenant(pool, tenantId, fn) {
  if (!tenantId) throw new Error('withTenant: tenantId ausente');
  const cliente = await pool.connect();
  let erroConexao;
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    try {
      await cliente.query('ROLLBACK');
    } catch (erroRollback) {
      erroConexao = erroRollback;
    }
    throw erro;
  } finally {
    cliente.release(erroConexao);
  }
}

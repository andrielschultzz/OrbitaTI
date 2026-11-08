// Acesso ao banco do worker. Conecta como `importacao_svc`: só o schema importacao, NENHUM privilégio em
// orbita (regra 6). Os contatos não são gravados aqui: vão para a API pelas rotas /interno (regra 7).
//
// withTenant é uma cópia do da API (services/api-contatos/src/db.js), pelo mesmo motivo do csv.js:
// serviço independente. O worker é tão sujeito ao RLS quanto a API (ADR-003): sem tenant, vê 0 linhas.
import pg from 'pg';

/**
 * pool.on('error') é OBRIGATÓRIO (achado K7, docs/pendencias-bloco-7.md): quando o Postgres cai, ele
 * encerra as conexões ociosas e o pg emite 'error'. Sem ouvinte, o Node derruba o worker. Com ele, a
 * conexão quebrada é descartada e o worker espera o banco voltar (readiness 503 no /saude, T-RES-07).
 */
export function criarPool(connectionString, log) {
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 30_000 });
  pool.on('error', (erro) => log.warn({ evento: 'banco_conexao_perdida', err: erro.message }, 'banco: conexão ociosa perdida'));
  return pool;
}

/** Roda fn(cliente) numa transação com app.tenant_id fixado (set_config(..., true) = SET LOCAL). */
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

/** importacao.execucoes: uma linha por tentativa do job. Upsert: um job "travado" que o BullMQ reinicia
 * pode repetir o mesmo número de tentativa. */
export const registrarExecucao = (pool, tenantId, { jobId, importacaoId, tentativa }) =>
  withTenant(pool, tenantId, (c) =>
    c.query(
      `INSERT INTO importacao.execucoes (job_id, importacao_id, tentativa, status)
       VALUES ($1, $2, $3, 'processando')
       ON CONFLICT (job_id, tentativa) DO UPDATE SET status = 'processando', iniciado_em = now(), finalizado_em = NULL`,
      [jobId, importacaoId, tentativa],
    ),
  );

export const finalizarExecucao = (pool, tenantId, { jobId, tentativa, status }) =>
  withTenant(pool, tenantId, (c) =>
    c.query(
      'UPDATE importacao.execucoes SET status = $3, finalizado_em = now() WHERE job_id = $1 AND tentativa = $2',
      [jobId, tentativa, status],
    ),
  );

/**
 * importacao.erros_linha: apaga os da importação e grava de novo, na mesma transação. Assim o retry do
 * job não duplica erros (idempotente, como os lotes). Um INSERT só para todas as linhas (unnest).
 */
export const gravarErros = (pool, tenantId, importacaoId, erros) =>
  withTenant(pool, tenantId, async (c) => {
    await c.query('DELETE FROM importacao.erros_linha WHERE importacao_id = $1', [importacaoId]);
    if (erros.length === 0) return;
    await c.query(
      `INSERT INTO importacao.erros_linha (importacao_id, linha, motivo)
       SELECT $1, linha, motivo FROM unnest($2::int[], $3::text[]) AS x(linha, motivo)`,
      [importacaoId, erros.map((e) => e.linha), erros.map((e) => e.motivo)],
    );
  });

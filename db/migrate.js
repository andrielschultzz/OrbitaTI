// Aplica as migrações pendentes de db/migrations, em ordem, como o papel `migrador`.
//
// - Cada arquivo roda numa transação própria: ou entra inteiro, ou nada entra.
// - O que já foi aplicado fica em public.schema_migrations (nome + SHA-256 do conteúdo).
// - Idempotente: rodar de novo não aplica nada.
// - Editar uma migração JÁ aplicada é erro: o hash não bate e o migrate para. Migração aplicada não se
//   edita; cria-se uma nova (002_..., 003_...).
// - Advisory lock: se dois migrates rodarem ao mesmo tempo (CI, kind), o segundo espera o primeiro.
// - WARNING do PostgreSQL durante uma migração = falha (ROLLBACK). Um GRANT ou REVOKE sem efeito, por
//   exemplo, não dá erro: só gera WARNING, e a migração "passaria" com a permissão errada.
//
// Uso: DATABASE_URL=postgres://migrador:...@postgres:5432/orbitati node migrate.js
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const PASTA = process.env.PASTA_MIGRACOES ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const TRAVA = 4_202_611; // número fixo qualquer: identifica o lock "migrações do OrbitaTI"

if (!process.env.DATABASE_URL) {
  console.error('migrate: defina DATABASE_URL (a URL do papel migrador).');
  process.exit(1);
}

const arquivos = readdirSync(PASTA)
  .filter((nome) => /^\d{3}_[a-z0-9_]+\.sql$/.test(nome))
  .sort();

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
let avisos = [];
cliente.on('notice', (aviso) => {
  if (aviso.severity === 'WARNING') avisos.push(aviso.message);
});
await cliente.connect();
try {
  await cliente.query('SELECT pg_advisory_lock($1)', [TRAVA]);
  await cliente.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      nome        text PRIMARY KEY,
      sha256      text NOT NULL,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )`);
  const { rows } = await cliente.query('SELECT nome, sha256 FROM public.schema_migrations');
  const aplicadas = new Map(rows.map((r) => [r.nome, r.sha256]));

  let novas = 0;
  for (const nome of arquivos) {
    const sql = readFileSync(path.join(PASTA, nome), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    if (aplicadas.has(nome)) {
      if (aplicadas.get(nome) !== hash) {
        throw new Error(`${nome} mudou depois de aplicada. Não edite migração aplicada: crie uma nova.`);
      }
      continue;
    }
    const inicio = Date.now();
    await cliente.query('BEGIN');
    try {
      avisos = [];
      await cliente.query(sql);
      if (avisos.length) throw new Error(`o PostgreSQL emitiu WARNING: ${avisos.join(' | ')}`);
      await cliente.query('INSERT INTO public.schema_migrations (nome, sha256) VALUES ($1, $2)', [nome, hash]);
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw new Error(`${nome} falhou e foi desfeita: ${erro.message}`);
    }
    novas += 1;
    console.log(`migrate: aplicada ${nome} (${Date.now() - inicio} ms)`);
  }
  console.log(
    novas === 0
      ? `migrate: nada a aplicar (${arquivos.length} migração(ões) já aplicada(s)).`
      : `migrate: ${novas} migração(ões) aplicada(s).`,
  );
} catch (erro) {
  console.error(`migrate: ${erro.message}`);
  process.exitCode = 1;
} finally {
  await cliente.end(); // fechar a conexão também libera o advisory lock
}

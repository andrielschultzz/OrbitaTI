// Exclusão de tenants 30 dias depois do cancelamento (bloco 14, LGPD; docs/lgpd.md, R4).
// "Exclusão que depende de alguém lembrar não é medida de segurança": roda sozinha, uma vez por dia.
//
// Database-per-service (regra 10, achado B1): cada serviço apaga o PRÓPRIO schema.
//
//   API (este arquivo)                       fila exclusao-importacao          worker de importação
//   tenants_para_excluir() -> para cada id:
//     1. enfileira {tenant_id} ─────────────────────────────────────────────►  apaga importacao.* do tenant
//     2. só se enfileirou: withTenant(id) apaga orbita.* do tenant (tabela por tabela, e o tenant)
//
// Por que nessa ordem: se a API apagasse orbita primeiro e o Redis falhasse em seguida, o tenant sumiria do
// tenants_para_excluir() e ninguém mais lembraria de apagar o schema importacao. Na ordem acima, uma falha
// só adia a exclusão para o dia seguinte, inteira.
//
// Uma vez por dia, mesmo com 2 réplicas da API no kind: as duas chamam upsertJobScheduler com o MESMO id
// ('exclusao-diaria'). O BullMQ guarda um agendador só, que gera um job por dia, e um job é entregue a um
// Worker só. Dia perdido (Redis fora às 3 h) se resolve sozinho: a função devolve TODOS os vencidos.
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { withTenant } from './db.js';

export const NOME_FILA_EXCLUSAO_TENANTS = 'exclusao-tenants';
export const ID_AGENDADOR = 'exclusao-diaria';
/** 3 h da manhã no Brasil: fora do horário de uso. */
export const AGENDA = { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' };
const NOVA_TENTATIVA_AGENDADOR_MS = 60_000;

// Ordem das tabelas: filhas antes das mães (as chaves estrangeiras são satisfeitas sem depender do CASCADE).
// Tabela nova com tenant_id em orbita entra aqui; o T-LGPD-03 confere TODAS as tabelas com tenant_id.
const TABELAS = ['interacoes', 'lotes_aplicados', 'importacoes', 'contatos', 'usuarios'];

/**
 * Apaga o schema orbita de UM tenant, sob RLS. Devolve quantas linhas saíram de cada tabela (vai para o
 * log de auditoria: só números, nenhum dado pessoal).
 */
async function apagarTenant(pool, tenantId) {
  return withTenant(pool, tenantId, async (c) => {
    const linhas = {};
    for (const tabela of TABELAS) {
      // O WHERE repete o que o RLS já garante (defesa em profundidade).
      linhas[tabela] = (await c.query(`DELETE FROM orbita.${tabela} WHERE tenant_id = $1`, [tenantId])).rowCount;
    }
    linhas.tenants = (await c.query('DELETE FROM orbita.tenants WHERE id = $1', [tenantId])).rowCount;
    return linhas;
  });
}

/**
 * O trabalho do job diário. Exportado para o T-LGPD-03 e para o src/excluir-agora.js.
 * @param {{pool: import('pg').Pool, fila: {enfileirarExclusaoImportacao: Function}, log: object}} deps
 * @returns {Promise<{excluidos: string[], adiados: string[]}>}
 */
export async function excluirTenantsVencidos({ pool, fila, log }) {
  // A única leitura sem tenant fixado: a função SECURITY DEFINER (dona orbita_auth) devolve só os ids.
  // Não é tabela de tenant, por isso pool.query (mesma exceção do login, regra 6).
  const { rows } = await pool.query('SELECT id FROM orbita.tenants_para_excluir() AS id');
  const resultado = { excluidos: [], adiados: [] };
  for (const { id } of rows) {
    try {
      await fila.enfileirarExclusaoImportacao(id);
    } catch (erro) {
      log.warn({ evento: 'exclusao_adiada', tenant_id: id, motivo: erro.message }, 'exclusão adiada: fila fora; tenta de novo amanhã');
      resultado.adiados.push(id);
      continue;
    }
    const linhas = await apagarTenant(pool, id);
    log.info({ evento: 'tenant_excluido', tenant_id: id, linhas }, 'tenant excluído (LGPD, 30 dias após o cancelamento)');
    resultado.excluidos.push(id);
  }
  log.info({ evento: 'exclusao_concluida', excluidos: resultado.excluidos.length, adiados: resultado.adiados.length }, 'exclusão diária concluída');
  return resultado;
}

/**
 * Liga o agendador e o Worker da exclusão diária. Só o server.js chama (via buildApp({agendarExclusao})):
 * os testes nunca sobem agendador.
 *
 * Redis fora não derruba a API (mesma regra da fila.js): a conexão é própria, todos os 'error' têm
 * ouvinte, e o registro do agendador tenta de novo a cada minuto até dar certo, sem segurar a subida.
 */
export function iniciarAgendador({ pool, fila, redisUrl, log }) {
  // maxRetriesPerRequest: null é exigência do BullMQ para o Worker (comandos bloqueantes).
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', () => {}); // o estado aparece no /saude pela fila principal; aqui só evita "Unhandled error"
  const filaDiaria = new Queue(NOME_FILA_EXCLUSAO_TENANTS, { connection: redis });
  filaDiaria.on('error', () => {});

  let encerrado = false;
  let timer;
  const registrar = async () => {
    if (encerrado) return;
    try {
      await filaDiaria.upsertJobScheduler(ID_AGENDADOR, AGENDA, {
        name: 'excluir-vencidos',
        opts: { removeOnComplete: 30, removeOnFail: { age: 7 * 24 * 60 * 60 } },
      });
      log.info({ evento: 'exclusao_agendada', ...AGENDA }, 'exclusão diária agendada');
    } catch (erro) {
      log.warn({ err: erro.message }, 'exclusão diária: não conseguiu agendar; tenta de novo em 1 min');
      timer = setTimeout(registrar, NOVA_TENTATIVA_AGENDADOR_MS);
    }
  };
  registrar();

  const worker = new Worker(NOME_FILA_EXCLUSAO_TENANTS, () => excluirTenantsVencidos({ pool, fila, log }), {
    connection: redis,
    concurrency: 1,
  });
  worker.on('error', () => {});
  worker.on('failed', (_job, erro) => log.error({ evento: 'exclusao_falhou', err: erro.message }, 'exclusão diária falhou; roda de novo amanhã'));

  return {
    async fechar() {
      encerrado = true;
      clearTimeout(timer);
      await Promise.all([worker.close().catch(() => {}), filaDiaria.close().catch(() => {})]);
      redis.disconnect();
    },
  };
}

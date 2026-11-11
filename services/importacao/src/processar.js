// O que o worker faz com UM job de importação (bloco 4, itens 6 e 7). Separado do worker.js para ser
// testado sem Redis: recebe as dependências (banco, API, pausa) por parâmetro.
//
//   1. registra a tentativa em importacao.execucoes
//   2. valida o CSV; linhas inválidas vão para importacao.erros_linha
//   3. POST /interno/.../inicio  {total_lotes, linhas_invalidas}  (quem conhece os números certos é o worker)
//   4. para cada lote: POST /interno/.../lotes, e espera IMPORT_PAUSA_MS antes do próximo (ADR-003)
//
// Idempotente de ponta a ponta: se o job rodar de novo (retry, worker reiniciado), erros_linha é refeito,
// o inicio repetido não muda nada e o lote já aplicado volta {aplicado:false}. Nada duplica (regra 8).
import { UnrecoverableError } from 'bullmq';
import { ErroDefinitivo } from './api.js';
import { CsvInvalido, fatiar, validarCsv } from './csv.js';
import { apagarDaImportacao, finalizarExecucao, gravarErros, registrarExecucao } from './db.js';

export const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * @param {import('bullmq').Job} job
 * @param {{pool, api, lote: number, pausaMs: number, log, esperar?: (ms:number)=>Promise<void>}} deps
 */
export async function processarImportacao(job, { pool, api, lote, pausaMs, log, esperar: dormir = esperar }) {
  const { importacao_id: importacaoId, tenant_id: tenantId, request_id: requestId, csv } = job.data;
  const tentativa = job.attemptsMade + 1;
  const ctx = { importacaoId, tenantId, requestId };
  const execucao = { jobId: job.id, importacaoId, tentativa };

  await registrarExecucao(pool, tenantId, execucao);
  try {
    const { validos, erros } = validarCsv(csv);
    await gravarErros(pool, tenantId, importacaoId, erros);

    const lotes = fatiar(validos, lote);
    await api.inicio(ctx, lotes.length, erros.length);
    log.info({ tentativa, validas: validos.length, invalidas: erros.length, lotes: lotes.length }, 'importacao: inicio');

    for (let i = 0; i < lotes.length; i++) {
      const { aplicado } = await api.lote(ctx, i + 1, lotes[i]);
      await job.updateProgress(Math.round(((i + 1) / lotes.length) * 100)).catch(() => {});
      // Pausa entre lotes: devolve o banco às buscas dos outros tenants (ADR-003, CQ-01).
      // Sem pausa depois do último, nem depois de um lote que já estava aplicado (não houve escrita).
      if (aplicado && i < lotes.length - 1) await dormir(pausaMs);
    }

    await finalizarExecucao(pool, tenantId, { ...execucao, status: 'concluida' });
    log.info({ tentativa, lotes: lotes.length }, 'importacao: concluida');
  } catch (erro) {
    await finalizarExecucao(pool, tenantId, { ...execucao, status: 'erro' }).catch((e) =>
      log.error({ err: e }, 'importacao: falha ao registrar execucao'),
    );
    // 404: a API não conhece esta importação (tenant excluído pela LGPD, bloco 14). O que este job acabou de
    // gravar no schema do worker é lixo de um tenant que não existe mais: apaga.
    if (erro instanceof ErroDefinitivo && erro.status === 404) {
      await apagarDaImportacao(pool, tenantId, importacaoId).catch((e) =>
        log.error({ err: e }, 'importacao: falha ao apagar os dados de uma importação desconhecida'),
      );
      log.warn({ evento: 'importacao_desconhecida' }, 'importacao: a API não conhece esta importação; dados do worker apagados');
    }
    // CSV ilegível ou 4xx da API: tentar de novo daria o mesmo resultado. UnrecoverableError faz o
    // BullMQ desistir já, sem gastar as outras tentativas (e o worker.js chama /falha).
    if (erro instanceof CsvInvalido || erro instanceof ErroDefinitivo) throw new UnrecoverableError(erro.message);
    throw erro;
  }
}

/** Depois de um 'failed' do BullMQ: foi a última tentativa? Então a importação falhou de vez. */
export const esgotouTentativas = (job, erro) =>
  erro?.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts?.attempts ?? 1);

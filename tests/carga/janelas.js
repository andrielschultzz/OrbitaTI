// Veredito do CQ-01 (bloco 9, decisão 4 de prompts/decisoes-plano-de-testes.md).
//
// Por que existe: o barulhento trabalha só uma parte dos 2 minutos. O p95 das ~400 buscas mistura muitas
// feitas com o banco ocioso, e o teste poderia passar sem provar nada. Aqui separamos as buscas que
// COMEÇARAM dentro de uma janela de importação (POST /importacoes até concluida/falhou) e aplicamos o
// critério só a elas. O grupo "geral" aparece ao lado, para comparação.
//
// Uso:
//   node tests/carga/janelas.js <k6.json> [--sem-criterio] [--saida <arquivo.json>]
//
//   <k6.json>       saída do `k6 run --out json=...` (uma linha JSON por ponto)
//   --sem-criterio  T-CQ01-02 (sem a mitigação): só registra os números, não aprova nem reprova
//   --saida         grava o resultado também em JSON
//
// Código de saída: 0 passou (ou --sem-criterio), 1 falhou o critério, 2 entrada inválida.
//
// Percentil por POSIÇÃO ("nearest rank"): o p95 de n valores é o ⌈0,95·n⌉-ésimo em ordem crescente, a mesma
// conta do plano de testes ("o p95 de 400 é a 380ª"). O k6 interpola entre dois valores, então o p95 do
// resumo do k6 pode diferir um pouco do daqui.
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const CRITERIO = { p95Ms: 800, maxMs: 2000, falhas: 0 };
/** Abaixo disto, o p95 é quase o máximo (n = 20 → 19º valor): o relatório avisa. */
export const N_CONFIAVEL = 100;
/** Abaixo disto, a amostra serve só como registro (limitação declarada no relatório). */
export const N_MINIMO = 20;

/**
 * Converte o horário RFC 3339 do k6 (com até 9 casas de fração) em milissegundos desde 1970.
 * Date.parse sozinho não garante mais de 3 casas; aqui a fração entra inteira.
 */
export function horarioEmMs(texto) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(texto);
  if (!m) throw new Error(`horário inválido no JSON do k6: ${texto}`);
  const segundos = Date.parse(m[1] + m[3]);
  const fracaoMs = m[2] ? Number(`0.${m[2]}`) * 1000 : 0;
  return segundos + fracaoMs;
}

/** p (0 a 1) por posição: o ⌈p·n⌉-ésimo valor de `ordenados` (crescente). */
export function percentil(ordenados, p) {
  if (ordenados.length === 0) return null;
  const posicao = Math.max(1, Math.ceil(p * ordenados.length));
  return ordenados[posicao - 1];
}

export function estatisticas(duracoes) {
  const ordenados = [...duracoes].sort((a, b) => a - b);
  return {
    n: ordenados.length,
    p50: percentil(ordenados, 0.5),
    p95: percentil(ordenados, 0.95),
    p99: percentil(ordenados, 0.99),
    max: ordenados.length ? ordenados[ordenados.length - 1] : null,
  };
}

/** A busca está "na janela" se o seu INÍCIO cai dentro de alguma janela (limites inclusive). */
export const naJanela = (inicioMs, janelas) => janelas.some((j) => inicioMs >= j.inicio && inicioMs <= j.fim);

/**
 * Junta os pontos do k6 (objetos já lidos do JSON) em janelas e buscas.
 * O `time` de um ponto de requisição HTTP do k6 é o FIM da requisição; o início é time − duração.
 * (Conferido no bloco 9 com uma rodada curta: ver docs/ensaios/cq01-*.md, seção "Método".)
 */
export function agrupar(pontos) {
  const inicios = new Map();
  const fins = new Map();
  const buscas = [];
  const falhas = [];
  for (const p of pontos) {
    if (p.type !== 'Point') continue;
    const tags = p.data.tags ?? {};
    if (p.metric === 'janela_inicio_ms') inicios.set(tags.importacao, p.data.value);
    else if (p.metric === 'janela_fim_ms') fins.set(tags.importacao, { fim: p.data.value, status: tags.status });
    else if (tags.cenario !== 'observadores') continue;
    else if (p.metric === 'http_req_duration') {
      const fimMs = horarioEmMs(p.data.time);
      buscas.push({ inicio: fimMs - p.data.value, duracao: p.data.value });
    } else if (p.metric === 'http_req_failed' && p.data.value === 1) {
      falhas.push({ fim: horarioEmMs(p.data.time) });
    }
  }
  const janelas = [...inicios.entries()]
    .map(([importacao, inicio]) => ({ importacao, inicio, ...(fins.get(importacao) ?? { fim: null, status: 'sem fim' }) }))
    .sort((a, b) => a.inicio - b.inicio);
  return { janelas, buscas, falhas };
}

/** Calcula os dois grupos e o veredito. */
export function avaliar({ janelas, buscas, falhas }, { semCriterio = false } = {}) {
  const fechadas = janelas.filter((j) => j.fim !== null);
  const dentro = buscas.filter((b) => naJanela(b.inicio, fechadas));
  const naJanelaStats = estatisticas(dentro.map((b) => b.duracao));
  const geralStats = estatisticas(buscas.map((b) => b.duracao));

  const motivos = [];
  if (fechadas.length < janelas.length) motivos.push(`${janelas.length - fechadas.length} janela(s) sem fim registrado`);
  // falhou, post_http_413, tempo_esgotado...: a carga não foi a planejada, então o número não prova nada.
  const ruins = fechadas.filter((j) => j.status !== 'concluida');
  if (ruins.length) motivos.push(`importação(ões) que não concluíram: ${ruins.map((j) => `${j.importacao}=${j.status}`).join(', ')}`);
  if (naJanelaStats.n === 0) motivos.push('nenhuma busca na janela');
  else {
    if (!(naJanelaStats.p95 < CRITERIO.p95Ms)) motivos.push(`p95 na janela ${naJanelaStats.p95.toFixed(1)} ms ≥ ${CRITERIO.p95Ms} ms`);
    if (!(naJanelaStats.max < CRITERIO.maxMs)) motivos.push(`máximo na janela ${naJanelaStats.max.toFixed(1)} ms ≥ ${CRITERIO.maxMs} ms`);
  }
  if (falhas.length > CRITERIO.falhas) motivos.push(`${falhas.length} requisição(ões) de observador com falha`);

  const avisos = [];
  if (naJanelaStats.n < N_MINIMO) avisos.push(`n na janela = ${naJanelaStats.n} < ${N_MINIMO}: amostra pequena demais, serve só como registro`);
  else if (naJanelaStats.n < N_CONFIAVEL) avisos.push(`n na janela = ${naJanelaStats.n} < ${N_CONFIAVEL}: o p95 da janela é pouco confiável`);

  return {
    janelas: janelas.map((j) => ({ ...j, duracao_s: j.fim === null ? null : (j.fim - j.inicio) / 1000 })),
    na_janela: naJanelaStats,
    geral: geralStats,
    falhas: { total: falhas.length, na_janela: falhas.filter((f) => naJanela(f.fim, fechadas)).length },
    veredito: semCriterio ? 'sem critério' : motivos.length === 0 ? 'passou' : 'falhou',
    motivos: semCriterio ? [] : motivos,
    avisos,
  };
}

async function lerJsonLinhas(caminho) {
  const pontos = [];
  const linhas = createInterface({ input: createReadStream(caminho, 'utf8'), crlfDelay: Infinity });
  for await (const linha of linhas) if (linha.trim()) pontos.push(JSON.parse(linha));
  return pontos;
}

const ms = (v) => (v === null ? '—' : v.toFixed(1));
const hora = (v) => new Date(v).toISOString().slice(11, 23);

export function formatar(r) {
  const saida = ['Janelas (UTC):'];
  for (const j of r.janelas) {
    saida.push(`  importação ${j.importacao}: ${hora(j.inicio)} → ${j.fim === null ? '—' : hora(j.fim)}  ` +
      `(${j.duracao_s === null ? '—' : j.duracao_s.toFixed(1) + ' s'}, ${j.status})`);
  }
  saida.push('', '| grupo | n | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |', '|---|---:|---:|---:|---:|---:|');
  for (const [nome, s] of [['na janela', r.na_janela], ['geral', r.geral]]) {
    saida.push(`| ${nome} | ${s.n} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.p99)} | ${ms(s.max)} |`);
  }
  saida.push('', `Falhas dos observadores: ${r.falhas.total} no total, ${r.falhas.na_janela} na janela`);
  for (const a of r.avisos) saida.push(`AVISO: ${a}`);
  saida.push(`VEREDITO CQ-01: ${r.veredito.toUpperCase()}` +
    (r.veredito === 'sem critério' ? '' : ` (p95 < ${CRITERIO.p95Ms} ms, máx < ${CRITERIO.maxMs} ms e 0 falhas, no grupo "na janela")`));
  for (const m of r.motivos) saida.push(`  - ${m}`);
  return saida.join('\n');
}

async function principal(args) {
  const arquivo = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--saida');
  const iSaida = args.indexOf('--saida');
  if (!arquivo) {
    console.error('uso: node tests/carga/janelas.js <k6.json> [--sem-criterio] [--saida <arquivo.json>]');
    return 2;
  }
  const resultado = avaliar(agrupar(await lerJsonLinhas(arquivo)), { semCriterio: args.includes('--sem-criterio') });
  console.log(formatar(resultado));
  if (iSaida !== -1) await writeFile(args[iSaida + 1], JSON.stringify(resultado, null, 2) + '\n');
  return resultado.veredito === 'falhou' ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).then(
    (codigo) => { process.exitCode = codigo; },
    (erro) => { console.error(erro.message); process.exitCode = 2; },
  );
}

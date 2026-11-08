// CQ-01: vizinho barulhento (docs/atributos.md; T-CQ01-01 e T-CQ01-02 do plano de testes).
//
// Roda na rede interna do compose (serviço k6, profile "carga"):
//   docker compose --profile carga run --rm k6 run --out json=/resultados/k6.json /scripts/cq01.js
// Quem roda as duas rodadas (com e sem a mitigação) e guarda tudo é o scripts/medir-cq01.ps1.
//
// Setup (fora dos cenários: nada dele entra nas métricas dos observadores):
//   - 1 tenant Equipe NOVO, o barulhento (papel da TechConsult). Não é a conta do seed: 15 mil contatos a
//     mais estragariam a demo de isolamento e as capturas do Portal.
//   - 10 tenants Individuais, os observadores, com 50 contatos cada. Os contatos entram por UMA importação de
//     CSV por observador (50 ≤ 100 linhas do plano), não por 50 POST /contatos: 50 requisições chegariam
//     perto do limite de 60/min do plano Individual e somariam com as buscas do primeiro minuto.
//
// Cenários (começam juntos, depois do setup):
//   - barulhento: 3 importações de 5.000 linhas, uma a cada 20 s (VU i começa em i × 20 s). Linhas curtas
//     (~40 bytes: só nome e e-mail, como no T-IMP-06): 5.000 × 40 ≈ 200 KB < 1 MB. Sufixo -i1/-i2/-i3 no
//     e-mail para as três gravarem contatos novos. Cada uma registra a JANELA: início = antes do
//     POST /importacoes; fim = quando o GET /importacoes/:id (a cada 1 s) devolve concluida ou falhou.
//     A janela vai para o JSON como métricas janela_inicio_ms e janela_fim_ms (lidas pelo janelas.js) e
//     para o log como "JANELA <n> <inicio> <fim> <status>".
//   - observadores: 10 VUs, um por tenant, GET /contatos?busca=cliente a cada 3 s por 2 min (≈ 400 buscas).
//
// Thresholds: barreira mínima sobre a execução INTEIRA. O veredito do CQ-01 vem do janelas.js, que aplica
// o critério só às buscas que começaram dentro de uma janela (decisão 4). Não mexa nos números para passar.
//
// Variáveis (-e NOME=valor): API_URL (padrão http://api-contatos:3000), DURACAO_S (120), LINHAS (5000),
// RODADA (sufixo dos e-mails das contas; padrão: horário atual).
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Gauge } from 'k6/metrics';

const API = (__ENV.API_URL || 'http://api-contatos:3000').replace(/\/$/, '');
const DURACAO_S = Number(__ENV.DURACAO_S || 120);
const LINHAS = Number(__ENV.LINHAS || 5000);
const RODADA = __ENV.RODADA || String(Date.now());
const OBSERVADORES = 10;
const CONTATOS_POR_OBSERVADOR = 50;
const IMPORTACOES = 3;
const INTERVALO_IMPORTACOES_S = 20;
const INTERVALO_BUSCA_S = 3;
const SENHA = 'Carga@Orbita2026';
const TERMO = 'cliente';

const janelaInicio = new Gauge('janela_inicio_ms');
const janelaFim = new Gauge('janela_fim_ms');

export const options = {
  // Setup: 11 cadastros (Argon2) + 10 importações pequenas. Folga para a rodada sem mitigação também.
  setupTimeout: '3m',
  scenarios: {
    barulhento: {
      executor: 'per-vu-iterations',
      exec: 'barulhento',
      vus: IMPORTACOES,
      iterations: 1,
      maxDuration: '5m',
      tags: { cenario: 'barulhento' },
    },
    observadores: {
      executor: 'per-vu-iterations',
      exec: 'observadores',
      vus: OBSERVADORES,
      iterations: 1, // uma iteração longa por VU: o laço de buscas fica dentro dela
      maxDuration: `${DURACAO_S + 60}s`,
      tags: { cenario: 'observadores' },
    },
  },
  thresholds: {
    'http_req_duration{cenario:observadores}': ['p(95)<800', 'max<2000'],
    'http_req_failed{cenario:observadores}': ['rate==0'],
  },
};

const json = (token) => ({ headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const auth = (token, extra = {}) => ({ headers: { Authorization: `Bearer ${token}`, ...extra } });

function cadastrar(papel, plano) {
  const email = `${papel}-${RODADA}@carga.orbitati.dev`;
  const r = http.post(`${API}/auth/cadastro`, JSON.stringify({ empresa: `Carga ${papel}`, plano, nome: `Carga ${papel}`, email, senha: SENHA }), json());
  if (r.status !== 201) fail(`cadastro ${papel}: HTTP ${r.status} ${r.body}`);
  return r.json('token');
}

function importar(token, csv) {
  const r = http.post(`${API}/importacoes`, csv, auth(token, { 'Content-Type': 'text/csv; charset=utf-8' }));
  return { status: r.status, id: r.status === 202 ? r.json('importacao_id') : null, corpo: r.body };
}

const statusImportacao = (token, id) => {
  const r = http.get(`${API}/importacoes/${id}`, auth(token));
  return r.status === 200 ? r.json('status') : `http_${r.status}`;
};

export function setup() {
  const barulhento = cadastrar('barulhento', 'equipe');
  const observadores = [];
  const pendentes = [];
  for (let k = 1; k <= OBSERVADORES; k++) {
    const token = cadastrar(`observador${k}`, 'individual');
    const linhas = ['nome,email'];
    for (let n = 1; n <= CONTATOS_POR_OBSERVADOR; n++) {
      const nn = String(n).padStart(2, '0');
      linhas.push(`Cliente ${nn} Obs${k},cliente${nn}@obs${k}.carga.orbitati.dev`);
    }
    const imp = importar(token, linhas.join('\n') + '\n');
    if (imp.status !== 202) fail(`importação do observador ${k}: HTTP ${imp.status} ${imp.corpo}`);
    observadores.push(token);
    pendentes.push({ k, token, id: imp.id });
  }
  // Os cenários só começam com os 500 contatos gravados: senão a primeira busca acharia a tabela vazia.
  const limite = Date.now() + 120_000;
  while (pendentes.length) {
    if (Date.now() > limite) fail(`importações dos observadores não terminaram: ${pendentes.map((p) => p.k).join(', ')}`);
    for (let i = pendentes.length - 1; i >= 0; i--) {
      const s = statusImportacao(pendentes[i].token, pendentes[i].id);
      if (s === 'concluida') pendentes.splice(i, 1);
      else if (s !== 'na_fila' && s !== 'processando') fail(`importação do observador ${pendentes[i].k}: ${s}`);
    }
    if (pendentes.length) sleep(1);
  }
  console.log(`SETUP rodada=${RODADA} observadores=${OBSERVADORES}x${CONTATOS_POR_OBSERVADOR} linhas=${LINHAS}`);
  return { barulhento, observadores };
}

export function barulhento(dados) {
  const i = exec.scenario.iterationInTest; // 0, 1, 2: uma importação por VU
  const numero = String(i + 1);
  sleep(i * INTERVALO_IMPORTACOES_S);

  const linhas = ['nome,email'];
  for (let n = 1; n <= LINHAS; n++) {
    const nnnn = String(n).padStart(4, '0');
    linhas.push(`Carga ${nnnn},c${nnnn}-i${numero}@carga.orbitati.dev`);
  }

  const inicio = Date.now();
  janelaInicio.add(inicio, { importacao: numero });
  const imp = importar(dados.barulhento, linhas.join('\n') + '\n');
  let status = imp.status === 202 ? 'na_fila' : `post_http_${imp.status}`;
  if (imp.status !== 202) console.error(`importação ${numero}: HTTP ${imp.status} ${imp.corpo}`);

  const limite = inicio + 4 * 60_000;
  while (imp.id && status !== 'concluida' && status !== 'falhou') {
    if (Date.now() > limite) { status = 'tempo_esgotado'; break; }
    sleep(1);
    status = statusImportacao(dados.barulhento, imp.id);
  }
  const fim = Date.now();
  janelaFim.add(fim, { importacao: numero, status });
  console.log(`JANELA ${numero} ${inicio} ${fim} ${status}`);
}

export function observadores(dados) {
  const k = exec.scenario.iterationInTest; // 0 a 9: um observador por VU, sem repetir tenant
  const token = dados.observadores[k];
  // Defasagem de 0,3 s entre os VUs: 10 usuários reais não buscam todos no mesmo milissegundo.
  sleep((k * INTERVALO_BUSCA_S) / OBSERVADORES);
  const fim = Date.now() + DURACAO_S * 1000 - (k * INTERVALO_BUSCA_S * 1000) / OBSERVADORES;
  while (Date.now() < fim) {
    const t = Date.now();
    const r = http.get(`${API}/contatos?busca=${TERMO}`, { ...auth(token), tags: { name: 'GET /contatos?busca' } });
    check(r, { 'busca 200': (x) => x.status === 200 });
    // "A cada 3 s" de verdade: dorme só o que falta. Com sleep(3) fixo, a busca lenta reduziria o n.
    sleep(Math.max(0, INTERVALO_BUSCA_S - (Date.now() - t) / 1000));
  }
}

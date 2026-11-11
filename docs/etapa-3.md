# Etapa 3 — checklist de evidências

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen
**Atualizado em:** 10/11/2026 (Bloco 15)

## De onde vêm os itens

O enunciado oficial da Etapa 3 não está no repositório. Os itens abaixo foram montados a partir de três
fontes, e cada item diz de qual veio:

- **[README]**: o resumo da Etapa 3 no calendário do [`README.md`](../README.md#calendário-do-projeto-integrador):
  "Qualidade e testes", com entrega em 12/11/2026 e peso de 25%.
- **[Plano]**: o critério de pronto da Etapa 3 em [`plano-de-testes.md`](plano-de-testes.md), seção 4 (blocos 8 a 11).
- **[Blocos]**: o que os roteiros `prompts/bloco-08.md` a `prompts/bloco-11.md` pedem.

Os itens marcados **[complemento]** não aparecem em nenhuma das três fontes. Eles estão aqui porque
sustentam os itens exigidos e respondem a perguntas prováveis da avaliação, como "o número vale fora do seu
notebook?".

Legenda: ✅ feito, com evidência · ⏳ pendente (onde está registrado) · ⚠️ feito, com limitação declarada.

---

## 1. Tudo da Etapa 2 rodando no CI [Plano] [Bloco 8]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 1.1 | Workflow em todo push e pull request, com a stack do compose e `npm test` | ✅ | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), job `api`: `docker compose up -d --build --wait`, `npm test` com `TESTES_LENTOS=1` e o seed duas vezes (a 2ª com `--sem-mudancas`) |
| 1.2 | Job do Portal: unitários, build e E2E contra o simulador | ✅ | Job `web` do `ci.yml` |
| 1.3 | Badge do workflow no README | ✅ | Topo do [`README.md`](../README.md) |
| 1.4 | Testes independentes de execuções anteriores (tenants e e-mails únicos por teste) | ✅ | [`tests/apoio/api.js`](../tests/apoio/api.js); o CI roda numa stack nova a cada vez |
| 1.5 | **T-ISO-14**: uma rota com `tenant_id` deixa o CI vermelho | ✅ | Demonstrado em 08/11/2026. A rota proibida foi barrada por **duas** verificações independentes (T-ISO-13 e T-ISO-15). Execução e detalhes na linha T-ISO-14 do [`plano-de-testes.md`](plano-de-testes.md) |
| 1.6 | O merge fica bloqueado com o CI vermelho | ✅ | Ruleset do `main` com os checks `api` e `web` obrigatórios e PR obrigatório, ativo desde 08/11/2026 e testado no PR #12 ([`README.md`](../README.md), seção do CI) |

## 2. Cenários de qualidade medidos [Plano] [Blocos 9 a 11]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 2.1 | **CQ-01**, vizinho barulhento: p95 das buscas de outros tenants < 800 ms durante importação de 500+ (**T-CQ01-01**) | ✅ | [`ensaios/cq01-2026-11-08.md`](ensaios/cq01-2026-11-08.md): com o Postgres do tamanho de produção (1 vCPU, 2 GB), **p95 = 5,1 ms** e máximo de 7,7 ms na janela da importação (n = 216), com 0 falhas. Scripts em [`tests/carga/`](../tests/carga/) e [`scripts/medir-cq01.ps1`](../scripts/medir-cq01.ps1) |
| 2.2 | CQ-01 sem a mitigação (**T-CQ01-02**, só registro) | ✅ | Mesmo relatório: **sem diferença medível** (máximo de 5,6 ms sem e 7,7 ms com). Virou gatilho de revisão no [ADR-003](adr/adr-003-processamento-assincrono.md#gatilhos-de-revisão) |
| 2.3 | **CQ-03**, onboarding: p90 < 45 s do formulário ao e-mail entregue (**T-CQ03-01**) | ⚠️ | [`ensaios/cq03-2026-11-08.md`](ensaios/cq03-2026-11-08.md): p90 = **0,16 s** em 20 cadastros, com 0 ações manuais. **Limitação (L4):** sem um provedor real de e-mail, que é 96% do orçamento. Ficou fora do escopo pela [D-15.1](pendencias-bloco-7.md) |
| 2.4 | **T-RES-06**: o cadastro conclui com a fila de e-mail fora | ✅ | Unitário em [`services/api-contatos/test/confirmacao.test.js`](../services/api-contatos/test/confirmacao.test.js), mais o ensaio na [`demo-degradacao.ps1`](../scripts/demo-degradacao.ps1) (08/11/2026: 201 em 33 ms, aviso no log, 0 e-mails) |
| 2.5 | **CQ-04**, disponibilidade ≥ 99,5% (**T-CQ04-01**) | ⚠️ | [`ensaios/cq04-2026-11-09.md`](ensaios/cq04-2026-11-09.md): **240/240** amostras, 100%. **Limitação (L2):** o ensaio prova o método, não o mês. Pela regra de três, 0 falhas em 240 amostras só garantem ≥ 98,75% |
| 2.6 | **T-CQ04-02**: deploy sem parada | ✅ | API: T-CQ04-02 de 08/11 (bloco 6). Portal: [`ensaios/cq04-02-web-2026-11-09.md`](ensaios/cq04-02-web-2026-11-09.md). Sem o `preStop`, 4 de 4 rodadas tiveram falhas; com ele, 1.195/1.195 depois da correção da anomalia |
| 2.7 | **CQ-05**, restauração: RTO ≤ 4 h (**T-CQ05-01 a 03**) | ⚠️ | [`ensaios/cq05-2026-11-08.md`](ensaios/cq05-2026-11-08.md): restaurar e verificar levou **4,0 s**, com 18/18 verificações; a restauração de um tenant foi feita de ponta a ponta. **Limitação (L3):** o RPO de 15 min depende de arquivamento de WAL, que não existe no Postgres local |
| 2.8 | O resultado de cada cenário está no documento dos atributos | ✅ | Seção "Resultado medido" de cada CQ em [`atributos.md`](atributos.md) (revisão de 10/11) |

## 3. O que foi construído para medir [Blocos 9 a 11]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 3.1 | Carga com k6 e veredito calculado na janela da importação | ✅ | [`tests/carga/cq01.js`](../tests/carga/cq01.js), [`janelas.js`](../tests/carga/janelas.js) (com teste próprio) e os resultados em [`tests/carga/resultados/`](../tests/carga/resultados/) |
| 3.2 | Serviço de Notificações (fila `emails`, Mailpit) | ✅ | [`services/notificacoes/`](../services/notificacoes/); [ADR-004](adr/adr-004-comunicacao-entre-servicos.md) |
| 3.3 | Backup, ensaio de restauração e restauração de um tenant | ✅ | [`scripts/backup.ps1`](../scripts/backup.ps1), [`ensaio-restauracao.ps1`](../scripts/ensaio-restauracao.ps1) e [`restaurar-um-tenant.ps1`](../scripts/restaurar-um-tenant.ps1) |
| 3.4 | Sonda de disponibilidade | ✅ | [`scripts/sonda.ps1`](../scripts/sonda.ps1), com 15 s por 60 min = 240 amostras (a conta está no [`plano-de-testes.md`](plano-de-testes.md)) |

## 4. O que sustenta os números [complemento]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 4.1 | Máquina e configuração registradas em cada ensaio | ✅ | Seção "Máquina" dos relatórios do CQ-01, CQ-03, CQ-04 e CQ-05 em [`ensaios/`](ensaios/) e `maquina.txt` em [`tests/carga/resultados/`](../tests/carga/resultados/) |
| 4.2 | O que cada ensaio **não** prova está escrito no próprio relatório | ✅ | As ressalvas no topo do CQ-03, do CQ-04 e do CQ-05; as lacunas L2 a L4 na seção 3.5 do [`plano-de-testes.md`](plano-de-testes.md) |
| 4.3 | Uma medição que contrariou a decisão virou gatilho, e não foi escondida | ✅ | CQ-01 sem diferença → [ADR-003, "Gatilhos de revisão"](adr/adr-003-processamento-assincrono.md#gatilhos-de-revisão) |
| 4.4 | Os scripts usam `127.0.0.1` (achado O1: no Windows, `localhost` tenta IPv6 primeiro e soma ~2 s) | ✅ | [`pendencias-bloco-7.md`](pendencias-bloco-7.md), O1 |

## 5. O que não faz parte da Etapa 3 (e onde está registrado)

| Item | Estado | Onde está registrado |
|---|---|---|
| Medir o CQ-03 com um provedor real de e-mail | Fora do escopo ([D-15.1](pendencias-bloco-7.md)) | L4 no [`plano-de-testes.md`](plano-de-testes.md); N4 em [`pendencias-bloco-7.md`](pendencias-bloco-7.md) |
| CQ-04 medido ao longo de um mês | Limitação declarada (L2) | [`ensaios/cq04-2026-11-09.md`](ensaios/cq04-2026-11-09.md) |
| RPO de 15 min | Limitação declarada (L3) | [`ensaios/cq05-2026-11-08.md`](ensaios/cq05-2026-11-08.md) |
| CQ-01 num Postgres gerenciado, com disco de rede | Gatilho de revisão | [ADR-003](adr/adr-003-processamento-assincrono.md#gatilhos-de-revisão) |

## Roteiro curto da demonstração

O roteiro completo da defesa, com plano B para cada passo, está em [`roteiro-defesa.md`](roteiro-defesa.md).
Para a Etapa 3 em particular:

1. Mostrar o CI verde no GitHub (ou a captura de tela) e o T-ISO-14 vermelho na linha do
   [`plano-de-testes.md`](plano-de-testes.md).
2. Abrir o relatório do CQ-01 e ler o veredito e a ressalva "a mitigação não fez diferença medível".
3. Rodar `npx vitest run tests/cq03-onboarding.test.js`: ele imprime p50, p90 e máximo, e o e-mail aparece
   em http://127.0.0.1:8025.
4. Abrir o relatório do CQ-05 e mostrar os 4,0 s contra o RTO de 4 h, com a ressalva do RPO.

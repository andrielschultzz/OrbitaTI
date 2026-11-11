# Uso de IA no OrbitaTI

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen · **Atualizado em:** 10/11/2026 (Bloco 15)

**Como este documento foi montado:** a partir do histórico do git. A linha
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` no fim de um commit marca o trabalho feito com o
Claude Code. O comando usado:

```
git log --no-merges --format='%h|%ad|%an|%s|%(trailers:key=Co-Authored-By,valueonly)' --date=short
```

O que o histórico não mostra (o que a equipe pensou, testou à mão, aceitou ou recusou numa conversa) está
marcado com **TODO**, para a equipe preencher com a própria experiência. Nada aqui foi inventado: onde não
há evidência no repositório, há TODO.

---

## 1. Ferramentas

| Ferramenta | Para quê | Evidência |
|---|---|---|
| **Claude Code** (CLI, modelo Claude Opus 5.5, segundo a linha de coautoria) | Escrever código, testes, scripts e documentos, um bloco por vez, a partir dos roteiros em `prompts/` | 16 dos 40 commits sem merge têm a linha `Co-Authored-By`; o kit em `CLAUDE.md`, `.claude/settings.json` e `prompts/` |
| TODO: outras ferramentas de IA usadas (chat no navegador, autocompletar na IDE, geração de imagem para o design system?) | TODO | TODO. O repositório não registra |

## 2. Como a IA foi controlada (o "kit")

Montado no commit `fdae5c7` (29/10/2026, "Kit do Claude Code, prompts dos blocos e pendências de
documentação"), e atualizado a cada bloco:

- **[`CLAUDE.md`](../CLAUDE.md)**: as regras que a IA lê em toda sessão.
  - As regras de multi-tenancy "inegociáveis".
  - A tabela de números (não inventar outros).
  - "Se uma tarefa exigir contrariar um ADR, pare e pergunte."
  - "Antes de codar algo não trivial, apresente um plano curto e espere aprovação."
  - "Não faça `git push`; quem commita é o aluno."
  - Responder em português e explicar o porquê, para a equipe poder defender oralmente.
- **[`.claude/settings.json`](../.claude/settings.json)**: as permissões.
  - **Liberado:** testes, `docker compose`, `git status`/`diff`/`log` e `kubectl get`/`describe`/`logs`.
  - **Proibido:** `git push`, `git reset --hard`, `docker compose down -v` (apaga os dados),
    `kubectl delete namespace`/`pvc`, e ler o `.env` (segredos).
- **`prompts/bloco-00.md` a `bloco-15.md`**: um roteiro por bloco, cada um com objetivo, lista do que fazer e
  "Pronto quando". O bloco 0 só pede leitura: "confirme que entendeu o projeto antes de escrever qualquer
  código" e liste as contradições entre o `CLAUDE.md` e os docs.
- **Revisão humana antes do merge:** cada bloco virou um PR (#4 a #18), e o merge só passa com o CI verde
  (ruleset do `main` desde 08/11/2026). TODO: quem revisou cada PR, e o que a revisão olhava.

## 3. O que foi feito com IA, segundo o histórico

| Período | Commits | Linha de coautoria? | O que é |
|---|---|---|---|
| 24/09 a 26/09 | `60b28b0`, `11eeeb4`, `1789dcb` | Não | Etapa 1: proposta de arquitetura e README. TODO: a IA foi usada aqui? Em quê? |
| 15/10 a 18/10 | `4d95282` a `83c74ea` (8 commits, incluindo os de Cristofer Rutzen) | Não | Registros do Encontro 11, editados pela interface do GitHub. TODO: confirmar se houve IA |
| 29/10 | `fdae5c7`, `c869cc2` | Não | Kit do Claude Code e plano de testes. TODO: o plano foi rascunhado pela IA e decidido pela equipe? O arquivo [`prompts/decisoes-plano-de-testes.md`](../prompts/decisoes-plano-de-testes.md) sugere que sim (seção 4) |
| 07/11 | `c2d65ee`, `5defa9f`, `bb4929c` a `f0e6774` (Bloco 13, fases 1 a 7) e `6244890` (Bloco 1) | **Não** | Contrato da API, Portal Web inteiro e banco com RLS. **Atenção:** a falta da linha não prova que não houve IA. Existem roteiros para esses blocos em `prompts/` (`bloco-01.md`, `bloco-13.md`), escritos para o Claude Code. TODO: confirmar como esses commits foram feitos e por que ficaram sem a linha |
| 08/11 a 10/11 | `6429b7d` (Bloco 2) a `32786f1` (Bloco 14), 16 commits | **Sim** | Blocos 2 a 12, 13 (Fase 6) e 14: API, isolamento, importação, rate limit, kind, ADR-004 e revisão dos docs, CI, CQ-01, notificações e CQ-03, backup e sonda, interações, Portal na API real, LGPD |
| 10/11 | Bloco 15 (este) | A definir no commit | Revisão docs × código, D-15.1, correção do B12 e os documentos de entrega. Feito com o Claude Code |

**Quem commitou:** todos os commits com a linha de coautoria são do Andriel. Os do Cristofer são os
registros do Encontro 11. TODO: como a dupla dividiu o trabalho e quem conduziu cada sessão com a IA.

## 4. Aceito, rejeitado e corrigido

### 4.1 O que o repositório registra

| O quê | Quem decidiu | Evidência |
|---|---|---|
| A IA, no Bloco 0, listou **12 contradições** (C1 a C12) entre o `CLAUDE.md` e os docs da Etapa 1. A equipe decidiu cada uma, e os docs foram corrigidos no Bloco 7 | A equipe | [`pendencias-bloco-7.md`](pendencias-bloco-7.md), tabela do topo |
| Sobre o plano de testes, a equipe **aceitou** algumas propostas da IA e **decidiu** as lacunas como limitação declarada, sem aceitar promessas que o ensaio não sustenta. Aceitas: `/saude` com 200 + `fila: fora`, o veredito do CQ-01 pela janela, os casos novos 413/429/T-ISO-15 e o log `recurso_nao_encontrado`. Declaradas: RPO e mês do CQ-04 | A equipe | [`prompts/decisoes-plano-de-testes.md`](../prompts/decisoes-plano-de-testes.md), itens 1 a 9 |
| O intervalo de 5 min entre importações (ADR-003) foi **substituído** pelo lote, pela pausa e pela `concurrency: 2` | A equipe (decisão D2) | Nota de revisão de 08/11 no [ADR-003](adr/adr-003-processamento-assincrono.md); ADR-004 |
| Os testes pegaram erros reais no código (TODO: confirmar se era código escrito pela IA). Um exemplo é a função de login aberta a todos os papéis (B6, pego pelo T-RLS-19); a correção fez o `migrate.js` falhar em qualquer WARNING. Outro é a API caindo com o banco (K7, achado no kind) | Os testes; a correção foi revisada pela equipe | [`roteiro-defesa.md`](roteiro-defesa.md), seção "Achados"; [`pendencias-bloco-7.md`](pendencias-bloco-7.md), B6 e K7 |
| No CQ-01, a medição contrariou a expectativa (a mitigação não fez diferença). O resultado foi **registrado como gatilho**, em vez de ajustar o ensaio até "dar certo" | A equipe | [`ensaios/cq01-2026-11-08.md`](ensaios/cq01-2026-11-08.md); ADR-003 |
| **Bloco 15:** antes de mudar qualquer doc, a IA listou as divergências entre docs e código, e a equipe aprovou a lista. A equipe também **restringiu** o pedido em três pontos: (1) não editar a `001_base.sql`, nem comentário, porque a trava de hash do `migrate.js` recusaria rodar em todo banco que já tem a migração; (2) a única mudança de código seria o B12, com um E2E de `a@b`; (3) a decisão D-15.1 (apresentação local) | A equipe | Seção 13 de [`pendencias-bloco-7.md`](pendencias-bloco-7.md); [`portal-pendencias.md`](portal-pendencias.md), B12 |
| **Bloco 15:** uma premissa errada da IA foi corrigida na revisão. Ela tinha dito que a exportação LGPD era "limitada pelo plano", mas o `planos.js` não limita o total de contatos. A nota no ADR-003 ficou com o que o código faz | Conferência no código | Nota de 10/11 no [ADR-003](adr/adr-003-processamento-assincrono.md) |

### 4.2 O que só a equipe sabe (preencher)

- TODO: uma sugestão da IA que a equipe **rejeitou**, e por quê.
- TODO: um código gerado que estava **errado** e que a equipe pegou na revisão, antes do teste.
- TODO: um ponto em que a IA **inventou** algo (número, API, opção de biblioteca) e como foi percebido. Por
  exemplo, se o `CLAUDE.md` precisou ganhar a regra "não invente números" por causa disso.
- TODO: o que a equipe **escreveu sem IA**, como os registros dos encontros, as decisões das lacunas e os
  ADRs da Etapa 1.
- TODO: quanto tempo cada bloco levou e onde a IA mais ajudou ou mais atrapalhou.
- TODO: o que a equipe faria diferente no uso da IA num próximo projeto.

## 5. O que a equipe precisa conseguir defender sem a IA

A banca pode perguntar qualquer linha do código. Os pontos mais prováveis, com onde estudar:

- Por que pool + RLS e não um banco por tenant ([ADR-001](adr/adr-001-tenancy.md)).
- Por que o tenant vem só do JWT ([ADR-002](adr/adr-002-identidade-tenant.md)) e como o `withTenant` funciona
  (`services/api-contatos/src/db.js`).
- Por que `NULLIF` na política e `set_config(..., true)` em vez de `SET LOCAL` (regras 2 e 3 do `CLAUDE.md`).
- Por que 404 e não 403, e por que a FK das interações é composta.
- As contas dos números: 5.000 linhas, 60 × usuários req/min, 240 amostras da sonda e o RTO de 4 h.
- O que cada ensaio **não** prova (as ressalvas dos relatórios em [`ensaios/`](ensaios/)).

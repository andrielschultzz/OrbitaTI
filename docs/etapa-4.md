# Etapa 4 — checklist de evidências

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen
**Atualizado em:** 10/11/2026 (Bloco 15)

## De onde vêm os itens

O enunciado oficial da Etapa 4 não está no repositório. Os itens abaixo foram montados a partir de três
fontes, e cada item diz de qual veio:

- **[README]**: o resumo da Etapa 4 no calendário do [`README.md`](../README.md#calendário-do-projeto-integrador):
  "Produto integrado + defesa", com entrega em 03/12/2026, defesa em 17/12 e peso de 30%.
- **[Plano]**: o critério de pronto da Etapa 4 em [`plano-de-testes.md`](plano-de-testes.md), seção 4 (blocos 12 a 15).
- **[Blocos]**: o que os roteiros `prompts/bloco-12.md` a `prompts/bloco-15.md` pedem.

Os itens marcados **[complemento]** não aparecem em nenhuma das três fontes. Eles estão aqui porque
sustentam os itens exigidos e respondem a perguntas prováveis da defesa.

Legenda: ✅ feito, com evidência · ⏳ pendente (onde está registrado) · ⚠️ feito, com limitação declarada.

**Decisão do Bloco 15 ([D-15.1](pendencias-bloco-7.md)):** a apresentação roda localmente, no notebook.
Publicar numa VM ficou fora do escopo, e o que dependia da VM (HTTPS, SMTP real, versões bash dos scripts)
está marcado como "fora do escopo" nos documentos, sem apagar o histórico.

---

## 1. O produto: interações e contatos esfriando [Plano] [Bloco 12]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 1.1 | Interações por contato, com RLS | ✅ | [`db/migrations/003_interacoes.sql`](../db/migrations/003_interacoes.sql); [`rotas/interacoes.js`](../services/api-contatos/src/rotas/interacoes.js) |
| 1.2 | Registrar uma interação atualiza o contato, e uma interação antiga não volta no tempo (**T-PROD-01**) | ✅ | [`tests/interacoes.test.js`](../tests/interacoes.test.js) |
| 1.3 | "Saindo de órbita": contatos esfriando, sem lotar o painel depois de uma importação (**T-PROD-02**) | ✅ | Mesmo arquivo; regra em [`contrato-api.md`](contrato-api.md) |
| 1.4 | Valores fora do domínio dão 400 (**T-PROD-03**) | ✅ | Mesmo arquivo |
| 1.5 | Rotas novas na suíte de isolamento (**T-ISO-16 e 17**) | ✅ | [`tests/isolamento.test.js`](../tests/isolamento.test.js) |
| 1.6 | A interação não aponta para um contato de outro tenant, mesmo com a FK ignorando o RLS (**T-RLS-20**) | ✅ | FK composta em [`003_interacoes.sql`](../db/migrations/003_interacoes.sql); [`tests/rls.test.js`](../tests/rls.test.js) |
| 1.7 | O T-RLS-15 continua verde com a tabela `interacoes` | ✅ | [`tests/rls.test.js`](../tests/rls.test.js) (toda tabela com `tenant_id` tem `ENABLE` + `FORCE`) |

## 2. O Portal Web integrado [Plano] [Bloco 13]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 2.1 | Portal ligado na API real, no compose (8080) e no kind (NodePort 30080, 2 réplicas) | ✅ | [`docker-compose.yml`](../docker-compose.yml) (serviço `web`); [`deploy/k8s/70-web.yaml`](../deploy/k8s/70-web.yaml) |
| 2.2 | Contrato primeiro: o Portal construído contra o simulador passou na API real sem divergência | ✅ | 33/33 E2E na Fase 6 (09/11); em 10/11 foram 36/36 contra o simulador e 36/36 contra o compose ([`portal-pendencias.md`](portal-pendencias.md)) |
| 2.3 | **T-WEB-01**: nenhuma requisição do navegador leva o tenant | ✅ | [`web/e2e/fluxo.spec.js`](../web/e2e/fluxo.spec.js) |
| 2.4 | **T-WEB-02 a 09** contra a stack real | ✅ | Mapa ID → arquivo na seção 3.6 do [`plano-de-testes.md`](plano-de-testes.md). O CI roda o E2E contra a API real no job `api`. Capturas (T-WEB-08) e Lighthouse (T-WEB-09) rodam à mão |
| 2.5 | Lighthouse mobile dentro das metas (acessibilidade e boas práticas ≥ 95, desempenho ≥ 90) | ✅ | [`ensaios/portal-lighthouse-2026-11-09.md`](ensaios/portal-lighthouse-2026-11-09.md): desempenho de 92 a 98, acessibilidade, boas práticas e SEO 100 em `/entrar` e `/contatos`, com o JS inicial em 103 a 112 KB gzip |
| 2.6 | Login com e-mail malformado destaca o campo (B12, Bloco 15) | ✅ | [`web/e2e/sessao.spec.js`](../web/e2e/sessao.spec.js); [`portal-pendencias.md`](portal-pendencias.md), seção B12 |

## 3. LGPD: exportação, cancelamento e exclusão [Plano] [Bloco 14]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 3.1 | Exportação só para admin e sem `senha_hash` (**T-LGPD-01**) | ✅ | [`tests/lgpd.test.js`](../tests/lgpd.test.js); [`rotas/conta.js`](../services/api-contatos/src/rotas/conta.js) |
| 3.2 | Tenant cancelado não entra (**T-LGPD-02**) | ✅ | [`tests/lgpd.test.js`](../tests/lgpd.test.js); pela tela, [`web/e2e/conta.spec.js`](../web/e2e/conta.spec.js) |
| 3.3 | Exclusão depois de 30 dias, só de quem deve, nos dois schemas (**T-LGPD-03**) | ✅ | [`tests/lgpd.test.js`](../tests/lgpd.test.js); [`src/exclusao.js`](../services/api-contatos/src/exclusao.js); worker em [`services/importacao/src/worker.js`](../services/importacao/src/worker.js) |
| 3.4 | Link de exportação por 30 dias (**T-LGPD-04**) e pedido de novo com a fila fora (**T-LGPD-05**) | ✅ | [`tests/lgpd.test.js`](../tests/lgpd.test.js) |
| 3.5 | A exportação só traz o próprio tenant (**T-ISO-18**) e a função de exclusão está fechada (**T-RLS-21**) | ✅ | [`tests/lgpd.test.js`](../tests/lgpd.test.js); [`tests/rls.test.js`](../tests/rls.test.js) |
| 3.6 | Esboço do contrato de operador (DPA) | ✅ | [`dpa-esboco.md`](dpa-esboco.md), cláusula por cláusula, com onde cada uma se cumpre |
| 3.7 | `lgpd.md` reflete o estado real | ⚠️ | [`lgpd.md`](lgpd.md), revisão de 10/11. São pendências declaradas: o aviso no campo de notas e a correção dos dados do usuário. TLS, criptografia em repouso e retenção de logs ficaram fora do escopo (D-15.1) |

## 4. Entrega e defesa [Bloco 15]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 4.1 | Documentos conferidos contra o código, com as divergências corrigidas | ✅ | Notas de revisão de 10/11/2026 nos ADRs, no C4, no contrato (versão 1.7), em `atributos`, `lgpd`, `dpa`, `plano-de-testes`, `etapa-2`, `portal-pendencias` e `README`. Cada nota diz o que mudou e por quê. A decisão D-15.1 e a nota sobre os comentários do banco estão na seção 13 de [`pendencias-bloco-7.md`](pendencias-bloco-7.md) |
| 4.2 | C4 no estado final | ✅ | [`02-arquitetura-c4.md`](02-arquitetura-c4.md), seção "Estado final" |
| 4.3 | README: como rodar, testar, fazer o deploy e onde está cada evidência | ✅ | [`README.md`](../README.md), seção "Onde está cada evidência por etapa" |
| 4.4 | Uso de IA documentado | ⏳ | [`uso-de-ia.md`](uso-de-ia.md): a base vem do histórico de commits, e os TODOs são para a equipe preencher com a própria experiência |
| 4.5 | Roteiro da demo de 10 minutos, com plano B | ✅ | [`roteiro-defesa.md`](roteiro-defesa.md) |
| 4.6 | Ensaio completo sem Wi-Fi | ⏳ | Checklist da véspera no [`roteiro-defesa.md`](roteiro-defesa.md). Os tempos de cada passo ficam anotados lá |

## 5. O que sustenta a defesa [complemento]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 5.1 | Achados que mostram que os testes pegam erro de verdade | ✅ | [`roteiro-defesa.md`](roteiro-defesa.md), seção "Achados": B6, T-RLS-20, CVE do `trustProxy`, K7, CQ-01, contrato primeiro e `rollout status` |
| 5.2 | Nenhum teste de isolamento vermelho ou desativado (regra do plano para qualquer etapa) | ✅ | `npm test` no CI (job `api`) |

## 6. O que não faz parte da entrega (e onde está registrado)

| Item | Estado | Onde está registrado |
|---|---|---|
| Publicar numa VM, com HTTPS e SMTP real | Fora do escopo ([D-15.1](pendencias-bloco-7.md)) | Seção 13 de [`pendencias-bloco-7.md`](pendencias-bloco-7.md); [`portal-pendencias.md`](portal-pendencias.md) |
| Convite de usuários (o plano Equipe tem só o admin no semestre) | Fora do escopo do semestre | [`01-visao-produto.md`](01-visao-produto.md) |
| Gerador de Documentos (PDF), S3 | Fora do escopo / adiado | L8 no [`plano-de-testes.md`](plano-de-testes.md); [ADR-004](adr/adr-004-comunicacao-entre-servicos.md) |
| Prioridade por plano na fila | Aberta (L6) | [`plano-de-testes.md`](plano-de-testes.md), seção 3.5 |
| `maxmemory` + `noeviction` no Redis do kind, "faxineiro" de importações presas e histórico de execução | Pendências de código P-1 a P-3 | [ADR-004](adr/adr-004-comunicacao-entre-servicos.md) |
| Tempo da exportação LGPD (exceção à regra dos 50 registros) | Não medido (TODO) | Nota de 10/11 no [ADR-003](adr/adr-003-processamento-assincrono.md) |

## Roteiro da demonstração

Está em [`roteiro-defesa.md`](roteiro-defesa.md): o Portal e as demos no compose, o deploy no kind, o plano
B de cada passo e o checklist da véspera.

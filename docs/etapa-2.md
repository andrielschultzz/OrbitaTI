# Etapa 2 — checklist de evidências

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen
**Atualizado em:** 08/11/2026 (Bloco 7)

## De onde vêm os itens

O enunciado oficial da Etapa 2 não está no repositório. Os itens abaixo foram montados a partir de duas
fontes, e cada item diz de qual veio:

- **[README]**: o resumo da Etapa 2 no calendário do [`README.md`](../README.md): "Núcleo multi-tenant — 2+
  serviços, isolamento ao vivo", com entrega em 15/10/2026 e peso de 25%.
- **[Bloco 7]**: o que o roteiro `prompts/bloco-07.md` pede para documentar a Etapa 2.

Os itens marcados **[complemento]** não aparecem em nenhuma das duas fontes. Eles estão aqui porque sustentam
os itens exigidos e respondem perguntas prováveis da avaliação ("e se um serviço cair?", "e se o job rodar
duas vezes?").

Legenda: ✅ feito, com evidência · ⏳ pendente (onde e quando está registrado).

---

## 1. Núcleo multi-tenant com 2 ou mais serviços [README]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 1.1 | Dois serviços independentes, cada um com imagem e processo próprios | ✅ | [`services/api-contatos/`](../services/api-contatos/) e [`services/importacao/`](../services/importacao/); `docker-compose.yml` (serviços `api-contatos` e `importacao`) |
| 1.2 | Cada serviço com o seu dado (banco por serviço, no mesmo PostgreSQL) | ✅ | Schemas `orbita` e `importacao` com papéis separados (`api_contatos`, `importacao_svc`): [`db/migrations/`](../db/migrations/), [`db/init/`](../db/init/). O papel da Importação não tem GRANT em `orbita`: T-RLS-07 em [`tests/rls.test.js`](../tests/rls.test.js) |
| 1.3 | Comunicação entre os serviços | ✅ | Fila BullMQ (API → Importação) e rotas `/interno` com token de serviço (Importação → API): [ADR-004](adr/adr-004-comunicacao-entre-servicos.md), seção 8 de [`contrato-api.md`](contrato-api.md) |
| 1.4 | O tenant vem só do JWT, nunca de parâmetro | ✅ | T-ISO-13 (varre as rotas) e T-ISO-06/07 em [`tests/isolamento.test.js`](../tests/isolamento.test.js); [ADR-002](adr/adr-002-identidade-tenant.md) |
| 1.5 | O tenant atravessa os dois serviços | ✅ | JWT → payload do job → claim do token de serviço: T-ISO-09, T-OBS-02 ([`tests/observabilidade.test.js`](../tests/observabilidade.test.js)) |
| 1.6 | Isolamento garantido pelo banco (RLS `ENABLE` + `FORCE` + `NULLIF`) | ✅ | [`db/migrations/001_base.sql`](../db/migrations/001_base.sql); T-RLS-01 a T-RLS-19 em [`tests/rls.test.js`](../tests/rls.test.js); [ADR-001](adr/adr-001-tenancy.md) |
| 1.7 | Roda com um comando | ✅ | `docker compose up -d --build --wait` ([README, "Como rodar"](../README.md#como-rodar)) |

## 2. Isolamento demonstrado ao vivo [README]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 2.1 | Demonstração ao vivo: um tenant tenta ler, alterar e excluir o dado do outro | ✅ | [`scripts/demo-isolamento.ps1`](../scripts/demo-isolamento.ps1) (compose; no kind, pelo Portal, com `-BaseUrl http://127.0.0.1:30080/api`), com os tenants do `npm run seed` |
| 2.2 | 100% das tentativas cruzadas → 404, com o mesmo corpo de "não existe" (CQ-02) | ✅ | T-ISO-01 a T-ISO-05 e T-ISO-08 em [`tests/isolamento.test.js`](../tests/isolamento.test.js); CQ-02 em [`atributos.md`](atributos.md#cq-02) |
| 2.3 | O 404 deixa rastro no log | ✅ | Evento `recurso_nao_encontrado` (T-ISO-19); `docker compose logs api-contatos \| Select-String recurso_nao_encontrado` |
| 2.4 | Toda rota com dado de tenant está coberta pela suíte | ✅ | T-ISO-15 em [`tests/isolamento.test.js`](../tests/isolamento.test.js) |

## 3. Documentação da Etapa 2 [Bloco 7]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 3.1 | ADR-004: síncrono × assíncrono, e por que fila | ✅ | [ADR-004](adr/adr-004-comunicacao-entre-servicos.md), "Por que fila (1B)" |
| 3.2 | ADR-004: por que a Importação grava pela API e não no banco | ✅ | ADR-004, "Por que a Importação grava pela API (2B)" |
| 3.3 | ADR-004: propagação do tenant e por que dois segredos | ✅ | ADR-004, "Como o tenant atravessa os dois serviços" |
| 3.4 | ADR-004: idempotência (jobId + `lotes_aplicados` + upsert) | ✅ | ADR-004, "Idempotência: três camadas" |
| 3.5 | ADR-004: CSV no payload até 1 MB em vez de S3, com gatilho de 5 MB / 200 MB | ✅ | ADR-004, "O CSV no payload, sem S3 (3B)" e "Gatilhos de revisão" |
| 3.6 | ADR-004: o que acontece quando a Importação ou o Redis caem | ✅ | ADR-004, "Quando a Importação ou o Redis caem" |
| 3.7 | ADR-004: números do projeto com a conta | ✅ | ADR-004: 5.000 linhas, memória do Redis (46 MB / 117 MB), tempos de importação, `concurrency: 2` |
| 3.8 | C4 nível 2 atualizado, com o que não foi construído marcado | ✅ | [`02-arquitetura-c4.md`](02-arquitetura-c4.md#estado-na-etapa-2), "Estado na Etapa 2" (o desenho original foi mantido) |
| 3.9 | ADR-003 com nota de revisão (intervalo de 5 min substituído) | ✅ | [ADR-003](adr/adr-003-processamento-assincrono.md), "Nota de revisão — 08/11/2026" |
| 3.10 | README com "Como rodar" e tabela da Etapa 2 | ✅ | [`README.md`](../README.md#como-rodar) |
| 3.11 | Este checklist | ✅ | `docs/etapa-2.md` |
| 3.12 | Documentos da Etapa 1 coerentes com o código | ✅ | Notas de revisão de 08/11 nos ADRs 001 a 003, em `01-visao-produto.md`, `atributos.md` e `lgpd.md`; histórico em [`pendencias-bloco-7.md`](pendencias-bloco-7.md) |

## 4. O que sustenta a demonstração [complemento]

| # | Item | Estado | Evidência |
|---|---|---|---|
| 4.1 | Um serviço cai e o resto segue (worker, Redis e banco) | ✅ | [`scripts/demo-degradacao.ps1`](../scripts/demo-degradacao.ps1); T-RES-03, 04 e 07 automatizados |
| 4.2 | Job repetido não duplica contatos | ✅ | T-IMP-09 em [`tests/idempotencia.test.js`](../tests/idempotencia.test.js); [`scripts/ensaio-reprocessamento.ps1`](../scripts/ensaio-reprocessamento.ps1) (T-IMP-14) |
| 4.3 | Importação em lotes de 100 com pausa de 500 ms | ✅ | T-IMP-13 (`TESTES_LENTOS=1`) em [`tests/importacao.test.js`](../tests/importacao.test.js) |
| 4.4 | Limites por plano (linhas, importações simultâneas, rate limit) | ✅ | [`planos.js`](../services/api-contatos/src/planos.js); T-IMP-05, 06, 08; T-RL-01 a 07 em [`tests/rate-limit.test.js`](../tests/rate-limit.test.js) |
| 4.5 | `x-request-id` atravessa API → fila → worker → API | ✅ | T-OBS-01 e T-OBS-02 em [`tests/observabilidade.test.js`](../tests/observabilidade.test.js) |
| 4.6 | Deploy em Kubernetes (kind), com 2 réplicas da API | ✅ | [`deploy/k8s/`](../deploy/k8s/), [`scripts/deploy-kind.ps1`](../scripts/deploy-kind.ps1); probes e `preStop` explicados em [`pendencias-bloco-7.md`](pendencias-bloco-7.md) (seção 9) |
| 4.7 | Segredos fora do repositório | ✅ | `npm run env` gera o `.env` (ignorado pelo git); exemplos em `.env.example` e [`deploy/k8s/exemplos/`](../deploy/k8s/exemplos/) |

## 5. O que não faz parte da Etapa 2 (e onde está registrado)

| Item | Estado | Onde está registrado |
|---|---|---|
| Portal Web ligado à API real | ⏳ Implementado contra o simulador; integração na Fase 6 do bloco 13 | [`portal-pendencias.md`](portal-pendencias.md) |
| Serviço de Notificações (e-mail de confirmação, CQ-03) | ⏳ Planejado, bloco 10 | [C4, "Estado na Etapa 2"](02-arquitetura-c4.md#estado-na-etapa-2) |
| Gerador de Documentos (propostas em PDF) | Fora do escopo do semestre | [`contrato-api.md`](contrato-api.md), seção 10 |
| Armazenamento S3 | Adiado | [ADR-004](adr/adr-004-comunicacao-entre-servicos.md) |
| Exportação, cancelamento e exclusão em 30 dias (LGPD); esboço do DPA | ⏳ Bloco 14 (Etapa 4) | [`lgpd.md`](lgpd.md) |
| `maxmemory` + `noeviction` no Redis do kind; "faxineiro" de importações presas; histórico de execução (J10) | ⏳ Pendências de código P-1 a P-3 | [ADR-004](adr/adr-004-comunicacao-entre-servicos.md), "Pendências de código abertas por este ADR" |

## Roteiro curto da demonstração ao vivo

1. `docker compose up -d --build --wait` e `curl.exe -s http://localhost:3000/saude` → `{"db":"ok","fila":"ok"}`.
2. `npm run seed` (DevSolo e TechConsult).
3. `powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1`: três 404, "isolamento OK".
4. `docker compose logs api-contatos | Select-String recurso_nao_encontrado`: o rastro no log.
5. `powershell -ExecutionPolicy Bypass -File .\scripts\demo-degradacao.ps1`: a Importação, o Redis e o banco
   caem, um de cada vez, e o CRM segue no que dá.
6. Se houver tempo: `npm test`, para mostrar a suíte inteira passando.

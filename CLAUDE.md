# OrbitaTI — instruções para o Claude Code

CRM enxuto e multi-tenant para profissionais de TI autônomos e consultorias de até 10 pessoas.
Projeto Integrador da disciplina Arquitetura de Software SaaS (SETREM, 2026-2).
Equipe: Andriel Schultz e Cristofer Mateus Rutzen. Professor: Jonas Pacheco.

Responda e escreva documentação em **português do Brasil**. Os alunos precisam entender e defender
oralmente tudo o que for gerado: explique o porquê de cada decisão em linguagem simples.

## Documentos que mandam (leia antes de mudar arquitetura)

- `docs/01-visao-produto.md` — personas, preços, entidade central (Contato Comercial)
- `docs/02-arquitetura-c4.md` — containers e as 3 camadas de isolamento
- `docs/adr/adr-001-tenancy.md` — **pool + RLS** (decidido, não reabrir)
- `docs/adr/adr-002-identidade-tenant.md` — `tenant_id` só no JWT, nunca em parâmetro
- `docs/adr/adr-003-processamento-assincrono.md` — fila, lotes de 100, pausa de 500 ms, quota
- `docs/atributos.md` — cenários CQ-01 a CQ-05 (os testes medem estes números)
- `docs/lgpd.md` — OrbitaTI é OPERADOR dos dados dos contatos

Se uma tarefa exigir contrariar um ADR, **pare e pergunte**. Não mude a decisão em silêncio.

## Stack

- Node.js 22, JavaScript ESM (sem TypeScript, sem etapa de build), npm workspaces
- API: Fastify 5, `@fastify/jwt`, `@fastify/rate-limit`, `pg`, `@node-rs/argon2`
- Fila: Redis 7 + BullMQ; worker de importação com `csv-parse`
- Banco: PostgreSQL 16, migrações em SQL puro em `db/migrations/NNN_nome.sql`
- Testes: Vitest (`npm test`) contra a stack do Docker Compose
- Local: Docker Compose. Cluster: kind `saas` (Docker Desktop, Windows), manifests em `deploy/k8s/`

## Estrutura

```
services/api-contatos/   porta de entrada: auth, contatos, importações, rotas /interno
services/importacao/     worker BullMQ: lê o CSV do job, valida, envia lotes à API
db/init/                 cria papéis do Postgres (roda só no primeiro boot)
db/migrations/           schemas, tabelas, RLS, grants
deploy/k8s/              manifests do kind
tests/                   testes de integração (isolamento, RLS, importação)
tests/carga/             k6 (CQ-01)
scripts/                 demo de isolamento e utilitários (PowerShell)
```

## Comandos

```
docker compose up -d --build --wait   # sobe tudo (postgres, redis, migrate, api, importacao)
docker compose run --rm migrate       # aplica migrações pendentes
npm test                              # todos os testes (stack precisa estar no ar)
docker compose logs -f api-contatos importacao
docker compose down -v                # derruba e APAGA os dados (reset total)
```

API local: http://localhost:3000 · no kind: http://localhost:30080

## Regras de multi-tenancy (inegociáveis)

1. **Nenhuma rota, query string ou corpo aceita `tenant_id`.** O tenant vem de `request.user.tenant_id`
   (claim do JWT). Existe teste que varre as rotas e falha se isso for violado.
2. **Todo acesso ao banco com dado de tenant passa por `withTenant(pool, tenantId, fn)`**, que abre
   transação e roda `SELECT set_config('app.tenant_id', $1, true)`. Nunca use `pool.query` direto
   para tabelas de tenant. (`SET LOCAL` não aceita parâmetro; `set_config(..., true)` é o equivalente.)
3. **Toda tabela com `tenant_id` tem RLS com `ENABLE` + `FORCE`** e a política:
   `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` (USING e WITH CHECK).
   O `NULLIF` é obrigatório: numa conexão reaproveitada o valor vira `''` e `''::uuid` dá erro.
4. `tenant_id` tem `DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid`; o código não o informa.
5. Recurso de outro tenant responde **404**, nunca 403. UPDATE/DELETE sob RLS não dá erro, só afeta
   0 linhas: confira `rowCount` e devolva 404.
6. Papéis do Postgres: `api_contatos` (CRUD no schema `orbita`), `importacao_svc` (só schema
   `importacao`, **sem nenhum GRANT em `orbita`**), `migrador` (dono, só migrações),
   `orbita_auth` (BYPASSRLS, NOLOGIN, dono apenas da função `orbita.buscar_credencial`).
   Nenhum papel de aplicação tem BYPASSRLS. Login é a única exceção controlada, via essa função.
7. Importação grava contatos **chamando a API** (`POST /interno/importacoes/:id/lotes`) com token de
   serviço (segredo próprio, `aud: api-contatos`, `iss: importacao`, expira em 60 s, claim `tenant_id`).
8. Idempotência: job do BullMQ com `jobId = importacao_id`; lote registrado em `orbita.lotes_aplicados`
   (PK `importacao_id, numero`); contatos com upsert `ON CONFLICT (tenant_id, email)`. E-mails sempre minúsculos.

## Números do projeto (não invente outros; se precisar, derive e documente a conta)

| Item | Valor |
|---|---|
| Lote de importação | 100 linhas, pausa de 500 ms entre lotes |
| Linhas por importação | individual 100 · equipe 5.000 (CSV até 1 MB, no payload do job) |
| Importações simultâneas por tenant | individual 2 · equipe 5 |
| Rate limit por tenant | 60 req/min por usuário permitido no plano (individual 60 · equipe 600) |
| Rate limit de login | 10 req/min por IP + e-mail |
| Rate limit de cadastro | `LIMITE_CADASTRO_POR_MIN` por IP (padrão 60) |
| Token de acesso | 15 min |
| CQ-01 | busca de outros tenants p95 < 800 ms durante importação de 500+ |
| CQ-02 | 100% das tentativas cruzadas → 404 |

Planos e limites ficam em um só lugar: `services/api-contatos/src/planos.js` (é a "feature flag por plano").

## Observabilidade

- `x-request-id`: aceito na entrada ou gerado (UUID), devolvido na resposta, levado no payload do job e
  reenviado pelo worker no callback. Todo log (pino) inclui `reqId` e `tenant_id`.
- `GET /saude` → `{ db: "ok"|"fora", fila: "ok"|"fora" }`. Fila fora não derruba a API: só
  `POST /importacoes` responde 503 (conexão BullMQ com `enableOfflineQueue: false`).

## Como trabalhar neste repositório

- Antes de codar algo não trivial, apresente um plano curto e espere aprovação.
- Passos pequenos. Depois de cada passo, rode os testes e mostre a saída real do comando.
- Toda funcionalidade nova que toca dado de tenant ganha teste de isolamento em `tests/`.
- Não faça `git push`. Pode sugerir a mensagem de commit; quem commita é o aluno.
- Nunca grave segredos no repositório. Valores reais em `.env` (ignorado); exemplos em `.env.example`.
- Ao mudar arquitetura, atualize o doc correspondente em `docs/` no mesmo passo.
- Ao criar um serviço ou pasta nova, atualize a seção "Estrutura" e os "Comandos" deste arquivo.
- Código e identificadores de domínio em português (`contatos`, `importacoes`, `withTenant` é exceção aceita).

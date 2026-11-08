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
- `docs/contrato-api.md` — contrato HTTP entre Portal e API (rotas, formatos, erros com `codigo`).
  Mudou a API, muda o contrato no mesmo passo

Se uma tarefa exigir contrariar um ADR, **pare e pergunte**. Não mude a decisão em silêncio.

## Stack

- Node.js 22, JavaScript ESM (sem TypeScript, sem etapa de build), npm workspaces
- API: Fastify 5, `@fastify/jwt`, `@fastify/rate-limit`, `pg`, `@node-rs/argon2`
- Fila: Redis 7 + BullMQ; worker de importação com `csv-parse`
- Banco: PostgreSQL 16, migrações em SQL puro em `db/migrations/NNN_nome.sql`
- Testes: Vitest (`npm test`) contra a stack do Docker Compose
- Local: Docker Compose. Cluster: kind `saas` (Docker Desktop, Windows), manifests em `deploy/k8s/`
- **Portal Web (`web/`)**: React 19 + Vite 8 + Tailwind 4 (SPA), servido pelo nginx não-root na porta 8080,
  que também faz proxy de `/api` para a API (mesma origem, sem CORS). **Exceção à regra "sem etapa de
  build":** navegador precisa de bundle. O build roda dentro do `web/Dockerfile` (`node:22-alpine`) e a
  imagem final tem só nginx + arquivos estáticos. Pacote independente, **fora dos workspaces** da raiz
  (tem `package.json` e `node_modules` próprios; o `vitest.config.js` da raiz, criado no bloco 1, exclui `web/**`). Testes: Vitest
  (unitários) e Playwright (E2E e capturas).
- **Estado do Portal (07/11/2026):** roda contra o **simulador do contrato** (`web/simulador/`, Fastify em
  memória, porta 3001). A integração com a API real (bloco 13, Fase 6) está **pendente** até existirem os
  blocos 2, 4 e 12. Pendências e lista para a VM em `docs/portal-pendencias.md`

## Estrutura

```
services/api-contatos/   porta de entrada: auth, contatos, importações, /planos, rotas /interno; test/ = unitários sem stack (T-ISO-13, T-OBS-03)
services/importacao/     worker BullMQ: lê o CSV do job, valida, envia lotes à API; /saude interno na 3001 (sem porta publicada); test/ = unitários sem stack
db/init/                 cria papéis do Postgres (roda só no primeiro boot)
db/migrations/           schemas, tabelas, RLS, grants
db/migrate.js            aplica migrações (imagem orbitati/migrate: db/Dockerfile, pacote próprio fora dos workspaces)
deploy/k8s/              manifests do kind
tests/                   testes de integração (isolamento, RLS, importação); tests/apoio/ = funções comuns (não são testes)
tests/carga/             k6 (CQ-01)
scripts/                 seed.js (contas de demo), demo-isolamento.ps1 e utilitários
web/                     Portal Web: SPA React (src/), nginx (nginx/), Dockerfile, design system
web/simulador/           simulador do contrato (docs/contrato-api.md) para o Portal rodar sem a API; fora da imagem
web/e2e/                 E2E e capturas (Playwright); capturas em web/e2e/capturas/ (fora do git)
```

## Comandos

```
npm install                           # dependências da raiz (Vitest, pg) e dos services/*
npm run env                           # gera o .env com senhas aleatórias; nunca sobrescreve um .env existente
docker compose up -d --build --wait   # sobe tudo (postgres, redis, migrate, api, importacao)
docker compose run --rm migrate       # aplica migrações pendentes
npm test                              # todos os testes (stack precisa estar no ar)
TESTES_LENTOS=1 npm test              # inclui o T-IMP-13 (~25 s: prova a pausa de 500 ms); CI e antes de entrega
npm run seed                          # tenants de demonstração DevSolo e TechConsult (idempotente; SEED_URL)
powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1 [-SemPausa] [-BaseUrl <url>]
docker compose logs -f api-contatos importacao
docker compose down -v                # derruba e APAGA os dados (reset total)
```

Portal Web (em `web/`, com `npm install` próprio):

```
npm run dev:sim                       # Portal em modo dev (http://localhost:5173) + simulador (3001)
npm run dev                           # Portal em modo dev contra a API real em localhost:3000
npm test                              # unitários do Portal e do simulador (Vitest, não precisa de stack)
npm run simulador                     # só o simulador (3001), para a imagem ou os E2E
docker build -t orbitati/web:0.1.0 .  # imagem do Portal (nginx + build)
docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3001 orbitati/web:0.1.0
npm run test:e2e                      # E2E contra E2E_URL (padrão http://localhost:8080)
npm run capturas                      # 8 telas x 4 larguras x 2 temas em web/e2e/capturas/
npm run lighthouse                    # Lighthouse mobile em /entrar e /contatos (via npx)
```

API local: http://localhost:3000 · no kind: http://localhost:30080 · Portal: http://localhost:8080
(hoje pelo `docker run` acima; o serviço `web` entra no compose na Fase 6 do bloco 13)

Variáveis do Portal:

| Variável | Onde | Padrão | Para quê |
|---|---|---|---|
| `API_UPSTREAM` | imagem do `web` | `api-contatos:3000` | Para onde o nginx manda o `/api` (host:porta, sem barra) |
| `API_ALVO` | `npm run dev` | `http://localhost:3000` | Para onde o Vite manda o `/api` em desenvolvimento |
| `E2E_URL` | Playwright e Lighthouse | `http://localhost:8080` | Portal que a suíte testa (8080 Docker, 30080 kind) |
| `E2E_DEMO_EMAIL` / `E2E_DEMO_SENHA` | capturas e Lighthouse | `marcelo@devsolo.dev` / `Demo@2026` | Conta com dados (na stack real, vem do seed do bloco 3) |
| `SIM_PORTA`, `SIM_FILA=fora`, `SIM_LIMITE_RPM`, `SIM_PORTAL_URL` | simulador | 3001, ok, plano, `:5173` | Porta e cenários de falha do simulador |
| `WEB_PORTA` | compose (Fase 6, pendente) | 8080 | Porta publicada do Portal |

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
9. E-mail do contato: **opcional** no cadastro manual (só `nome` é obrigatório — cadastrar em 30 s é requisito
   do produto); **obrigatório** na importação, porque é a chave de deduplicação. Linha sem e-mail vai para
   `importacao.erros_linha`.
10. O progresso da importação fica em `orbita.importacoes`, atualizado pela rota `/interno` que recebe os lotes.
   A API nunca lê o schema `importacao`.

## Números do projeto (não invente outros; se precisar, derive e documente a conta)

| Item | Valor |
|---|---|
| Lote de importação | 100 linhas, pausa de 500 ms entre lotes |
| Linhas por importação | individual 100 · equipe 5.000 (5.000 ≈ 1 MB ÷ ~200 bytes por linha; CSV vai no payload do job) |
| Importações simultâneas por tenant | individual 2 · equipe 5 — **contadas no banco** (`orbita.importacoes` com status `na_fila`/`processando`) no `POST /importacoes`; não usar recurso do BullMQ Pro |
| Intervalo entre importações | **nenhum**: a proteção vem do lote + pausa + `concurrency: 2` do worker (no máximo 2 importações tocam o banco ao mesmo tempo). Substitui o intervalo de 5 min do ADR-003; registrar no ADR-004 |
| Rate limit por tenant | 60 req/min por usuário permitido no plano (individual 1 × 60 = 60 · equipe 10 × 60 = 600); 60/min = um clique por segundo em rajada |
| Armazenamento do rate limit | **Redis** (a API roda com 2 réplicas no kind; em memória cada réplica contaria separado e o limite dobraria). Redis fora → `skipOnError: true`, o limite é ignorado em vez de derrubar a API |
| Rate limit de login | 10 req/min por IP + e-mail |
| Rate limit de cadastro | `LIMITE_CADASTRO_POR_MIN` por IP (padrão 60) |
| Token de acesso | 15 min |
| CQ-01 | busca de outros tenants p95 < 800 ms durante importação de 500+ |
| CQ-02 | 100% das tentativas cruzadas → 404 |

Planos, preços e limites ficam em um só lugar: `services/api-contatos/src/planos.js` (é a "feature flag por plano"),
exposto pela rota pública `GET /planos` (sem token e sem rate limit).

## Documentos da Etapa 1 desatualizados

Os docs da Etapa 1 têm SQL simplificado que **não deve ser copiado**: `current_setting('app.tenant_id')` sem
`true` e sem `NULLIF` (dá erro sem tenant) e `SET LOCAL` com valor concatenado. Quando doc e este arquivo
divergirem, **este arquivo prevalece**. As divergências conhecidas estão em `docs/pendencias-bloco-7.md` e
são corrigidas no Bloco 7 — não corrija docs antes disso, a menos que eu peça.

## Observabilidade

- `x-request-id`: aceito na entrada ou gerado (UUID), devolvido na resposta, levado no payload do job e
  reenviado pelo worker no callback. Todo log (pino) inclui `reqId` e `tenant_id`.
- Todo 404 em rota com `:id` gera log `evento: "recurso_nao_encontrado"` com `tenant_id`, `metodo`, `rota` e `id`
  (decisão 6; com RLS, "de outro tenant" e "inexistente" são indistinguíveis). Fica no `setErrorHandler` do
  `app.js`: rota nova com `:id` ganha o evento sozinha (T-ISO-19).
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

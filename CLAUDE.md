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
- `docs/adr/adr-003-processamento-assincrono.md` — fila, lotes de 100, pausa de 500 ms, quota, rate limit
- `docs/adr/adr-004-comunicacao-entre-servicos.md` — fila API → Importação, gravação pela API, token de serviço,
  idempotência, CSV no payload (sem S3), quedas do Redis e da Importação, pendências de código P-1 a P-3
- `docs/atributos.md` — cenários CQ-01 a CQ-05 (os testes medem estes números)
- `docs/lgpd.md` — OrbitaTI é OPERADOR dos dados dos contatos
- `docs/contrato-api.md` — contrato HTTP entre Portal e API (rotas, formatos, erros com `codigo`).
  Mudou a API, muda o contrato no mesmo passo

Se uma tarefa exigir contrariar um ADR, **pare e pergunte**. Não mude a decisão em silêncio.

## Stack

- Node.js 22, JavaScript ESM (sem TypeScript, sem etapa de build), npm workspaces
- API: Fastify 5, `@fastify/jwt`, `@fastify/rate-limit`, `pg`, `@node-rs/argon2`
- Fila: Redis 7 + BullMQ; worker de importação com `csv-parse`; worker de notificações com `nodemailer` 10.2.1
- E-mail local: Mailpit `axllent/mailpit:v1.32.0` (SMTP só na rede interna; interface e API em `127.0.0.1:8025`)
- Banco: PostgreSQL 16, migrações em SQL puro em `db/migrations/NNN_nome.sql`
- Testes: Vitest (`npm test`) contra a stack do Docker Compose
- Local: Docker Compose. Cluster: kind `saas` (Docker Desktop, Windows), manifests em `deploy/k8s/`
- **Portal Web (`web/`)**: React 19 + Vite 8 + Tailwind 4 (SPA), servido pelo nginx não-root na porta 8080,
  que também faz proxy de `/api` para a API (mesma origem, sem CORS). **Exceção à regra "sem etapa de
  build":** navegador precisa de bundle. O build roda dentro do `web/Dockerfile` (`node:22-alpine`) e a
  imagem final tem só nginx + arquivos estáticos. Pacote independente, **fora dos workspaces** da raiz
  (tem `package.json` e `node_modules` próprios; o `vitest.config.js` da raiz, criado no bloco 1, exclui `web/**`). Testes: Vitest
  (unitários) e Playwright (E2E e capturas).
- **Estado do Portal (09/11/2026):** ligado na **API real** (bloco 13, Fase 6): serviço `web` no compose
  (porta 8080) e Deployment `web` no kind (NodePort 30080, 2 réplicas; a `api-contatos` virou ClusterIP).
  O nginx acha a API por `resolver` + variável (resolve de novo a cada 10 s; o DNS vem do `/etc/resolv.conf`,
  `web/nginx/16-api-resolver.envsh`). O simulador (`web/simulador/`) continua para o modo dev e o job `web`
  do CI. Pendências e lista para a VM em `docs/portal-pendencias.md`

## Estrutura

```
.github/workflows/ci.yml GitHub Actions: job api (compose com o web + npm test com TESTES_LENTOS=1 + seed duas vezes, a 2ª com --sem-mudancas + E2E do Portal contra a API real) e job web (unitários, build, E2E contra o simulador)
docker-compose.carga.yml override SÓ do ensaio do CQ-01: postgres com 1 vCPU e 2 GB (instância do ADR-001); usado pelo medir-cq01.ps1 -RecursosProducao
services/api-contatos/   porta de entrada: auth, contatos, importações, /planos, rotas /interno; test/ = unitários sem stack (T-ISO-13, T-OBS-03, T-RES-07)
services/importacao/     worker BullMQ: lê o CSV do job, valida, envia lotes à API; /saude interno na 3001 (sem porta publicada); test/ = unitários sem stack
services/notificacoes/   worker BullMQ da fila "emails" (bloco 10): monta e envia o e-mail por SMTP (Mailpit); sem banco; /saude interno na 3001; test/ = unitários
db/init/                 cria papéis do Postgres (roda só no primeiro boot)
db/migrations/           schemas, tabelas, RLS, grants
db/migrate.js            aplica migrações (imagem orbitati/migrate: db/Dockerfile, pacote próprio fora dos workspaces)
deploy/k8s/              manifests do kind (namespace orbitati), aplicados pelo scripts/deploy-kind.ps1; 70-web.yaml = Portal na NodePort 30080; exemplos/ = Secret com valores falsos (fora do apply)
tests/                   testes de integração (isolamento, RLS, importação, confirmação de e-mail, interações e "esfriando", CQ-03); tests/apoio/ = funções comuns, inclusive mailpit.js (não são testes)
docs/ensaios/            relatórios datados de medição (CQ-01, CQ-03, CQ-04 e T-CQ04-02, CQ-05, Lighthouse); cq04-*-amostras.csv = CSV da sonda
backups/                 dumps e CSVs do bloco 11 (FORA do git: dado pessoal); criado pelo backup.ps1
tests/carga/             k6 (CQ-01): cq01.js (cenários), janelas.js (veredito "na janela" x "geral") e teste; resultados/ = saída do medir-cq01.ps1 (k6.json fora do git)
scripts/                 seed.js (contas de demo), deploy-kind.ps1 (bloco 6), demo-isolamento.ps1, demo-degradacao.ps1 (T-RES), ensaio-reprocessamento.ps1 (T-IMP-14), medir-cq01.ps1 (CQ-01, bloco 9), backup.ps1, ensaio-restauracao.ps1, restaurar-um-tenant.ps1 e sonda.ps1 (bloco 11; lib-ensaio.ps1 = funções comuns; sql/ = consultas que eles rodam) e utilitários
web/                     Portal Web: SPA React (src/), nginx (nginx/: template, cabeçalhos e o 16-api-resolver.envsh), Dockerfile, design system
web/simulador/           simulador do contrato (docs/contrato-api.md) para o Portal rodar sem a API; fora da imagem
web/e2e/                 E2E e capturas (Playwright); capturas em web/e2e/capturas/ (fora do git)
```

## Comandos

```
npm install                           # dependências da raiz (Vitest, pg) e dos services/*
npm run env                           # cria o .env (senhas aleatórias) ou só acrescenta as chaves novas do .env.example; rode depois de todo git pull
docker compose up -d --build --wait   # sobe tudo (postgres, redis, migrate, api, importacao, notificacoes, mailpit, web)
docker compose run --rm migrate       # aplica migrações pendentes
npm test                              # todos os testes (stack precisa estar no ar)
TESTES_LENTOS=1 npm test              # inclui o T-IMP-13 (~25 s: prova a pausa de 500 ms); CI e antes de entrega
npm run seed                          # tenants de demonstração DevSolo e TechConsult, com interações retroativas (idempotente; SEED_URL)
npm run seed -- --sem-mudancas        # o mesmo, mas sai com código 1 se criar ou alterar algo (prova de idempotência do CI)
powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1 [-SemPausa] [-BaseUrl <url>]   # padrão a API (3000); pelo Portal: http://127.0.0.1:8080/api; no kind: http://127.0.0.1:30080/api
powershell -ExecutionPolicy Bypass -File .\scripts\demo-degradacao.ps1 [-SemPausa]   # para importacao, redis e postgres e religa (T-RES-01 a 07; o 06 é o cadastro sem a fila de e-mail)
powershell -ExecutionPolicy Bypass -File .\scripts\ensaio-reprocessamento.ps1 [-Quedas 2]  # T-IMP-14: mata o worker no meio de 5.000 linhas (1 a 3 min)
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1               # CQ-05: pg_dump -Fc + foto da origem em backups/
powershell -ExecutionPolicy Bypass -File .\scripts\ensaio-restauracao.ps1 [-SemPapeis]   # CQ-05: restaura o último backup no postgres-ensaio, verifica e remove
powershell -ExecutionPolicy Bypass -File .\scripts\restaurar-um-tenant.ps1 -Email <admin>  # CSVs do tenant no formato do modelo de importação
powershell -ExecutionPolicy Bypass -File .\scripts\sonda.ps1 [-Url http://127.0.0.1:30080/api/saude] [-Minutos 60] [-IntervaloSegundos 15]  # CQ-04 (127.0.0.1, nunca localhost: O1)
powershell -ExecutionPolicy Bypass -File .\scripts\medir-cq01.ps1 [-RecursosProducao] [-ManterDados]   # CQ-01 com e sem mitigação (~8 min); no fim devolve o worker a 100/500, apaga os tenants e (com -RecursosProducao) recria o postgres sem limite
docker compose --profile carga run --rm k6 run /scripts/cq01.js   # só o k6 (grafana/k6:1.3.0), na rede do compose
npx vitest run tests/cq03-onboarding.test.js   # só o CQ-03 (20 cadastros; imprime p50, p90 e máximo)
docker compose logs -f api-contatos importacao notificacoes web
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-kind.ps1 [-SemBuild] [-SemSeed]  # kind "saas": build (com o web), kind load, apply, migração, rollout restart, seed em http://127.0.0.1:30080/api
kubectl get pods -n orbitati          # estado no kind (nunca imprima o Secret: nada de get secret -o yaml)
kubectl -n orbitati port-forward svc/mailpit 18025:8025   # caixa do Mailpit do kind em http://localhost:18025
docker compose down -v                # derruba e APAGA os dados (reset total)
```

Portal Web (em `web/`, com `npm install` próprio):

```
npm run dev:sim                       # Portal em modo dev (http://localhost:5173) + simulador (3001)
npm run dev                           # Portal em modo dev contra a API real em localhost:3000
npm test                              # unitários do Portal e do simulador (Vitest, não precisa de stack)
npm run simulador                     # só o simulador (3001), para a imagem ou os E2E
docker build -t orbitati/web:0.1.0 .  # imagem do Portal (nginx + build)
docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3001 orbitati/web:0.1.0   # imagem contra o simulador (com o compose no ar, a 8080 é do serviço web)
npm run test:e2e                      # E2E contra E2E_URL (padrão http://localhost:8080)
npm run capturas                      # 8 telas x 4 larguras x 2 temas em web/e2e/capturas/
npm run lighthouse                    # Lighthouse mobile em /entrar e /contatos (via npx; pelo PowerShell, não pelo Git Bash: spawn UNKNOWN)
```

Portal: http://localhost:8080 (serviço `web` do compose; `/api/*` vai para a API) · API direta: http://localhost:3000
(só em 127.0.0.1, para testes e scripts) · kind: http://localhost:30080 (Portal; a API só por `/api`) · Mailpit: http://localhost:8025

`PORTAL_URL` (obrigatória na API; a API não sobe sem ela) é a base do link do e-mail:
`${PORTAL_URL}/confirmar-email?token=...`. Local `http://localhost:8080` (`.env`); no kind `http://localhost:30080`
no manifesto, que desde a Fase 6 é o Portal (N1 fechada). Nunca "localhost" no código.

Variáveis do Portal:

| Variável | Onde | Padrão | Para quê |
|---|---|---|---|
| `API_UPSTREAM` | imagem do `web` | `api-contatos:3000` | Para onde o nginx manda o `/api` (host:porta, sem barra). No kind, nome completo: `api-contatos.orbitati.svc.cluster.local:3000` (o `resolver` do nginx não usa o `search`) |
| `API_RESOLVER` | imagem do `web` | o `nameserver` do `/etc/resolv.conf` | DNS que o nginx consulta (compose `127.0.0.11`, kind o kube-dns). Só defina para forçar outro |
| `API_ALVO` | `npm run dev` | `http://localhost:3000` | Para onde o Vite manda o `/api` em desenvolvimento |
| `E2E_URL` | Playwright e Lighthouse | `http://localhost:8080` | Portal que a suíte testa (8080 Docker, 30080 kind) |
| `E2E_DEMO_EMAIL` / `E2E_DEMO_SENHA` | capturas e Lighthouse | `marcelo@devsolo.dev` / `Demo@2026` | Conta com dados (na stack real, vem do seed do bloco 3) |
| `SIM_PORTA`, `SIM_FILA=fora`, `SIM_LIMITE_RPM`, `SIM_PORTAL_URL` | simulador | 3001, ok, plano, `:5173` | Porta e cenários de falha do simulador |
| `WEB_PORTA` | compose (`.env`) | 8080 | Porta publicada do Portal (a única exposta na VM) |

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
| Intervalo entre importações | **nenhum**: a proteção vem do lote + pausa + `concurrency: 2` do worker (no máximo 2 importações tocam o banco ao mesmo tempo). Substitui o intervalo de 5 min do ADR-003; registrado no ADR-004 |
| Concorrência do worker | `concurrency: 2` (constante no `worker.js`), **por processo**: no máximo 2 × 100 = 200 linhas de importação gravando ao mesmo tempo. Mais réplicas do worker multiplicam esse número (gatilho do ADR-004) |
| Lote máximo na rota `/lotes` | 5.000 contatos (corpo até 4 MB), só para o bloco 9 rodar "sem a mitigação" (`IMPORT_LOTE=5000`). O worker aceita `IMPORT_LOTE` de 1 a 5.000; o padrão é 100 |
| Retry do job | 3 tentativas, espera de 2 s e 4 s (backoff exponencial); job que falhou fica 24 h no Redis (`removeOnFail`) |
| Rate limit por tenant | 60 req/min por usuário permitido no plano (individual 1 × 60 = 60 · equipe 10 × 60 = 600); 60/min = um clique por segundo em rajada |
| Armazenamento do rate limit | **Redis** (a API roda com 2 réplicas no kind; em memória cada réplica contaria separado e o limite dobraria). Redis fora → `skipOnError: true`, o limite é ignorado em vez de derrubar a API |
| Rate limit de login | 10 req/min por IP + e-mail |
| Rate limit de confirmação de e-mail | 10 req/min por IP (`GET /auth/confirmar`; mesmo número do login: uma pessoa clica 1 ou 2 vezes). No kind vira global (K2) |
| Link de confirmação de e-mail | JWT de **24 h** com `JWT_SEGREDO` e `finalidade: "confirmar-email"`. Não serve como sessão (401) e a sessão não serve para confirmar (400). O login não exige confirmação |
| Job de e-mail (fila `emails`) | 5 tentativas, backoff exponencial de 2 s; `removeOnComplete`; falha fica 24 h (`removeOnFail`, a validade do link); `jobId = confirmar-cadastro-<usuario_id>` (**sem `:`**, que o BullMQ 6 recusa); worker com `concurrency: 5` |
| Rate limit de cadastro | `LIMITE_CADASTRO_POR_MIN` por IP (padrão 60). A suíte manda um `X-Forwarded-For` 203.0.113.N por arquivo (`tests/apoio/api.js`) |
| IP real atrás do proxy | `TRUST_PROXY_SALTOS` (padrão 1; kind com NodePort: 0), e só se a conexão vier de rede interna. O Fastify ≥ 5.12.1 ignora `trustProxy` numérico (`docs/pendencias-bloco-7.md`, J4 a J6) |
| Token de acesso | 15 min |
| CQ-01 | busca de outros tenants p95 < 800 ms durante importação de 500+ |
| CQ-02 | 100% das tentativas cruzadas → 404 |

Planos, preços e limites ficam em um só lugar: `services/api-contatos/src/planos.js` (é a "feature flag por plano"),
exposto pela rota pública `GET /planos` (sem token e sem rate limit).

## Documentos da Etapa 1 (revisados no Bloco 7)

Os docs da Etapa 1 foram corrigidos em 08/11/2026 (Bloco 7) para o SQL e as decisões deste arquivo. Cada um traz
uma nota de revisão datada, e o desenho original ficou como registro (o C4 tem a seção "Estado na Etapa 2").
O histórico das contradições (C1 a C12) e das decisões dos blocos 0 a 6, com onde cada uma foi parar, está em
`docs/pendencias-bloco-7.md`. Se doc e este arquivo divergirem de novo, **este arquivo prevalece**: corrija o doc
no mesmo passo e registre a mudança.

## Observabilidade

- `x-request-id`: aceito na entrada ou gerado (UUID), devolvido na resposta, levado no payload do job e
  reenviado pelo worker no callback. Todo log (pino) inclui `reqId` e `tenant_id`.
- Todo 404 em rota com `:id` gera log `evento: "recurso_nao_encontrado"` com `tenant_id`, `metodo`, `rota` e `id`
  (decisão 6; com RLS, "de outro tenant" e "inexistente" são indistinguíveis). Fica no `setErrorHandler` do
  `app.js`: rota nova com `:id` ganha o evento sozinha (T-ISO-19).
- `GET /saude` → `{ db: "ok"|"fora", fila: "ok"|"fora" }`. Fila fora não derruba a API: só
  `POST /importacoes` responde 503 (conexão BullMQ com `enableOfflineQueue: false`). O cadastro conclui com a
  fila fora e só registra `warn` `evento: "email_nao_enfileirado"` (T-RES-06).
- **Nunca registre token de link nem e-mail completo** (T-OBS-04). A API troca `?token=` por `[oculto]` no
  serializer de `req` (`app.js`); o nginx do Portal registra `$uri` (sem query); o worker de e-mail registra
  `m***@dominio` e, em erro de SMTP, só os códigos (a mensagem do servidor repete o destinatário).

## Como trabalhar neste repositório

- Antes de codar algo não trivial, apresente um plano curto e espere aprovação.
- Passos pequenos. Depois de cada passo, rode os testes e mostre a saída real do comando.
- Toda funcionalidade nova que toca dado de tenant ganha teste de isolamento em `tests/`.
- Não faça `git push`. Pode sugerir a mensagem de commit; quem commita é o aluno.
- Nunca grave segredos no repositório. Valores reais em `.env` (ignorado); exemplos em `.env.example`.
- Ao mudar arquitetura, atualize o doc correspondente em `docs/` no mesmo passo.
- Ao criar um serviço ou pasta nova, atualize a seção "Estrutura" e os "Comandos" deste arquivo.
- Código e identificadores de domínio em português (`contatos`, `importacoes`, `withTenant` é exceção aceita).

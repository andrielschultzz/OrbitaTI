# OrbitaTI

[![CI](https://github.com/andrielschultzz/OrbitaTI/actions/workflows/ci.yml/badge.svg)](https://github.com/andrielschultzz/OrbitaTI/actions/workflows/ci.yml)

CRM enxuto e multi-tenant para profissionais de TI autônomos e consultorias de até dez pessoas.

**Disciplina:** Arquitetura de Software SaaS (8512) — EC6, SETREM 2026-2
**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen

---

## O problema

Profissional de TI que pega trabalho por fora vive de indicação, mas o relacionamento que gera o próximo contrato não mora em lugar nenhum — está espalhado entre WhatsApp, e-mail e uma planilha desatualizada. O OrbitaTI existe para mostrar que é possível se organizar.

## Decisões de arquitetura em uma linha

| Decisão | Escolha | Número que a sustenta |
|---|---|---|
| Modelo de tenancy | **Pool** com Row-Level Security | Silo custaria R$ 120/mês por tenant contra ticket médio de R$ 89/mês |
| Identidade do tenant | Claim no **JWT assinado** | Zero parâmetros de tenant nas rotas — verificado por teste |
| Trabalho pesado | **Fila** com lote de 100 e quota | Protege busca de outros tenants em p95 < 800 ms |
| Comunicação entre serviços | **Fila** da API para a Importação; a Importação grava **pela API** | CSV de até 1 MB no job (≈ 5.000 linhas de ~200 bytes); pior caso ≈ 117 MB no Redis |

## Etapa 1 — os cinco artefatos

| # | Artefato | Arquivo |
|---|---|---|
| 1.1 | Visão do produto, cliente fictício e personas | [`docs/01-visao-produto.md`](docs/01-visao-produto.md) |
| 1.2 | Diagramas C4 — níveis 1, 2 e esboço do 3 | [`docs/02-arquitetura-c4.md`](docs/02-arquitetura-c4.md) |
| 1.3 | ADRs | [`docs/adr/`](docs/adr/) — [001 tenancy](docs/adr/adr-001-tenancy.md) · [002 identidade](docs/adr/adr-002-identidade-tenant.md) · [003 assíncrono](docs/adr/adr-003-processamento-assincrono.md) |
| 1.4 | Atributos de qualidade — 5 cenários mensuráveis | [`docs/atributos.md`](docs/atributos.md) |
| 1.5 | Mapeamento LGPD preliminar | [`docs/lgpd.md`](docs/lgpd.md) |

Os documentos da Etapa 1 foram revisados em 08/11/2026 (Bloco 7) para bater com o código: SQL das políticas,
limites dos planos, comunicação entre serviços. Cada um traz uma nota de revisão datada.

## Etapa 2 — núcleo multi-tenant rodando

Checklist completo, item a item, em [`docs/etapa-2.md`](docs/etapa-2.md).

| O que a Etapa 2 pede | Evidência |
|---|---|
| 2 ou mais serviços | [`services/api-contatos/`](services/api-contatos/) e [`services/importacao/`](services/importacao/), cada um com papel próprio no banco e schema próprio |
| Comunicação entre os serviços, decidida e justificada | [ADR-004](docs/adr/adr-004-comunicacao-entre-servicos.md): fila, gravação pela API, token de serviço, idempotência, CSV no payload |
| Isolamento entre tenants, demonstrado ao vivo | [`scripts/demo-isolamento.ps1`](scripts/demo-isolamento.ps1) e [`tests/isolamento.test.js`](tests/isolamento.test.js) (CQ-02) |
| Isolamento garantido pelo banco | [`db/migrations/`](db/migrations/) (RLS `ENABLE` + `FORCE` + `NULLIF`) e [`tests/rls.test.js`](tests/rls.test.js) |
| Um serviço cai e o resto segue | [`scripts/demo-degradacao.ps1`](scripts/demo-degradacao.ps1) (T-RES-01 a 07) |
| Importação idempotente | [`tests/idempotencia.test.js`](tests/idempotencia.test.js) e [`scripts/ensaio-reprocessamento.ps1`](scripts/ensaio-reprocessamento.ps1) (T-IMP-14) |
| Limites por plano e rate limit por tenant | [`services/api-contatos/src/planos.js`](services/api-contatos/src/planos.js) e [`tests/rate-limit.test.js`](tests/rate-limit.test.js) |
| Rastreio de requisição entre os serviços | [`tests/observabilidade.test.js`](tests/observabilidade.test.js) (`x-request-id` atravessa a fila) |
| Deploy em Kubernetes | [`deploy/k8s/`](deploy/k8s/) e [`scripts/deploy-kind.ps1`](scripts/deploy-kind.ps1) |
| Arquitetura atualizada | [Estado na Etapa 2](docs/02-arquitetura-c4.md#estado-na-etapa-2) no C4 |

## Números de referência do produto

Premissas declaradas em 12 meses, usadas em todos os artefatos:

| Premissa | Valor |
|---|---|
| Tenants | 45 (faixa de 30 a 50) |
| Mix | 36 Individual a R$ 49 + 9 Equipe a R$ 249 |
| Receita recorrente mensal | R$ 4.005 |
| Ticket médio | R$ 89/tenant/mês |
| Contatos acumulados | 16.200 |
| Volume de dados estruturados | ~111 MB |
| Custo de banco em pool | R$ 120/mês — 3% da receita |

## Integração contínua

O GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) roda a cada `push` (qualquer branch)
e a cada `pull_request` (inclusive de fork). São dois jobs em paralelo, com limite de 20 minutos (`api`) e 15 (`web`):

| Job | O que faz |
|---|---|
| `api` | Copia o `.env.example` para `.env`, faz `npm ci`, sobe a stack com `docker compose up -d --build --wait` (com o Portal), roda `npm test` com `TESTES_LENTOS=1` (inclui o T-IMP-13), o seed duas vezes e os E2E do Portal **contra a API real**, pelo nginx. Se falhar, imprime `docker compose logs` e guarda o relatório do Playwright |
| `web` | No `web/`: `npm ci`, testes unitários, `npm run build` e os E2E do Playwright contra a imagem do nginx apontando para o simulador do contrato. Os mesmos E2E do job `api`: se um passa e o outro falha, API, contrato e simulador divergiram |

Nenhum segredo real entra no CI: o `.env.example` tem valores falsos que funcionam, e o banco do runner
nasce vazio e morre ao fim da execução. Os testes não dependem de dados antigos: cada um cria os próprios
tenants com e-mails únicos.

**O check vermelho só bloqueia o merge com a regra do repositório.** O workflow apenas marca o commit
como falho. Para impedir o merge no `main`: GitHub → Settings → Branches → Add branch protection rule
(ou Rules → Rulesets) para `main` → "Require status checks to pass before merging" → marcar os checks
**`api`** e **`web`**. Sem essa regra, o vermelho avisa mas não impede.

## Estrutura do repositório

```
.github/workflows/ci.yml         # integração contínua (jobs api e web)
docs/
├── 01-visao-produto.md          # 1.1 — problema, cliente fictício, personas
├── 02-arquitetura-c4.md         # 1.2 — C4 níveis 1, 2 e esboço do 3; "Estado na Etapa 2"
├── atributos.md                 # 1.4 — cenários CQ-01 a CQ-05
├── lgpd.md                      # 1.5 — inventário, papéis, medidas e riscos
├── adr/
│   ├── adr-001-tenancy.md       # pool x schema x silo, com a conta
│   ├── adr-002-identidade-tenant.md
│   ├── adr-003-processamento-assincrono.md
│   └── adr-004-comunicacao-entre-servicos.md
├── etapa-2.md                   # checklist da Etapa 2 x evidência no repositório
├── contrato-api.md              # contrato HTTP entre Portal e API
├── plano-de-testes.md           # casos T-xxx, rastreabilidade e lacunas
├── pendencias-bloco-7.md        # histórico das decisões dos blocos 0 a 6 e onde cada uma foi parar
├── portal-pendencias.md         # resultado da Fase 6 e o que falta para a VM
├── ensaios/                     # relatórios de ensaios (ex.: Lighthouse do Portal)
└── atividades/
    └── enc06-andriel.md         # atividade dirigida do Encontro 06
services/api-contatos/           # API (Fastify 5): auth, contatos, importações, /planos, rotas /interno
services/importacao/             # worker BullMQ: lê o CSV do job, valida, envia lotes à API
db/                              # papéis (init/), migrações SQL e a imagem orbitati/migrate
deploy/k8s/                      # manifests do kind (namespace orbitati)
scripts/                         # seed, deploy no kind, demos de isolamento e de degradação, ensaio T-IMP-14
tests/                           # testes de integração, contra a stack no ar; apoio/ = funções comuns
web/                             # Portal Web (SPA React + nginx), pacote independente
├── src/                         # telas, cliente HTTP, sessão, design system em código
├── simulador/                   # simulador do contrato (o Portal roda sem a API)
├── e2e/                         # E2E e capturas (Playwright)
├── nginx/                       # configuração do nginx (proxy /api, CSP, cache)
├── design-system/orbitati/      # MASTER.md: decisões visuais
└── Dockerfile                   # build Node 22 -> nginx não-root na porta 8080
```

## Como rodar

### Pré-requisitos

- **Node.js 22** ou mais novo.
- **Docker Desktop** (Windows), com o Docker Compose.
- **Só para o deploy no kind:** `kind` e `kubectl`, e o cluster kind `saas` já criado, com a porta 30080 no
  `extraPortMappings` (é o cluster dos laboratórios da disciplina).
- **PowerShell**, que já vem no Windows, para os scripts de demonstração.

### 1. Dependências e `.env`

Na raiz do repositório:

```
npm install      # Vitest e pg (testes) e as dependências dos services/*
npm run env      # cria o .env com senhas e segredos aleatórios; se já existe, só acrescenta as chaves que faltam
```

**Depois de um `git pull`, rode `npm run env`.** Quando o `.env.example` ganha uma variável nova (ex.:
`PORTAL_URL` no bloco 10), um `.env` antigo não a tem e o compose recusa subir ("defina PORTAL_URL no .env").
Com o `.env` já existente, o `npm run env` só **acrescenta no fim** as chaves que faltam, sem alterar as que
já estão lá, e imprime apenas os nomes delas. Uma chave nova que seja segredo ganha valor aleatório; as
demais vêm com o valor do `.env.example`.

O `.env` fica fora do git. O `.env.example` mostra as variáveis com valores falsos. Leia
"[O `.env` e as senhas do banco](#o-env-e-as-senhas-do-banco)" antes de trocar uma senha.

### 2. Subir a stack (Docker Compose)

```
docker compose up -d --build --wait       # postgres, redis, migrate, api-contatos e importacao, todos prontos
curl.exe -s http://localhost:3000/saude   # {"db":"ok","fila":"ok"}
```

A API fica em http://localhost:3000. O Serviço de Importação não publica porta: ele só fala com o Redis, o
banco e a API.

### 3. Dados de demonstração

```
npm run seed    # cria DevSolo Sistemas (marcelo@devsolo.dev, 5 contatos) e TechConsult Solutions
                # (gestor@techconsult.com.br, 20 contatos), senha Demo@2026. Rodar de novo só avisa.
```

O seed chama a própria API (padrão `http://localhost:3000`; outro endereço com `SEED_URL`).

### 4. Testes

```
npm test                    # todos os testes de integração e os unitários dos serviços (stack precisa estar no ar)
$env:TESTES_LENTOS="1"; npm test   # inclui o T-IMP-13 (~25 s, prova a pausa de 500 ms). Use antes de entregar
```

O segundo comando é o do PowerShell; no Git Bash, `TESTES_LENTOS=1 npm test`. Os testes do Portal rodam à
parte, dentro de `web/` (seção [Portal Web](#portal-web)).

### 5. Deploy no kind

```
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-kind.ps1             # build, kind load, apply, migração, rollout, seed
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-kind.ps1 -SemBuild   # só os manifests mudaram
kubectl get pods -n orbitati
curl.exe -s http://127.0.0.1:30080/api/saude
```

No kind, http://localhost:30080 é o **Portal** (nginx, 2 réplicas), que faz proxy de `/api` para a API (2
réplicas, só dentro do cluster: Service ClusterIP). Seed, demos e sonda usam `http://127.0.0.1:30080/api`. O script cria o Secret
`orbitati-segredos` a partir do `.env` só se ele ainda não existir, e nunca imprime os valores. Ele também
**nunca** apaga namespace nem volume. O reset total (apaga o banco do kind) é
`kubectl delete namespace orbitati`.

### 6. Scripts de demonstração

Todos sem pausa com `-SemPausa`, e saem com código 0 se deu tudo certo ou 1 se houve falha.

| Script | O que mostra | Onde roda |
|---|---|---|
| `scripts\demo-isolamento.ps1` | A DevSolo tenta ler, alterar e excluir um contato da TechConsult pelo id: 404 nas três (CQ-02) | Compose; pelo Portal com `-BaseUrl http://127.0.0.1:8080/api`; no kind com `-BaseUrl http://127.0.0.1:30080/api` |
| `scripts\demo-degradacao.ps1` | Para o worker, o Redis e o banco, um de cada vez, e mostra o que segue funcionando; religa tudo no fim (T-RES-01 a 07) | Só compose |
| `scripts\ensaio-reprocessamento.ps1` | Mata o worker no meio de uma importação de 5.000 linhas: conclui sem duplicar. Com `-Quedas 2`, termina como `falhou` (T-IMP-14). Leva de 1 a 3 min | Só compose |

Exemplo:

```
powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1             # com pausas (apresentação)
powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1 -SemPausa   # direto (testes e CI)
```

**O que a demo de isolamento faz:**

1. Entra nas duas empresas e mostra quantos contatos cada uma vê.
2. A DevSolo tenta ler, alterar e excluir um contato da TechConsult pelo id. Cada tentativa mostra
   "404 — isolamento OK" ou "FALHA DE ISOLAMENTO".
3. A TechConsult confere que o contato continua igual.

Cada 404 em rota com `:id` também aparece no log da API, como evento `recurso_nao_encontrado`:

```
docker compose logs api-contatos | Select-String recurso_nao_encontrado
```

**Por que `-ExecutionPolicy Bypass`.** O Windows bloqueia scripts `.ps1` que não são assinados, e estes
scripts não são. O `Bypass` vale **só para essa execução**: a política da máquina continua a mesma e não é
preciso ser administrador.

### 7. Logs e reset

```
docker compose logs -f api-contatos importacao   # todo log tem reqId e tenant_id
docker compose run --rm migrate                  # aplica só as migrações pendentes
docker compose down -v                           # derruba e APAGA os dados (reset total)
```

### Detalhes da stack local

**Os testes e o rate limit.** A API limita cadastros por IP (`LIMITE_CADASTRO_POR_MIN`, padrão 60), e a
suíte faz mais de 50 por execução. Para não somar tudo num IP só, cada arquivo de teste manda um
`X-Forwarded-For` fictício próprio (`203.0.113.N`, faixa de documentação da RFC 5737), como se fosse um
escritório diferente atrás do Nginx. **Por isso a suíte depende de `TRUST_PROXY_SALTOS=1` no compose (o
padrão):** com `0`, a API ignora o header, os cadastros voltam a somar no mesmo IP e aparecem 429 sem
motivo aparente. Detalhes em `tests/apoio/api.js`.

**Ordem de subida.** O `migrate` é um job: roda, aplica o que falta e sai. A `api-contatos` depende dele
com `service_completed_successfully`, então só sobe depois que as migrações terminaram bem, e nunca roda
contra um schema velho. Com essa dependência, o `up --wait` entende o `Exited (0)` do migrate como
sucesso; se uma migração falhar, o `up` sai com erro e a API nem inicia. Cada `up` roda o migrate de novo,
o que é seguro porque ele é idempotente.

**Portas.** O Postgres (`5432`) e a API (`3000`) ficam publicados só em `127.0.0.1`: os testes rodam no
host e precisam deles, mas ninguém da rede alcança as portas. Na VM, só o Portal fica exposto. O Redis e o
Serviço de Importação não são publicados. Se o `up` falhar com `port is already allocated`, outro programa
ou contêiner está usando a porta (`docker ps` mostra qual).

**Imagens.** O build da API e do worker usa a raiz do repositório como contexto, porque com npm workspaces o
`package-lock.json` fica lá. O `.dockerignore` da raiz deixa `.env`, `.git`, `node_modules` e `web/` de
fora. Os contêineres rodam como usuário `node`, com sistema de arquivos só leitura (`/tmp` em memória), sem
capabilities do Linux e com `no-new-privileges`.

<a id="o-env-e-as-senhas-do-banco"></a>
**O `.env` e as senhas do banco.** As senhas dos papéis (`migrador`, `api_contatos`, `importacao_svc`)
são gravadas **só no primeiro boot** do Postgres, quando o volume `pgdados` está vazio
(`db/init/01-papeis.sh`). Depois disso, trocar uma senha no `.env` não muda o banco: o papel continua com
a senha antiga, e a conexão com a nova falha com `password authentication failed`. Por isso o
`npm run env` **nunca** sobrescreve uma chave de um `.env` existente (só acrescenta as que faltam). Para trocar uma senha de propósito, há dois
caminhos:

- **sem perder dados:** troque no `.env` e no banco, com o mesmo valor:
  `docker compose exec postgres psql -U postgres -d orbitati -c "ALTER ROLE api_contatos PASSWORD 'nova'"`;
- **do zero:** `docker compose down -v` apaga o volume, e com ele **todos os dados**. No próximo `up`, os
  papéis são recriados com as senhas do `.env`.

**Migrações.** Ficam em `db/migrations/NNN_nome.sql` e rodam pela imagem `orbitati/migrate`
(`db/Dockerfile`), como o papel `migrador`. Migração aplicada não se edita: o `migrate.js` guarda o
SHA-256 de cada arquivo e para com erro se o conteúdo mudar. Também falha (e desfaz a migração) se o PostgreSQL emitir
qualquer WARNING: um `GRANT` ou `REVOKE` sem efeito não dá erro, só aviso. Para mudar algo, crie uma migração nova. No
ambiente local a pasta é montada no contêiner, então uma migração nova vale sem rebuild; mudanças no
`migrate.js` pedem `docker compose build migrate`.

## Portal Web

> **Estado em 09/11/2026:** o Portal está ligado na API real (bloco 13, Fase 6): serviço `web` no compose
> (http://localhost:8080) e no kind (http://localhost:30080). O simulador do contrato (`web/simulador/`)
> continua para desenvolver sem a stack. O que falta para a VM: [`docs/portal-pendencias.md`](docs/portal-pendencias.md).

Requisitos: Node.js 22 ou mais novo e Docker Desktop. Todos os comandos rodam dentro de `web/`:

```
cd web
npm install
npx playwright install chromium     # só na primeira vez, para os E2E
```

**1. Desenvolvimento, com o simulador** (recarrega ao salvar):

```
npm run dev:sim
```

Abra http://localhost:5173 e entre com `marcelo@devsolo.dev` (plano Individual) ou
`gestor@techconsult.com.br` (plano Equipe). Senha `Demo@2026` nas duas. Os dados vivem em memória e
voltam ao início quando o simulador reinicia. Para ver os erros: `SIM_FILA=fora` (importação com a fila
fora) ou `SIM_LIMITE_RPM=5` (rate limit estoura rápido).

**2. A imagem de produção (nginx), com o simulador.** Em dois terminais:

```
npm run simulador
```
```
docker build -t orbitati/web:0.1.0 .
docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3001 orbitati/web:0.1.0
```

Abra http://localhost:8080. Conferências rápidas:

```
curl.exe -s http://localhost:8080/api/saude                                # passa pelo nginx
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8080/api/interno/x   # 404: rota interna bloqueada
curl.exe -sI http://localhost:8080                                         # CSP e cabeçalhos de segurança
```

Se o compose estiver no ar, a 8080 já é do serviço `web`: pare-o antes (`docker compose stop web`).

**3. Pelo Docker Compose, com a API real** (na raiz do repositório):

```
docker compose up -d --build --wait   # sobe tudo, inclusive o web na 8080 (WEB_PORTA no .env)
npm run seed                          # contas de demonstração (DevSolo e TechConsult)
```

Abra http://localhost:8080 e entre com as mesmas contas. Em desenvolvimento contra a API real, com
recarga ao salvar: `npm run dev` em `web/` (o Vite manda o `/api` para `http://localhost:3000`).

**Testes do Portal** (com o Portal no ar pelo item 2 ou pelo item 3):

```
npm test            # unitários (Vitest): cliente HTTP, sessão, mapa de órbita, tokens de tema, simulador
npm run test:e2e    # E2E (Playwright): fluxo, T-WEB-01 (nenhum "tenant"), sessão, isolamento, erros, nginx, acessibilidade
npm run capturas    # 8 telas x 4 larguras x 2 temas em web/e2e/capturas/
npm run lighthouse  # Lighthouse mobile em /entrar e /contatos, claro e escuro
```

A URL testada vem de `E2E_URL` (padrão `http://localhost:8080`, que serve para o simulador e para o
compose; no kind, `$env:E2E_URL="http://localhost:30080"`). As capturas e o Lighthouse entram com a conta
DevSolo; na stack real, rode o seed antes. O Lighthouse precisa rodar pelo PowerShell: pelo Git Bash o
Chromium não abre (`spawn UNKNOWN`). Último Lighthouse, contra a API real:
[`docs/ensaios/portal-lighthouse-2026-11-09.md`](docs/ensaios/portal-lighthouse-2026-11-09.md).

## Calendário do Projeto Integrador

| Etapa | Entrega | Prazo | Peso |
|---|---|---|---|
| **1** | Proposta de arquitetura | 27/09/2026, 23h59 | 20% |
| 2 | Núcleo multi-tenant — 2+ serviços, isolamento ao vivo | 15/10/2026 | 25% |
| 3 | Qualidade e testes | 12/11/2026 | 25% |
| 4 | Produto integrado + defesa | 03/12/2026 (defesa em 17/12) | 30% |

# Plano de testes do OrbitaTI

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen
**Escrito em:** 29/10/2026, antes do código da Etapa 2
**Status:** cada bloco que automatiza um caso troca o status dele neste arquivo (~~blocos 1 a 4 automatizados~~; em 10/11/2026: blocos 1 a 14 com os casos automatizados ou executados, ver a nota abaixo).

> **Nota de revisão — 10/11/2026 (Bloco 15).** Conferência do status de cada caso contra o código e os relatórios:
> - **T-AUTH-01 a 08** e **T-CON-01 a 04** estavam "planejado", mas já são automatizados desde o bloco 2
>   (`tests/auth.test.js` e `tests/contatos.test.js`, que citam cada ID).
> - **T-CQ04-01**, **T-CQ05-01 a 03** (bloco 11) e o **T-CQ04-02** foram executados, com relatório em `docs/ensaios/`.
> - A matriz de rastreabilidade passou a citar **T-RLS-01 a 21** (o `tests/rls.test.js` vai até o 21).
> - Os T-WEB rodam contra a API real **no CI** (job `api`), não só à mão.
> - Alguns casos **não são citados pelo ID** dentro dos arquivos que os executam. O mapa ID → arquivo está na
>   seção 3.6. O código não foi alterado para incluir os IDs.

Este documento é a especificação dos testes. Os arquivos de teste citam os IDs daqui
(ex.: `it('T-RLS-03 conexão reaproveitada sem tenant vê 0 linhas', ...)`), e o ID nunca muda.
Teste novo ganha o próximo número livre. Teste removido fica na tabela com o status "descartado" e o motivo.

---

## 1. O que é testado, em que nível e com quê

O que mais pode dar errado no OrbitaTI é **vazamento entre tenants** (risco R1 de [`lgpd.md`](lgpd.md)).
Por isso o plano começa pelo isolamento e só depois mede desempenho, disponibilidade e recuperação.

| Nível | O que prova | Ferramenta | Onde fica |
|---|---|---|---|
| **Unitário** | Regras que não precisam de banco nem de rede (ex.: nenhuma rota declara `tenant_id`) | Vitest + `buildApp()` com `app.inject()` | `services/*/test/` |
| **Integração** | Comportamento real contra a stack do Docker Compose: RLS, API, fila e worker | Vitest (`npm test`), cliente `pg` e `fetch` | `tests/` |
| **Carga** | Cenário CQ-01 (vizinho barulhento) com números de latência | k6 (serviço `k6` do Compose, profile `carga`) | `tests/carga/` |
| **E2E do Portal** | O Portal Web visto pelo usuário: fluxo, sessão, isolamento na tela, erros, nginx, acessibilidade, layout | Playwright (`npm run test:e2e` e `npm run capturas` em `web/`) contra `E2E_URL` | `web/e2e/` |
| **Ensaio operacional** | O que exige derrubar peças ou esperar muito: degradação, restauração, sonda | Scripts PowerShell, cronometrados, com relatório | `scripts/` e `docs/ensaios/` |
| **Integração contínua** | A suíte inteira roda a cada push e a build vermelha bloqueia o merge (CQ-02). O bloqueio depende da regra do repositório: GitHub → Settings → Branches → regra do `main` → "Require status checks to pass before merging" com os checks `api` e `web` obrigatórios. Sem ela, o vermelho só avisa. **Ativada em 08/11/2026:** ruleset do `main` com os checks `api` e `web` obrigatórios e PR obrigatório; testada no PR #12, que mostrou "Merging is blocked due to pending merge requirements" enquanto os checks rodavam | GitHub Actions (`.github/workflows/ci.yml`): job `api` (stack + `npm test` com `TESTES_LENTOS=1`) e job `web` (unitários, build e E2E do Portal contra o simulador) | a partir do bloco 8 |

Convenções:
- **Tenant A** é quem ataca e **tenant B** é a vítima. Cada teste cria os próprios tenants com e-mails
  únicos por execução e não depende de dados deixados por outro teste (requisito do bloco 8).
- "→ 404" quer dizer status 404 **e** corpo sem nenhum dado do recurso.
- Os testes de RLS conectam em `127.0.0.1:5432` com cada papel do Postgres (`api_contatos`, `importacao_svc`,
  `migrador`) e fixam o tenant com `set_config('app.tenant_id', $1, true)`, como faz o `withTenant`.

---

## 2. Casos de teste

### 2.1 Isolamento no banco (RLS) — bloco 1, `tests/rls.test.js`

Pré-condição comum: migrações aplicadas e dois tenants (A e B) com contatos semeados como `api_contatos`
via `set_config`.

As **12 situações de isolamento validadas num PostgreSQL 16 real em 29/10/2026** e o caso de cada uma:

| # | Situação | Caso |
|---|---|---|
| 1 | Cadastro de tenant pelo papel da API | T-RLS-18 |
| 2 | SELECT sem WHERE | T-RLS-01 |
| 3 | Sessão sem tenant | T-RLS-02 |
| 4 | Conexão reaproveitada | T-RLS-03 |
| 5 | INSERT com tenant de outro | T-RLS-04 |
| 6 | UPDATE em registro de outro | T-RLS-05 |
| 7 | `importacao_svc` sem acesso a `orbita` | T-RLS-07 |
| 8 | Dono com `FORCE` | T-RLS-08 |
| 9 | `buscar_credencial` | T-RLS-09 |
| 10 | `api_contatos` lendo `usuarios` sem tenant | T-RLS-10 |
| 11 | Upsert sem duplicar | T-RLS-11 |
| 12 | E-mail repetido entre tenants | T-RLS-12 |

O cadastro de tenant ganhou o número 18, e não o 1, porque os IDs já publicados não mudam. O T-RLS-06
(DELETE cruzado) não está entre as 12: fica como extra, junto com T-RLS-13 a 17, T-RLS-19, T-RLS-20 (bloco 12) e T-RLS-21 (bloco 14).

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-RLS-01 | Sessão de A, sem `WHERE`, só vê A | ADR-001; regra 3 | A e B com contatos | Como `api_contatos`, fixar A e `SELECT * FROM orbita.contatos` | Só linhas de A; total = contatos semeados em A | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-02 | Sessão sem tenant não vê nada e não dá erro | Regra 3 (`NULLIF`) | idem | `SELECT` em `orbita.contatos` sem `set_config` | 0 linhas, sem exceção | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-03 | Conexão reaproveitada depois do COMMIT não herda o tenant | Regras 2 e 3 | idem | Na **mesma** conexão: transação com A → COMMIT → `SELECT` fora de transação | 0 linhas e **nenhum** erro `invalid input syntax for type uuid` (prova que o `NULLIF` trata o `''`) | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-04 | INSERT com `tenant_id` de outro tenant é barrado | Regra 3 (WITH CHECK) | idem | Fixar A e inserir contato com `tenant_id = B` | Erro `new row violates row-level security policy`; B não ganha linha | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-05 | UPDATE em registro de outro tenant não altera nada | Regra 5 | idem | Fixar A e `UPDATE` no id de um contato de B | `rowCount = 0`, sem erro; contato de B igual ao original | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-06 | DELETE em registro de outro tenant não apaga nada | Regra 5 | idem | Fixar A e `DELETE` no id de um contato de B | `rowCount = 0`; contato de B continua existindo | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-07 | `importacao_svc` não tem acesso ao schema `orbita` | Regra 6 | papel criado por `db/init` | Como `importacao_svc`, `SELECT` em `orbita.contatos` (com e sem tenant fixado) | Erro `permission denied for schema orbita` nos dois casos | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-08 | O dono das tabelas também está sujeito ao RLS (`FORCE`) | Regra 3; ADR-001 | idem | Como `migrador`, sem tenant, `SELECT` em `orbita.contatos` | 0 linhas | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-09 | Login acha a credencial sem tenant fixado, só pela função controlada | Regra 6 | usuário de A; tenant cancelado C | Como `api_contatos`, sem tenant: `SELECT * FROM orbita.buscar_credencial(email)` | E-mail de A → 1 linha com `tenant_id` de A, `papel`, `plano` e `senha_hash`; e-mail de C (cancelado) → 0 linhas | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-10 | `api_contatos` não lê `usuarios` fora da função | Regra 6 | idem | Como `api_contatos`, sem tenant: `SELECT` em `orbita.usuarios` | 0 linhas | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-11 | Upsert do mesmo lote não duplica | Regra 8 | A com 0 contatos | Fixar A e rodar 2× o mesmo `INSERT ... ON CONFLICT (tenant_id, email) DO UPDATE` com 3 contatos; repetir em B com os mesmos e-mails | A tem 3 contatos (não 6); B também tem 3 (a unicidade é por tenant) | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-12 | E-mail de **usuário** é único na base inteira | Regra 6 (`buscar_credencial(email)` depende disso) | usuário `x@y.com` em A | Fixar B e inserir usuário com `x@y.com` | Erro de unicidade (`23505`) | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-13 | `tenant_id` é preenchido pelo DEFAULT, sem o código informar | Regra 4 | — | Fixar A e inserir contato sem `tenant_id` | Linha gravada com `tenant_id = A` | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-14 | Nenhum papel de aplicação tem BYPASSRLS | Regra 6 | — | Consultar `pg_roles` | `api_contatos`, `importacao_svc` e `migrador` com `rolbypassrls = false`; `orbita_auth` com `rolbypassrls = true` e `rolcanlogin = false` | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-15 | Toda tabela com `tenant_id` tem RLS `ENABLE` + `FORCE` e a política | Regra 3 | — | Cruzar `information_schema.columns` (coluna `tenant_id`) com `pg_class.relrowsecurity`, `relforcerowsecurity` e `pg_policies` | Nenhuma tabela fora da regra. Protege tabelas **futuras** (ex.: `interacoes`, bloco 12) | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-16 | O schema `importacao` também isola por tenant | Regra 3 | erros de linha de A e B | Como `importacao_svc`, fixar A e ler `importacao.erros_linha` | Só linhas de A | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-17 | E-mail gravado em maiúsculas é recusado pelo banco | Regra 8 | — | Fixar A e inserir contato com `Fulano@X.com` | Erro de `CHECK (email = lower(email))` | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-18 | A API cadastra um tenant sob RLS | Regras 3 e 6; ADR-001; decisão do bloco 1 | — | Como `api_contatos`, gerar um UUID, fixar `app.tenant_id` com ele e inserir o tenant com esse `id` e o primeiro usuário; depois fixar um UUID e inserir tenant com **outro** `id`; e inserir sem tenant fixado | O primeiro cadastro funciona; os outros dois falham por RLS (`42501`) | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-19 | Nenhuma função `SECURITY DEFINER` de `orbita` fica aberta | Regra 6; decisão do bloco 1 (o PostgreSQL dá `EXECUTE` a `PUBLIC` em toda função nova) | — | Listar as funções `SECURITY DEFINER` de `orbita` e conferir `has_function_privilege` para `public`, `importacao_svc` e `api_contatos`; como `migrador`, criar uma função nova numa transação desfeita | Nenhuma executável por `PUBLIC` nem por `importacao_svc`; só `buscar_credencial` e (desde o bloco 14) `tenants_para_excluir` executáveis, só por `api_contatos`, e as duas com dono `orbita_auth`; a função nova nasce sem `EXECUTE` para ninguém (`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`). É o equivalente do T-RLS-15 para funções: protege a função do bloco 14 (dona `orbita_auth`, com `BYPASSRLS`) | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |
| T-RLS-20 | Interação não aponta para contato de outro tenant | Regra 3; migração 003 (a verificação de chave estrangeira do PostgreSQL ignora o RLS) | contato de B | Sessão de A (`api_contatos`) insere em `orbita.interacoes` com `contato_id` de B | Erro 23503 na FK composta `interacoes_contato_fk` `(contato_id, tenant_id)`; o mesmo INSERT com contato de A passa | Integração | Vitest + pg | 12 | automatizado (`tests/rls.test.js`) |
| T-RLS-21 | `tenants_para_excluir` devolve só o que deve | Bloco 14; regra 6 | tenants cancelados há 31 e 29 dias (numa transação desfeita) | `api_contatos` chama a função sem tenant fixado; `importacao_svc` tenta chamar | Só a coluna do id; o de 31 dias aparece, o de 29, o ativo e o cancelado agora não; o worker recebe 42501 | Integração | Vitest + pg | 14 | automatizado (`tests/rls.test.js`) |

### 2.2 Isolamento pela API (CQ-02) — bloco 3, `tests/isolamento.test.js`

Pré-condição comum: stack no ar; tenants A e B criados pela API; B tem um contato e uma importação.
A suíte é uma **tabela de rotas** (método, caminho) percorrida em laço: rota nova entra com uma linha.

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-ISO-01 | Leitura cruzada por id | CQ-02; regra 5 | contato de B | A faz `GET /contatos/:idB` | 404, corpo sem dado de B | Integração | Vitest | 3 | automatizado |
| T-ISO-02 | Alteração cruzada | CQ-02; regra 5 | idem | A faz `PATCH /contatos/:idB` | 404; B relê o contato e ele está igual | Integração | Vitest | 3 | automatizado |
| T-ISO-03 | Exclusão cruzada | CQ-02; regra 5 | idem | A faz `DELETE /contatos/:idB` | 404; o contato continua existindo para B | Integração | Vitest | 3 | automatizado |
| T-ISO-04 | Listagem e busca não misturam tenants | CQ-02 | A e B com contatos de nomes parecidos | A faz `GET /contatos` e `GET /contatos?busca=<termo comum>` | Nenhum id de B na resposta | Integração | Vitest | 3 | automatizado |
| T-ISO-05 | 404 cruzado é indistinguível de "não existe" | CQ-02 ("sem confirmar a existência") | idem | A faz `GET` no id de B e num UUID aleatório | Mesmo status e mesmo corpo nas duas respostas | Integração | Vitest | 3 | automatizado |
| T-ISO-06 | `tenant_id` no corpo é ignorado | Regra 1; ADR-002 | — | A faz `POST /contatos` com `{"nome":"x","tenant_id":"<B>"}` | Contato criado em A (o Fastify descarta a propriedade extra); B não o vê | Integração | Vitest | 3 | automatizado |
| T-ISO-07 | `tenant_id` na query string é ignorado | Regra 1; ADR-002 | contatos em A e B | A faz `GET /contatos?tenant_id=<B>` | Só contatos de A | Integração | Vitest | 3 | automatizado |
| T-ISO-08 | Importação de outro tenant | CQ-02; regra 5 | importação de B | A faz `GET /importacoes/:idB` | 404 | Integração | Vitest | 4 | automatizado |
| T-ISO-09 | Token de serviço de A não grava lote em importação de B | Regra 7; CQ-02 | idem | Token de serviço com `tenant_id = A` em `POST /interno/importacoes/:idB/lotes` | 404; nenhum contato novo em A nem em B | Integração | Vitest | 4 | automatizado |
| T-ISO-10 | JWT adulterado | ADR-002 | token de A | Trocar o `tenant_id` do payload para B **sem reassinar** e chamar `GET /contatos` | 401 | Integração | Vitest | 3 | automatizado |
| T-ISO-11 | JWT expirado | ADR-002 | — | Token assinado com `JWT_SEGREDO` e `exp` no passado | 401 | Integração | Vitest | 3 | automatizado |
| T-ISO-12 | Token de serviço não serve em rota de usuário | Regra 7 (dois segredos) | — | Token de serviço válido em `GET /contatos` | 401 | Integração | Vitest | 4 | automatizado |
| T-ISO-13 | Nenhuma rota aceita `tenant_id` | Regra 1; ADR-002 | — | `buildApp()` + hook `onRoute`: procurar "tenant" no caminho e nos nomes de propriedade dos schemas de params, querystring e corpo. Contra-teste: registrar rotas proibidas e conferir que o verificador acusa (`services/api-contatos/test/rotas-sem-tenant.test.js`) | Nenhuma ocorrência; o teste falha se aparecer | Unitário | Vitest | 3 | automatizado |
| T-ISO-14 | A regra acima bloqueia a build | CQ-02 ("build falha se a suíte falhar") | CI ativo | Branch descartável com uma rota proibida (`tenant_id` no caminho); push. **Use um caminho diferente de `/tenants/:tenant_id/contatos`** (ex.: `/empresas/:tenant_id/contatos`): o contra-teste do T-ISO-13 registra esse caminho e falha com rota duplicada, o que é ruído e não prova nada | Workflow vermelho (job `api`, passo "Testes"); o branch é apagado. O merge só fica bloqueado com os checks `api` e `web` obrigatórios na regra do `main` | Integração contínua | GitHub Actions | 8 | **demonstrado em 08/11/2026** ([execução](https://github.com/andrielschultzz/OrbitaTI/actions/runs/42521050345/job/128854381130)). Rota usada: `GET /tenants/:tenant_id/contatos`. 3 falhas: (1) T-ISO-13 acusou a rota no caminho e nos params; (2) T-ISO-15 acusou a rota fora da tabela do `isolamento.test.js`, ou seja, duas verificações independentes barraram o CI; (3) o contra-teste do T-ISO-13 falhou com `FST_ERR_DUPLICATED_ROUTE`, porque a rota do branch usou o mesmo caminho que ele registra (artefato da demonstração, não defeito). **Bloqueio do merge ativo desde 08/11/2026:** ruleset do `main` com os checks `api` e `web` obrigatórios e PR obrigatório, testado no PR #12 ("Merging is blocked due to pending merge requirements" enquanto os checks rodavam) |
| T-ISO-15 | Toda rota com dado de tenant está na tabela da suíte | CQ-02 ("100% das rotas cobertas") | — | (a) As rotas com `config.publica` são exatamente as de uma lista fixa (hoje `GET /saude`, `POST /auth/cadastro`, `POST /auth/login`; os blocos 4, 10 e 14 acrescentam `/planos`, `/auth/confirmar` e `/conta/exportacao/arquivo`). (b) As demais rotas registradas no `onRoute` (sem HEAD) são exatamente as da tabela de `isolamento.test.js` | Rota fora da tabela, rota fantasma na tabela ou rota pública não prevista → falha. A lista fixa impede que marcar uma rota como pública seja um jeito de escapar da autenticação e da suíte ao mesmo tempo | Unitário | Vitest | 3 | automatizado |
| T-ISO-16 | Interações de contato de outro tenant | CQ-02 | contato de B | A faz `GET` e `POST /contatos/:idB/interacoes` | 404 nos dois; nenhuma interação criada | Integração | Vitest | 12 | automatizado (`tests/isolamento.test.js`, tabela `ROTAS_COM_ID`) |
| T-ISO-17 | "Esfriando" não mostra contatos de outro tenant | CQ-02 | contatos frios em B | A faz `GET /contatos/esfriando` | Nenhum id de B | Integração | Vitest | 12 | automatizado (`tests/isolamento.test.js`) |
| T-ISO-18 | Exportação só traz o próprio tenant | CQ-02; LGPD | dados em A e B | A (admin) faz `GET /conta/exportacao` | Nenhum id, e-mail ou nome de B no JSON | Integração | Vitest | 14 | automatizado (`tests/lgpd.test.js`, com controle: os mesmos valores aparecem na exportação de B) |
| T-ISO-19 | Todo 404 em rota com `:id` gera o evento `recurso_nao_encontrado` no log | CQ-02 ("evento registrado no log"); decisão 6 | contato de B; API montada no processo do teste (`buildApp()` com o log numa lista) | Para cada linha da tabela de rotas com `:id`, A chama a rota com o id de B; depois, `GET /contatos/nao-e-uuid` e uma rota inexistente | Um evento por 404, com `tenant_id` de A, `metodo`, `rota` (`/contatos/:id`) e `id`. O `:id` que não é UUID também gera o evento; rota inexistente não gera | Integração | Vitest | 3 | automatizado |

**Cobertura de rotas na Etapa 2.** O [`atributos.md`](atributos.md#cq-02) dimensiona **24 casos** =
12 rotas previstas no C4 × 2 (leitura e escrita cruzadas). Essa conta vale para o produto completo.
Na Etapa 2 existem 10 rotas com dado de tenant, e cada uma tem pelo menos um caso para a operação que faz:

| Rota | Leitura cruzada | Escrita cruzada |
|---|---|---|
| `GET /contatos` | T-ISO-04, T-ISO-07 | — (não escreve) |
| `POST /contatos` | — (não lê de outro) | T-ISO-06 |
| `GET /contatos/:id` | T-ISO-01, T-ISO-05 | — |
| `PATCH /contatos/:id` | — | T-ISO-02 |
| `DELETE /contatos/:id` | — | T-ISO-03 |
| `POST /importacoes` | — | T-IMP-02 |
| `GET /importacoes/:id` | T-ISO-08 | — |
| `POST /interno/importacoes/:id/inicio` | — | T-ISO-09 (token de serviço de A) |
| `POST /interno/importacoes/:id/lotes` | — | T-ISO-09 (token de serviço de A) |
| `POST /interno/importacoes/:id/falha` | — | T-ISO-09 (token de serviço de A) |

10 de 10 rotas cobertas = **100%**, com 12 casos de rota mais 3 de token (T-ISO-10 a 12). As 3 rotas `/interno` são
atacadas com o **token de serviço** de A (regra 7), que é o caminho que um worker comprometido teria. A conta de 24 volta a
valer quando as 12 rotas do C4 existirem. O T-ISO-15 garante que nenhuma rota nova fique de fora.

### 2.3 Autenticação — bloco 2, `tests/auth.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-AUTH-01 | Cadastro self-service | CQ-03; ADR-001 | e-mail novo | `POST /auth/cadastro {empresa, plano, nome, email, senha}` | 201 `{token}`; o token traz `tenant_id`, `plano` e `papel: "admin"` | Integração | Vitest | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-02 | E-mail repetido no cadastro | Regra 8 | e-mail já cadastrado | Repetir o cadastro, também com o e-mail em maiúsculas | 409 nos dois | Integração | Vitest | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-03 | Corpo inválido no cadastro | Bloco 2, item 4 | — | Sem e-mail; plano fora de `individual`/`equipe` | 400 | Integração | Vitest | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-04 | Login correto | ADR-002 | usuário cadastrado | `POST /auth/login` | 200 `{token}` com o mesmo `tenant_id` do cadastro | Integração | Vitest | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-05 | Senha errada e e-mail inexistente dão a mesma resposta | Bloco 2, item 5 | idem | Login com senha errada; login com e-mail inexistente | 401 nos dois, com **corpo idêntico** (não revela qual campo errou) | Integração | Vitest | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-06 | Rota protegida sem token | ADR-002 | — | `GET /contatos` sem `Authorization` | 401 | Integração | Vitest | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-07 | Token de acesso vale 15 min | ADR-002; números do projeto | token do login | Decodificar o JWT | `exp − iat = 900` s (15 × 60) | Integração | Vitest | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-08 | Senha guardada com Argon2id | LGPD (medidas de segurança) | usuário cadastrado | Ler `senha_hash` (via `buscar_credencial`) | Começa com `$argon2id$` e não contém a senha | Integração | Vitest + pg | 2 | automatizado (`tests/auth.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-AUTH-09 | O link do e-mail confirma o endereço | Bloco 10, item 4; contrato, seção 4 | e-mail recebido no Mailpit | `GET /auth/confirmar?token=` com o token do link; repetir | 200 `{confirmado_em}`; a data vai para `usuarios.email_confirmado_em`; o 2º clique devolve a **mesma** data | Integração | Vitest | 10 | automatizado (`tests/confirmacao.test.js`) |
| T-AUTH-10 | Link que não vale | Contrato, seção 4 | — | Token ausente, vazio, > 2 KB, vencido, adulterado, de usuário inexistente e de **outro tenant** (sub de B com tenant de A) | 400 `LINK_INVALIDO` em todos (nunca `VALIDACAO` nem 500); o usuário de B continua sem confirmação | Integração + unitário | Vitest | 10 | automatizado (`tests/confirmacao.test.js`, `services/api-contatos/test/confirmacao.test.js`) |
| T-AUTH-11 | Token do link de e-mail **não** abre sessão | Bloco 10 (pedido da revisão do plano) | — | Token do link (e um forjado com `plano`, `papel` **e** `finalidade`) em `GET /contatos` | 401 nos dois. Sem isso, um link de e-mail de 24 h viraria uma sessão de 24 h | Integração + unitário | Vitest | 10 | automatizado; prova por mutação: sem a checagem no `autenticacao.js`, o teste cai |
| T-AUTH-12 | Token de sessão **não** confirma e-mail | Bloco 10 | — | Token do cadastro em `GET /auth/confirmar` | 400 `LINK_INVALIDO` | Integração + unitário | Vitest | 10 | automatizado; prova por mutação: sem a checagem da `finalidade` na rota, o teste cai |
| T-AUTH-13 | Login não exige confirmação | Bloco 10, item 4 | conta recém-criada, sem clicar no link | `POST /auth/login` | 200 | Integração | Vitest | 10 | automatizado (`tests/confirmacao.test.js`) |

### 2.4 Contatos (comportamento) — bloco 2, `tests/contatos.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-CON-01 | CRUD completo de um tenant | Bloco 2, item 6 | tenant A | Criar, ler, alterar, listar e excluir | 201, 200, 200, 200 e 204; depois do DELETE, GET → 404 | Integração | Vitest | 2 | automatizado (`tests/contatos.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-CON-02 | Só `nome` é obrigatório | D3 de [`pendencias-bloco-7.md`](pendencias-bloco-7.md) | — | `POST /contatos {"nome":"x"}`; depois sem `nome` | 201; sem nome → 400 | Integração | Vitest | 2 | automatizado (`tests/contatos.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-CON-03 | E-mail em minúsculas e único no tenant | Regra 8 | contato `a@x.com` em A | Criar outro com `A@X.com` em A; criar `a@x.com` em B | Em A → 409; em B → 201 | Integração | Vitest | 2 | automatizado (`tests/contatos.test.js`; status corrigido em 10/11/2026, era "planejado") |
| T-CON-04 | Busca por nome, e-mail ou empresa, com teto | Bloco 2, item 6 | 101 contatos em A | `GET /contatos?busca=<termo>` | Acha pelos três campos, ordenado por nome, no máximo 100 itens | Integração | Vitest | 2 | automatizado (`tests/contatos.test.js`; status corrigido em 10/11/2026, era "planejado") |

### 2.5 Importação — bloco 4, `tests/importacao.test.js` e `tests/idempotencia.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-IMP-01 | CSV válido com algumas linhas inválidas | ADR-003; regra 8 | tenant equipe | `POST /importacoes` com 250 linhas válidas + 3 inválidas; consultar `GET /importacoes/:id` até concluir | 202 `{importacao_id}`; `concluida`; `total_lotes = 3` (⌈250 ÷ 100⌉); 250 contatos; 3 linhas em `importacao.erros_linha` | Integração | Vitest | 4 | automatizado |
| T-IMP-02 | Contatos importados ficam só no tenant que importou | CQ-02 | T-IMP-01 concluído | Outro tenant lista contatos | Nenhum dos 250 aparece | Integração | Vitest | 4 | automatizado |
| T-IMP-03 | CSV do Excel em português | Bloco 4, item 6 | — | CSV com `;` e BOM UTF-8 | Mesmo resultado de um CSV com `,` | Integração | Vitest | 4 | automatizado |
| T-IMP-04 | Linha sem e-mail ou com e-mail inválido é erro de linha | D3; regra 8 | — | CSV com linha sem e-mail, linha com e-mail inválido e linha com `Fulano@X.com` | 2 erros de linha; o terceiro gravado como `fulano@x.com` | Integração | Vitest | 4 | automatizado |
| T-IMP-05 | Limite do plano individual | `planos.js` (100) | tenant individual | CSV de 100 linhas; depois de 101 | 100 → 202; 101 → 422 | Integração | Vitest | 4 | automatizado |
| T-IMP-06 | Limite do plano equipe | `planos.js` (5.000) | tenant equipe | CSV de 5.000 linhas curtas; depois de 5.001 | 5.000 → 202; 5.001 → 422. As linhas têm ~50 bytes (5.001 × 50 ≈ 250 KB), para o 422 não ser confundido com o 413 | Integração | Vitest | 4 | automatizado |
| T-IMP-07 | Limite de 1 MB no corpo | Números do projeto | — | Corpo com 1.048.577 bytes (1 MB + 1 byte) | 413; nada gravado em `orbita.importacoes` | Integração | Vitest | 4 | automatizado |
| T-IMP-08 | Importações simultâneas por plano | `planos.js` (2 / 5) | Individual com 2 importações `na_fila` e equipe com 5, criadas **direto no banco** (fixture determinística) | `POST /importacoes` em cada tenant | Individual → 429; equipe → 429; outro tenant individual sem importações → 202 | Integração | Vitest + pg | 4 | automatizado |
| T-IMP-09 | Mesmo lote enviado duas vezes | Regra 8 | importação de A | Mesmo `(importacao_id, numero)` 2× na rota interna, com token de serviço | 1º `{aplicado:true}`; 2º `{aplicado:false}`; contatos e `lotes_aplicados` não mudam | Integração | Vitest | 4 | automatizado |
| T-IMP-10 | Rota interna recusa JWT de usuário | Regra 7 | token de usuário de A | `POST /interno/importacoes/:id/lotes` | 401 | Integração | Vitest | 4 | automatizado |
| T-IMP-11 | Token de serviço com claim errado ou vencido | Regra 7 | — | Tokens com `aud` ≠ `api-contatos`; `iss` ≠ `importacao`; `exp` no passado; assinado com `JWT_SEGREDO` | 401 nos quatro | Integração | Vitest | 4 | automatizado |
| T-IMP-12 | Progresso e transições de status | Bloco 4, item 3 | — | Consultar `GET /importacoes/:id` durante uma importação de equipe | `na_fila` → `processando` → `concluida`; no fim `lotes_aplicados = total_lotes` | Integração | Vitest | 4 | automatizado |
| T-IMP-13 | A pausa de 500 ms existe de verdade | ADR-003; CQ-01 | `IMPORT_PAUSA_MS=500` | Importar 5.000 linhas (50 lotes) e medir `concluida_em − criado_em` | ≥ 24,5 s (49 pausas entre 50 lotes × 0,5 s). Teste lento: marcar para rodar só no CI e antes de entrega | Integração | Vitest | 4 | automatizado (só com `TESTES_LENTOS=1`) |
| T-IMP-14 | Job reprocessado não duplica contatos | Regra 8 (`jobId`, lotes, upsert) | importação de 5.000 linhas em andamento | `docker compose kill importacao` no meio; `docker compose up -d importacao` | `concluida`; exatamente 5.000 contatos; `lotes_aplicados = 50` | Ensaio operacional | PowerShell | 5 | ensaio executado em 08/11/2026 (`scripts/ensaio-reprocessamento.ps1`) |
| T-IMP-15 | CSV todo inválido conclui na hora | Contrato, seção 8 (`inicio`) | importação `na_fila` criada no banco | Token de serviço: `inicio {total_lotes: 0, linhas_invalidas: 4}` | `{status:"concluida"}`; `total_lotes = 0`, `concluida_em` preenchido | Integração | Vitest | 4 | automatizado |
| T-IMP-16 | `inicio` repetido não muda nada | Contrato, seção 8 (retry do BullMQ) | idem | `inicio {1, 3}` e depois `inicio {9, 0}` | Continua `total_lotes = 1`, `linhas_invalidas = 3`: vale o primeiro | Integração | Vitest | 4 | automatizado |
| T-IMP-17 | `falhou` não volta atrás | Contrato, seção 8 | importação `processando` | `falha`; depois um lote e um `inicio` | `{status:"falhou"}`; lote → `{aplicado:false}` e nenhum contato gravado; `inicio` → `{status:"falhou"}` | Integração | Vitest | 4 | automatizado |
| T-IMP-18 | `falha` não desfaz uma importação concluída | Contrato, seção 8 | importação `concluida` | `falha` | `{status:"concluida"}` | Integração | Vitest | 4 | automatizado |
| T-IMP-19 | Linhas inválidas não entram na conta dos lotes | Bloco 4, item 11 | tenant equipe (103 linhas passam do limite do Individual) | CSV com 100 válidas + 3 inválidas, ponta a ponta | `concluida`; `total_lotes = 1`; `linhas_invalidas = 3` | Integração | Vitest | 4 | automatizado |
| T-IMP-20 | CSV só com linhas inválidas | Bloco 4, item 11 | tenant equipe | CSV com 3 linhas inválidas, ponta a ponta | `concluida` com `total_lotes = 0` e `linhas_invalidas = 3` | Integração | Vitest | 4 | automatizado |
| T-IMP-21 | E-mail repetido no arquivo é erro de linha | Contrato, seção 7 (bloco 4) | — | CSV com o mesmo e-mail em duas linhas (com maiúsculas diferentes) | A primeira entra; a segunda vira erro "e-mail repetido (já aparece na linha N)" e conta em `linhas_invalidas`. Unitário em `services/importacao/test/csv.test.js` e ponta a ponta em `tests/importacao.test.js` | Unitário + Integração | Vitest | 4 | automatizado |
| T-IMP-22 | Fila fora no `POST /importacoes` | Bloco 4, item 2; contrato, seção 7 | API no processo do teste, banco real, fila simulada | (a) fila fora antes de gravar; (b) fila cai entre o COMMIT e o `add` | 503 `FILA_INDISPONIVEL` nos dois; nenhuma linha em `orbita.importacoes` (a compensação apagou a de b). O ensaio com o Redis parado de verdade é o T-RES-03 | Integração | Vitest | 4 | automatizado |

### 2.6 Resiliência — bloco 5, `scripts/demo-degradacao.ps1`

Derrubar o Redis no meio do `npm test` quebraria os outros testes que rodam em paralelo. Por isso estes
casos são **ensaios** executados pelo script, com o resultado registrado.

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-RES-01 | Importação fora não derruba o CRM | ADR-003; CLAUDE.md (observabilidade) | stack no ar | `docker compose stop importacao`; login, busca, `POST /contatos` | Todos 2xx | Ensaio operacional | PowerShell | 5 | ensaio executado em 08/11/2026 |
| T-RES-02 | Importação enviada com o worker fora espera e conclui | ADR-003 | T-RES-01 | `POST /importacoes` → `docker compose start importacao` | 202 e `na_fila`; depois `concluida` | Ensaio operacional | PowerShell | 5 | ensaio executado em 08/11/2026 |
| T-RES-03 | Redis fora → 503 rápido | CLAUDE.md (`enableOfflineQueue: false`) | stack no ar | `docker compose stop redis`; `POST /importacoes` cronometrado | 503 com a mensagem "Importação indisponível no momento..." em **< 2 s**; nenhum registro órfão em `orbita.importacoes` | Ensaio operacional | PowerShell | 5 | ensaio executado em 08/11/2026 (503 em 80 ms) |
| T-RES-04 | Redis fora não derruba o resto | CLAUDE.md | T-RES-03 | Login, busca, CRUD de contatos e `GET /saude` | 2xx; `/saude` → HTTP 200 com `{db:"ok", fila:"fora"}`. Nenhum 500 vindo do rate limit: com `skipOnError: true`, ele é ignorado enquanto o Redis está fora (decisão 3) | Ensaio operacional | PowerShell | 5 | ensaio executado em 08/11/2026 |
| T-RES-05 | Redis volta sem reiniciar a API | ADR-003 | T-RES-03 | `docker compose start redis`; `POST /importacoes` | 202, sem reiniciar a `api-contatos` | Ensaio operacional | PowerShell | 5 | ensaio executado em 08/11/2026 |
| T-RES-06 | Cadastro funciona com a fila de e-mail fora | Bloco 10, item 3; CQ-03 | fila que falha no `enfileirarEmail` | `POST /auth/cadastro` | 201 com o token; log `warn` com `evento: "email_nao_enfileirado"`; nenhum e-mail | Unitário + ensaio operacional | Vitest; PowerShell | 10 | automatizado (`services/api-contatos/test/confirmacao.test.js`) e ensaio com o Redis parado de verdade na `demo-degradacao.ps1` (passos 7 e 8), executado em 08/11/2026: 201 em 33 ms, aviso no log, 0 e-mails depois da volta do Redis |
| T-RES-07 | Banco fora não reinicia a API nem o worker | K3 e K7 (`docs/pendencias-bloco-7.md`, seção 9); regra 4 do bloco 6 (liveness sem banco) | kind com o deploy do bloco 6 | `kubectl scale statefulset/postgres -n orbitati --replicas=0`; esperar **45 s** (mais que os 30 s que a liveness levaria para reiniciar); `kubectl get pods` e `/saude`; `--replicas=1` e conferir de novo | Com o banco fora: réplicas da API e worker `0/1` (a readiness os tira do Service), endpoints `ready=false`, **RESTARTS 0**. Com as 2 réplicas fora, o NodePort recusa a conexão (o `curl` dá `000`, não 503: não sobra endpoint para responder). Banco de volta: tudo `1/1`, RESTARTS ainda 0, `/saude` 200 `{db:"ok",fila:"ok"}`, sem intervenção. Apoio unitário: `services/*/test/pool-erro.test.js`. Versão compose: passos 9 e 10 da `scripts/demo-degradacao.ps1` (`/saude` 503 `{db:"fora"}`, `StartedAt` da API e do worker iguais, CRUD depois da volta) | Ensaio operacional | kubectl | 6 | **executado em 08/11/2026.** 1ª execução **reprovou**: os 3 pods reiniciaram no instante da queda (`Unhandled 'error' event` do `pg.Pool`, achado K7). Corrigido com `pool.on('error')`. 2ª execução (16:27:46, banco fora até 16:28:32): `api-contatos` ×2 e `importacao` em `0/1 Running 0`, endpoints `ready=false`; 16:28:47: tudo `1/1 Running 0`, `/saude` 200; log `evento: "banco_conexao_perdida"` em nível warn no lugar do crash |

### 2.7 Rate limit por tenant — bloco 5, `tests/rate-limit.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-RL-01 | Um tenant estoura e o outro segue normal | ADR-003 (vizinho barulhento); números do projeto | tenants individuais A e B | A faz 61 `GET /contatos` em menos de 1 min; logo depois B faz 1 | A: 60 × 200 e a 61ª → 429 com `Retry-After`; B → 200 | Integração | Vitest | 5 | automatizado |
| T-RL-02 | Limite calculado pelo plano | `planos.js` | — | Ler o limite de cada plano | Individual 60 × 1 = 60; equipe 60 × 10 = 600 req/min | Unitário | Vitest | 5 | automatizado (`services/api-contatos/test/limite.test.js`) |
| T-RL-03 | Força bruta no login | Números do projeto | usuário de A | 11 logins com o mesmo IP + e-mail; depois 1 com outro e-mail | 11ª → 429, mesmo com a senha certa; o outro e-mail → resposta normal (a chave é IP + e-mail) | Integração | Vitest | 5 | automatizado |
| T-RL-04 | Limite de cadastro por IP | Números do projeto | `buildApp()` com limite reduzido (3) | 4 cadastros seguidos com `app.inject()` | 4º → 429. Unitário para não bloquear o IP da suíte por 1 min | Unitário | Vitest | 5 | automatizado (`services/api-contatos/test/limite.test.js`) |
| T-RL-05 | `/saude`, `/planos` e `/interno` ficam fora do limite | Bloco 5, item 2 | — | 70 `GET /saude` e 70 `GET /planos` em menos de 1 min | Nenhum 429. O `/interno` (precisa de token de serviço) é conferido pelo T-RL-07 | Integração | Vitest | 5 | automatizado |
| T-RL-06 | `trustProxy`: cada IP atrás do proxy tem o seu contador | Bloco 5, item 5; decisão do bloco 5 (`pendencias-bloco-7.md`, seção 8) | conta de A | **Integração:** 10 logins errados com `X-Forwarded-For: 198.51.100.1`, mais 1 com o mesmo IP e 1 com `198.51.100.2`. **Unitário** (`inject` com `remoteAddress`): conexão de `172.18.0.5` (rede interna) e de `203.0.113.5` (pública), com `X-Forwarded-For`; e `TRUST_PROXY_SALTOS=0` | Integração: 11ª do IP 1 → 429; IP 2 → 401 (contador próprio). Unitário: de rede interna, o `req.ip` vem do header (só o último endereço); de IP público, o header é ignorado (`req.ip = 203.0.113.5`); com 0 saltos, ignorado sempre | Integração e unitário | Vitest | 5 | automatizado (`tests/rate-limit.test.js` e `services/api-contatos/test/limite.test.js`) |
| T-RL-07 | Só `/saude`, `/planos` e `/interno` ficam sem limite | Bloco 5, item 2 | — | `buildApp()` e hook `onRoute`: conferir `config.rateLimit` de cada rota | `rateLimit: false` só nas três; toda rota pública fora delas tem limite **próprio** (o padrão usa o tenant, que ela não tem). Protege as rotas futuras, como o T-ISO-13 | Unitário | Vitest | 5 | automatizado (`services/api-contatos/test/limite.test.js`) |
| T-RL-08 | Limite de confirmação de e-mail | Bloco 10 | — | 11 `GET /auth/confirmar` do mesmo IP em 1 min; 1 de outro IP | 10 chegam à rota (400), o 11º é 429 `LIMITE_REQUISICOES`; o outro IP passa | Unitário | Vitest | 10 | automatizado (`services/api-contatos/test/limite.test.js`) |

### 2.8 Observabilidade — bloco 5

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-OBS-01 | `x-request-id` aceito ou gerado | CLAUDE.md (observabilidade) | — | Requisição com `x-request-id: demo-123`; outra sem o header | 1ª devolve `demo-123`; 2ª devolve um UUID | Integração | Vitest | 5 | automatizado (`tests/observabilidade.test.js`) |
| T-OBS-03 | Status HTTP do `/saude` nas 4 combinações (decisão 2) | CLAUDE.md (observabilidade); contrato, `GET /saude` | — | `buildApp()` com banco e fila **simulados** (ok ou fora) e `inject` em `GET /saude`, em `services/api-contatos/test/saude.test.js` | db ok + fila ok → 200 `{db:"ok",fila:"ok"}`; db ok + fila fora → **200** `{db:"ok",fila:"fora"}`; db fora → **503** (com a fila ok ou fora). Só o banco decide o 503: a `readinessProbe` do kind não tira a API do ar quando só o Redis cai. O caso real (Redis parado de verdade) é o T-RES-04 | Unitário | Vitest | 4 | automatizado |
| T-OBS-02 | O id atravessa a fila | CLAUDE.md | — | Importação com `x-request-id: demo-123`; `docker compose logs \| Select-String demo-123` | Linhas da `api-contatos` **e** da `importacao` com `demo-123`, `reqId` e `tenant_id` | Ensaio operacional | PowerShell | 5 | ensaio executado em 08/11/2026 |
| T-OBS-04 | O log não leva token de link nem e-mail completo | Bloco 10 (pedido da revisão do plano); LGPD | — | Cadastro com e sem fila e confirmação com token bom e ruim, capturando o log; no nginx do Portal, `GET /confirmar-email?token=` e `/api/auth/confirmar?token=` | Nenhuma linha com o token, a assinatura dele ou o e-mail; a URL aparece com `token=[oculto]`; o nginx registra só o caminho; o worker registra `m***@dominio` | Unitário + ensaio | Vitest; `docker logs` | 10 | automatizado (unitário); ensaio do nginx e do kind em 08/11/2026 (0 ocorrências) |

### 2.9 Cenários de qualidade CQ-01, CQ-03, CQ-04 e CQ-05

Critérios copiados de [`atributos.md`](atributos.md). Nenhum threshold é ajustado para o teste passar:
se falhar, o relatório diz que falhou e propõe a causa (regra do bloco 9).

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-CQ01-01 | Vizinho barulhento **com** a mitigação | CQ-01; ADR-003 | `IMPORT_LOTE=100`, `IMPORT_PAUSA_MS=500`; setup cria 1 tenant equipe (o barulhento, no papel da TechConsult; **não** a conta de demonstração do seed) e 10 individuais com 50 contatos cada | Barulhento: 3 importações de **5.000 linhas** (limite do plano Equipe; "500 ou mais" do CQ-01), uma a cada 20 s, com linhas curtas (~50 bytes, como no T-IMP-06) e e-mails diferentes em cada importação; para cada uma, registra a **janela** (do `POST /importacoes` até o `GET /importacoes/:id` devolver `concluida` ou `falhou`). Observadores: 10 VUs, `GET /contatos?busca=` a cada 3 s, por 2 min | **Aprovação (decisão 4):** buscas dos observadores que **começaram dentro de uma janela** com **p95 < 800 ms** e **máx < 2 s** (é o que o CQ-01 descreve: "durante uma importação"). O relatório mostra ao lado o p95 **geral** dos observadores e o **n** de cada grupo. **0 falhas** no total (`http_req_failed rate == 0`) | Carga | k6 | 9 | **aprovado em 08/11/2026** ([relatório](ensaios/cq01-2026-11-08.md)): com o Postgres do tamanho de produção (1 vCPU, 2 GB; `medir-cq01.ps1 -RecursosProducao`), na janela n = 216, p95 5,1 ms, máx 7,7 ms, 0 falhas em 400. Na máquina de desenvolvimento sem limite: p95 4,7 ms, máx 5,9 ms |
| T-CQ01-02 | Mesma carga **sem** a mitigação | CQ-01 (comparação) | `IMPORT_LOTE=5000`, `IMPORT_PAUSA_MS=0` | Igual ao T-CQ01-01 | Sem critério de aprovação: registrar p50/p95/p99/máx, na janela e no geral, com o n de cada grupo, para comparar com T-CQ01-01 em `docs/ensaios/cq01-<data>.md` | Carga | k6 | 9 | **registrado em 08/11/2026** ([relatório](ensaios/cq01-2026-11-08.md)): na janela n = 10 (< 20, só registro); máx na janela 5,6 ms (Postgres de produção) e 4,7 ms (dev). Sem diferença medível para o T-CQ01-01 nas duas situações: virou gatilho de revisão do ADR-003 (decisão mantida) |
| T-CQ03-01 | Onboarding self-service | CQ-03 | Mailpit no Compose | 20 cadastros; medir do POST até a mensagem aparecer na API do Mailpit | **p90 < 45 s** (p90 de 20 = 18º valor ordenado); 0 ações manuais; imprime p50, p90 e máximo | Integração | Vitest | 10 | **automatizado** (`tests/cq03-onboarding.test.js`); 08/11/2026: p50 0,05 s, p90 0,06 a 0,15 s, máx 0,16 s ([relatório](ensaios/cq03-2026-11-08.md)) |
| T-CQ04-01 | Medição de disponibilidade | CQ-04 | stack no ar | `scripts/sonda.ps1 -Minutos 60 -IntervaloSegundos 15`: `/saude` a cada 15 s por 60 min = **240 amostras** (decisão 7) | CSV com data, status e latência; % de sucesso e pior latência. **≥ 99,5%** = no máximo 1 falha em 240. Prova o **método**, não a disponibilidade do mês (conta e limitação na seção 4) | Ensaio operacional | PowerShell | 11 | **executado em 09/11/2026** ([relatório](ensaios/cq04-2026-11-09.md)): 240 de 240 amostras com sucesso, 0 falhas, 0 perdidas = 100,00%; mediana 7,3 ms, p95 17,9 ms, pior 208,2 ms. Prova o método, não o mês (L2) |
| T-CQ04-02 | Deploy sem parada | CQ-04 ("deploy sem downtime") | kind com 2 réplicas da API | Sonda a cada 1 s enquanto roda `kubectl rollout restart deployment/api-contatos -n orbitati` | 0 respostas 5xx ou timeout. **Proposta nova** (seção 5) | Ensaio operacional | PowerShell + kubectl | 6 | **executado em 08/11/2026 (bloco 6):** **113 de 113** respostas 200 em 45 s durante o `rollout restart` das 2 réplicas, 0 falha. Sonda a cada ~0,4 s (pausa de 100 ms + tempo do `curl`), mais densa que o 1 s pedido. Graças ao `preStop: sleep 5` (K4): antes dele, o seed logo depois do rollout falhou com "API fora do ar" e uma sonda igual registrou 9 falhas de conexão. O `scripts/sonda.ps1` do T-CQ04-01 (bloco 11) ainda não existe: a sonda foi um laço de `curl.exe`. **Repetido em 09/11/2026 (bloco 13, Fase 6) para o `deployment/web`** (nginx do Portal, agora na 30080): a sonda a 1 s deu 120/120 com e sem `preStop` (não tem resolução para um rollout); num laço denso de `curl`, **sem** `preStop` 4 de 4 rodadas falharam (7 a 12 falhas cada), **com** `preStop` 4 de 5 rodadas sem nenhuma falha (818/818) e 1 rodada com 10 falhas. **Explicada na repetição de 10/11/2026 (bloco 14)**, com hora em cada requisição e `get pods -w`: as falhas vinham do último pod da troca anterior, **sem** `preStop`, que ainda saía quando o `rollout status` retornou; com `preStop`, 3 de 3 rodadas sem falha depois do restart (1.195/1.195) ([relatório](ensaios/cq04-02-web-2026-11-09.md)) |
| T-CQ05-01 | Restauração cronometrada | CQ-05 | backup recente (`scripts/backup.ps1`) | `scripts/ensaio-restauracao.ps1` em container `postgres-ensaio` separado | Restauração ≤ 30 min e verificação ≤ 60 min (orçamento do CQ-05); somadas aos 45 min de detecção e decisão, total ≤ **4 h**. O relatório declara que o RPO de 15 min **não** é medido localmente (decisão 8, L3) | Ensaio operacional | PowerShell | 11 | **executado em 08/11/2026** ([relatório](ensaios/cq05-2026-11-08.md)): restauração + verificação em **4,0 s** (16.227 contatos, 22 MB) contra 4 h; RPO não provado (ressalva 1 do relatório) |
| T-CQ05-02 | Integridade da cópia restaurada | CQ-05 | T-CQ05-01 | Comparar origem e cópia | Contagem igual em todas as tabelas; políticas em `pg_policies`; `FORCE` ativo; nenhum papel de aplicação com BYPASSRLS. Qualquer divergência reprova | Ensaio operacional | PowerShell | 11 | **executado em 08/11/2026** ([relatório](ensaios/cq05-2026-11-08.md)): 18 de 18 verificações OK |
| T-CQ05-03 | Restaurar um tenant só | ADR-001 (consequência negativa) | T-CQ05-01 | `scripts/restaurar-um-tenant.ps1 -Email <admin>` | CSV só com linhas daquele `tenant_id`; contagem igual à da origem para o tenant | Ensaio operacional | PowerShell | 11 | **executado em 08/11/2026** ([relatório](ensaios/cq05-2026-11-08.md)): dois tenants extraídos, 0 linhas de outros tenants visíveis; prova de ponta a ponta na DevSolo (contato apagado voltou pela importação, sem duplicar) |

### 2.10 Produto e LGPD — blocos 12, 13 e 14

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-PROD-01 | Interação atualiza o contato | Bloco 12, item 2 | contato de A | `POST /contatos/:id/interacoes` | 201; `ultima_interacao_em` atualizado na mesma transação | Integração | Vitest | 12 | automatizado (`tests/interacoes.test.js`) |
| T-PROD-02 | Regra do "esfriando" | Bloco 12, item 3 | contatos com interação há 100 dias, há 10 dias, sem interação e cadastrado há 120 dias (o teste recua o `criado_em` direto no banco: a API sempre grava agora), um recém-criado e um `perdido` | `GET /contatos/esfriando?dias=90` | Vêm o de 100 dias e o sem interação, do mais frio ao mais recente; o de 10 dias, o recém-criado e o `perdido` não vêm | Integração | Vitest | 12 | automatizado (`tests/interacoes.test.js`) |
| T-PROD-03 | Valores fora do domínio | Bloco 12, item 1 | — | Interação com `tipo` inválido; `PATCH` com `estagio` inválido | 400 nos dois | Integração | Vitest | 12 | automatizado (`tests/interacoes.test.js`) |
| T-WEB-01 | O Portal nunca envia `tenant_id` | Regra 1; ADR-002; bloco 13 | Portal no ar | Fluxo inteiro (cadastro, contato, interação, importação) com toda requisição do navegador interceptada | Nenhuma URL, query ou corpo contém "tenant" (o tenant só vai no token, no cabeçalho `Authorization`) | E2E | Playwright, `web/e2e/fluxo.spec.js` | 13 | automatizado: simulador (CI, job `web`) e stack real (compose e kind em 09/11/2026; no CI, job `api`, a partir do push da Fase 6) |
| T-WEB-02 | Fluxo principal no celular (375 px) | Bloco 13, Fase 5; "cadastro em 30 s" | Portal no ar | Cadastrar empresa → contato só com nome (Enter) → interação → importar CSV de 50 linhas com 2 inválidas | Contato aparece sem recarregar em < 30 s; "Último contato hoje" vem da resposta; "48 contatos importados, 2 linhas com erro"; nenhum erro no console (inclui violação de CSP) | E2E | Playwright, `web/e2e/fluxo.spec.js` | 13 | automatizado: simulador (CI, job `web`) e stack real (compose e kind em 09/11/2026; no CI, job `api`, a partir do push da Fase 6) |
| T-WEB-03 | Sessão vencida ou adulterada | ADR-002 (token de 15 min); bloco 13 | empresa nova | Abrir `/contatos` com token de assinatura inválida; com token vencido; sem token | Adulterado: API 401 → `/entrar` com "Sua sessão expirou"; vencido: o mesmo, sem nem chamar a API; token apagado da aba; `?voltar=` guarda a tela; sem token: login sem o aviso | E2E | Playwright, `web/e2e/sessao.spec.js` | 13 | automatizado: simulador (CI, job `web`) e stack real (compose e kind em 09/11/2026; no CI, job `api`, a partir do push da Fase 6) |
| T-WEB-04 | Isolamento visto pela tela | CQ-02; regra 5 | contato e importação de A | B abre `/contatos/<id de A>`, `/importar/<id de A>` e a própria lista | "Não encontramos esse contato." / "...essa importação." (API 404, nunca 403); nada de A aparece | E2E | Playwright, `web/e2e/isolamento.spec.js` | 13 | automatizado: simulador (CI, job `web`) e stack real (compose e kind em 09/11/2026; no CI, job `api`, a partir do push da Fase 6) |
| T-WEB-05 | Erros de importação na tela | Bloco 13, tabela da Fase 3 | empresa nova | Arquivo > 1 MB; CSV sem coluna `email`; fila fora (503 `FILA_INDISPONIVEL` simulado no navegador) | Mensagem da tabela em cada caso, com foco no aviso; > 1 MB nem é enviado; fila fora não derruba o resto do Portal | E2E | Playwright, `web/e2e/importacao-erros.spec.js` | 13 | automatizado: simulador (CI, job `web`) e stack real (compose e kind em 09/11/2026; no CI, job `api`, a partir do push da Fase 6). Fila fora **real** (Redis parado, 09/11/2026): `POST /api/importacoes` pelo nginx devolveu 503 com o corpo idêntico ao simulado no E2E e ao contrato; `/api/saude` `fila: fora`; lista de contatos seguiu 200 |
| T-WEB-06 | nginx do Portal | Bloco 13, Fase 4 | imagem `orbitati/web` no ar | `/healthz`; `/api/saude`; `/api/interno` e variações (`//`, `%69`, `../`); `x-request-id`; cabeçalhos; cache; CSV de 1,5 MB pelo proxy | 200; proxy remove `/api`; interno → 404; id repassado ou gerado; CSP, nosniff, no-referrer, sem HSTS; assets 1 ano imutável com gzip; 413 `ARQUIVO_GRANDE` vem da API em JSON | E2E | Playwright, `web/e2e/nginx.spec.js` e `importacao-erros.spec.js` | 13 | automatizado: simulador (CI, job `web`) e stack real (compose e kind em 09/11/2026; no CI, job `api`, a partir do push da Fase 6) |
| T-WEB-07 | Acessibilidade no celular | WCAG 2.5.8 e 2.4.11; checklist da skill | empresa com 12 contatos | Medir alvos de toque em 7 telas (375 px); Tab por Contatos, Contato e Conta | Todo alvo ≥ 44 × 44 px; nenhum foco atrás da barra inferior ou do botão "+" | E2E | Playwright, `web/e2e/acessibilidade.spec.js` | 13 | automatizado: simulador (CI, job `web`) e stack real (compose e kind em 09/11/2026; no CI, job `api`, a partir do push da Fase 6) |
| T-WEB-08 | Layout em 4 larguras × 2 temas | Bloco 13, Fase 5 | conta de demonstração (seed) | Capturar 8 telas em 375, 768, 1024 e 1440 px, claro e escuro | Nenhuma rolagem horizontal, nenhum texto vazando da caixa; 64 capturas revisadas a olho | E2E + revisão | Playwright, `web/e2e/capturas.spec.js` | 13 | automatizado (simulador); stack real em 09/11/2026 com o seed: 64/64 (o "Saindo de órbita" tem 3 itens, sem o "nunca contatado" frio). Rate limit: 49 chamadas contadas da DevSolo (Individual, 60/min) por execução; a captura que recebe 429 espera o `Retry-After` e é refeita (provado esgotando a cota antes) |
| T-WEB-09 | Desempenho e acessibilidade (Lighthouse mobile) | CQ-01 (4G no orçamento); bloco 13 | Portal no ar | `npm run lighthouse` em `/entrar` e `/contatos`, claro e escuro, cache vazio | Desempenho ≥ 90, Acessibilidade ≥ 95, Boas práticas ≥ 95, JS inicial ≤ 170 KB gzip | Ensaio | `web/scripts/medir-lighthouse.mjs`; [simulador](ensaios/portal-lighthouse-2026-11-07.md), [stack real](ensaios/portal-lighthouse-2026-11-09.md) | 13 | feito em 07/11/2026 (simulador): 93–98 / 100 / 100, 103–112 KB; em 09/11/2026 (stack real): 92–98 / 100 / 100, 103–112 KB |
| T-LGPD-01 | Exportação só para admin e sem senha | LGPD (exportação) | admin e consultor em A | `GET /conta/exportacao` com cada um | Admin → 200 sem `senha_hash`; consultor → 403 (autorização dentro do próprio tenant, por isso 403 e não 404) | Integração | Vitest | 14 | automatizado (`tests/lgpd.test.js`; também visualizador; o token de outro papel é assinado à mão, porque ainda não existe convite) |
| T-LGPD-02 | Tenant cancelado não entra | LGPD (cancelar) | A cancelado | Login de um usuário de A | 401 | Integração | Vitest | 14 | automatizado (`tests/lgpd.test.js`: mesmo corpo da senha errada; E2E `web/e2e/conta.spec.js`) |
| T-LGPD-03 | Exclusão após 30 dias, só de quem deve | LGPD (excluir); R4 | Tenants cancelados há 31 e há 29 dias e um ativo (data simulada) | Rodar o job de exclusão | O de 31 dias some de todas as tabelas; o de 29 e o ativo ficam intactos | Integração | Vitest | 14 | automatizado (`tests/lgpd.test.js`: confere todas as tabelas com `tenant_id` dos dois schemas, lidas do catálogo; com a fila fora, o tenant é adiado e nada é apagado; o link do excluído vira 400). Ligação real pela fila conferida com `src/excluir-agora.js` em 10/11/2026 |
| T-LGPD-04 | Link de exportação | LGPD (30 dias de exportação); decisão do bloco 10 para tokens com `finalidade` | C cancelado, e-mail no Mailpit | Baixar pelo link do e-mail (API e Portal); usar o token do link como sessão; usar sessão, token de confirmação, token adulterado, vencido, vazio e gigante como link | Link → 200 com o JSON de C, vence em `cancelado_em + 30 dias`, aponta para `PORTAL_URL/api`; como sessão → 401; o resto → 400 `LINK_INVALIDO` | Integração | Vitest + Mailpit | 14 | automatizado (`tests/lgpd.test.js`) |
| T-LGPD-05 | Pedir o link de novo e fila fora | Contrato 1.6; problema da N9 | admin | Cancelar duas vezes; cancelar com a fila simulada fora | Mesmas datas e **2 e-mails** (jobIds diferentes, sem `:`); fila fora → 503 `FILA_INDISPONIVEL`, conta continua ativa e o login funciona | Integração | Vitest (stack real e API no processo) | 14 | automatizado (`tests/lgpd.test.js`) |

---

## 3. Matriz de rastreabilidade

### 3.1 Cenários de qualidade

| Cenário | Medida | Testes |
|---|---|---|
| CQ-01 — vizinho barulhento | p95 < 800 ms; p100 < 2 s; 0 erros 5xx | T-CQ01-01, T-CQ01-02; apoio: T-IMP-13 (pausa), T-IMP-08 (simultâneas), T-RL-01 |
| CQ-02 — isolamento | 100% das tentativas → 404; 100% das rotas; build falha | T-ISO-01 a T-ISO-19, T-IMP-02, T-RLS-01 a ~~T-RLS-16~~ T-RLS-21 (10/11/2026: o 18 a 21 vieram depois); pela tela: T-WEB-04 |
| CQ-03 — onboarding | p90 < 45 s; 0 ações manuais | T-CQ03-01, T-AUTH-01, T-AUTH-09, T-AUTH-13, T-RES-06 |
| CQ-04 — disponibilidade | 99,5% em horário comercial; ≤ 79 min/mês | T-CQ04-01, T-CQ04-02; apoio: T-RES-01, T-RES-04, T-RES-07 |
| CQ-05 — recuperação | RPO ≤ 15 min; RTO ≤ 4 h | T-CQ05-01, T-CQ05-02, T-CQ05-03 (só RTO; o RPO não é testado, ver lacunas) |

### 3.2 ADRs

| ADR | Decisão | Testes |
|---|---|---|
| [ADR-001](adr/adr-001-tenancy.md) | Pool + RLS com `FORCE` | T-RLS-01 a ~~T-RLS-17~~ T-RLS-21 (10/11/2026), T-CQ05-03 (restore por tenant) |
| [ADR-002](adr/adr-002-identidade-tenant.md) | `tenant_id` só no JWT; token de 15 min | T-ISO-06, 07, 10, 11, 13, 14, 15; T-AUTH-04, 06, 07; T-WEB-01 |
| [ADR-003](adr/adr-003-processamento-assincrono.md) | Fila, lote de 100, pausa de 500 ms, quota | T-IMP-01, 05, 06, 08, 12, 13, 14; T-RES-01 a 05; T-CQ01-01 e 02 |

### 3.3 Regras de multi-tenancy do `CLAUDE.md`

| Regra | Testes |
|---|---|
| 1. Nenhuma rota aceita `tenant_id` | T-ISO-06, T-ISO-07, T-ISO-13, T-ISO-14, T-WEB-01 |
| 2. Todo acesso passa por `withTenant` | T-RLS-03 (prova o mecanismo); indireta: toda a seção 2.2 |
| 3. RLS `ENABLE` + `FORCE` + política com `NULLIF` | T-RLS-01 a 04, T-RLS-08, T-RLS-15, T-RLS-16 |
| 4. `tenant_id` com DEFAULT | T-RLS-13 |
| 5. Outro tenant → 404; conferir `rowCount` | T-RLS-05, T-RLS-06, T-ISO-01 a 03, T-ISO-05, T-ISO-08, T-ISO-09 |
| 6. Papéis do Postgres | T-RLS-07, 08, 09, 10, 12, 14 |
| 7. Importação grava pela API com token de serviço | T-ISO-09, T-ISO-12, T-IMP-10, T-IMP-11 |
| 8. Idempotência e e-mails minúsculos | T-RLS-11, T-RLS-17, T-IMP-04, T-IMP-09, T-IMP-14, T-CON-03, T-AUTH-02 |

### 3.4 Números do projeto

| Número | Teste |
|---|---|
| Lote de 100 e pausa de 500 ms | T-IMP-01 (3 lotes), T-IMP-13 (≥ 24,5 s) |
| 100 / 5.000 linhas e 1 MB | T-IMP-05, T-IMP-06, T-IMP-07 |
| 2 / 5 importações simultâneas | T-IMP-08 |
| Rate limit 60 / 600 | T-RL-01, T-RL-02 |
| Login 10/min por IP + e-mail | T-RL-03, T-RL-06 (IP real atrás do proxy) |
| Cadastro `LIMITE_CADASTRO_POR_MIN` | T-RL-04 |
| Confirmação de e-mail 10/min por IP | T-RL-08 |
| Link de confirmação de 24 h | `services/api-contatos/test/confirmacao.test.js` (`exp − iat = 86.400`) |
| Token de 15 min | T-AUTH-07 |
| Token de serviço de 60 s | T-IMP-11 |
| CQ-01 p95 < 800 ms | T-CQ01-01 |
| CQ-02 100% → 404 | seção 2.2 |

### 3.5 Lacunas: o que ficou sem teste

Situação de cada lacuna:

- **Resolvida:** passou a ter teste ou deixou de ser lacuna.
- **Limitação declarada:** não é medida no projeto, e isso é dito no relatório e na defesa.
- **Aberta:** ainda falta decidir.

| # | O que | Situação | Por quê | O que falta |
|---|---|---|---|---|
| L1 | CQ-02 pede "evento registrado no log de auditoria" no 404 cruzado | **Resolvida** (decisão 6, bloco 3) | Com RLS, a API não distingue "de outro tenant" de "inexistente" (os dois são 0 linhas). Por isso todo 404 em rota com `:id` gera o evento `recurso_nao_encontrado` com `tenant_id`, rota e id, coberto pelo T-ISO-19 | **Feito no Bloco 7** (08/11/2026): texto do CQ-02 em [`atributos.md`](atributos.md#cq-02) |
| L2 | CQ-04: 99,5% ao mês | **Limitação declarada** (decisão 7) | A sonda passa a 15 s por 60 min = 240 amostras, e 1 falha pesa 0,42% (< 0,5%): o ensaio já consegue reprovar. Mas 60 min não são o mês, e 0 falhas em 240 não provam 99,5% (conta na seção 4) | Bloco 11: o relatório declara que é medição de **método**; a medida real é a sonda rodando o mês em produção. **Feito em 09/11/2026:** 240 de 240, 0 falhas ([`ensaios/cq04-2026-11-09.md`](ensaios/cq04-2026-11-09.md)) |
| L3 | CQ-05: RPO de 15 min | **Limitação declarada** (decisão 8) | Depende de arquivamento contínuo de WAL, que é recurso do banco gerenciado. O ensaio local prova o procedimento e o RTO | Bloco 11: ressalva no `docs/ensaios/cq05-<data>.md`. Nota no CQ-05 do [`atributos.md`](atributos.md#cq-05): **feita no Bloco 7** (08/11/2026) |
| L4 | CQ-03: parte do provedor de e-mail | **Limitação declarada** | Localmente não existe provedor real (96% do orçamento de 45 s) | **Feito no bloco 10:** ressalva no [relatório](ensaios/cq03-2026-11-08.md) |
| L5 | ADR-002: refresh token de 7 dias e denylist em Redis | **Limitação declarada** (decisão 9) | Fora do escopo do semestre. Token de 15 min sem refresh: ao expirar, o usuário entra de novo. Usuário removido mantém acesso por até 15 min | **Feito no Bloco 7** (08/11/2026): o [ADR-002](adr/adr-002-identidade-tenant.md) declara isso como decisão, com gatilhos de revisão |
| L6 | ADR-003: prioridade por plano na fila e "429 com tempo de espera no corpo" | **Aberta** | Não estão nos prompts dos blocos | Decidir no ADR-004 se ficam; se ficarem, criar teste |
| L7 | ADR-003: "intervalo de 5 min entre jobs" | **Resolvida** (decisão D2) | Substituído pelo lote, pela pausa e pela `concurrency: 2`; não há o que testar | **Feito no Bloco 7** (08/11/2026): nota de revisão no [ADR-003](adr/adr-003-processamento-assincrono.md) |
| L8 | Gerador de Documentos, S3 e R6 da LGPD (URL de PDF) | **Aberta** (fora das Etapas 2 e 3) | Os containers não existem | Criar testes quando existirem. Notificações saiu desta lacuna no bloco 10 (T-AUTH-09 a 13, T-RES-06, T-OBS-04, T-CQ03-01) |

Casos que **este plano acrescenta** e que não estão nos prompts dos blocos (combinar antes de automatizar):
T-RLS-06 (DELETE cruzado), T-RLS-13 a 17, T-ISO-05, 06, 07, 12, 15, T-AUTH-03, 07, 08, T-CON-02 a 04,
T-IMP-03 a 08, 11 a 14, T-RL-02 a 07, T-OBS-01, T-CQ04-02, T-RES-07, T-PROD-03, T-LGPD-01 (T-RL-06 e 07 combinados no plano do bloco 5).
T-WEB-02 a T-WEB-09 vieram do bloco 13 (Fases 4 e 5) e já estão automatizados contra o simulador do
contrato; ~~falta rodá-los contra a stack real (Fase 6, ver [`portal-pendencias.md`](portal-pendencias.md)).~~
**10/11/2026:** rodados contra a stack real na Fase 6 (compose e kind, 09/11/2026), e o CI roda os E2E
(`npm run test:e2e`, projeto `e2e` do Playwright) contra a API real no job `api` (`.github/workflows/ci.yml`,
passo "E2E do Portal contra a API real"). Ficam fora do CI o T-WEB-08 (`npm run capturas`, projeto separado)
e o T-WEB-09 (Lighthouse), que são rodados à mão.

### 3.6 Onde está cada caso que o arquivo não cita pelo ID

Nota de 10/11/2026 (Bloco 15). A convenção do plano é o arquivo de teste citar o ID. Estes casos são
executados, mas o ID **não aparece** no arquivo que os executa. Como o código não vai ser alterado agora,
este mapa é a ligação oficial:

| ID | Arquivo que executa | Como encontrar o caso no arquivo |
|---|---|---|
| T-WEB-02 | `web/e2e/fluxo.spec.js` | o único teste do arquivo ("cadastrar → contato só com nome → interação → importar 50 linhas"); o T-WEB-01 é um `test.step` dentro dele |
| T-WEB-03 | `web/e2e/sessao.spec.js` | `describe('sessão')` |
| T-WEB-04 | `web/e2e/isolamento.spec.js` | `describe('isolamento visto pela tela')` |
| T-WEB-05 | `web/e2e/importacao-erros.spec.js` | `describe('erros de importação')` |
| T-WEB-06 | `web/e2e/nginx.spec.js` (e o teste "arquivo maior que 1 MB pela API" de `importacao-erros.spec.js`) | `describe('nginx do Portal')` |
| T-WEB-07 | `web/e2e/acessibilidade.spec.js` | "alvos de toque >= 44 px" e "Tab nunca deixa o foco atrás..." |
| T-WEB-08 | `web/e2e/capturas.spec.js` | projeto `capturas` (`npm run capturas`) |
| T-WEB-09 | `web/scripts/medir-lighthouse.mjs` | `npm run lighthouse` |
| T-CQ04-01 | `scripts/sonda.ps1` | relatório [`ensaios/cq04-2026-11-09.md`](ensaios/cq04-2026-11-09.md) |
| T-CQ04-02 | `scripts/sonda.ps1` (sonda a 1 s) e laço de `curl.exe` descrito no relatório | relatório [`ensaios/cq04-02-web-2026-11-09.md`](ensaios/cq04-02-web-2026-11-09.md) |
| T-CQ05-01 | `scripts/backup.ps1` + `scripts/ensaio-restauracao.ps1` | relatório [`ensaios/cq05-2026-11-08.md`](ensaios/cq05-2026-11-08.md), seção 3.2 |
| T-CQ05-02 | `scripts/ensaio-restauracao.ps1` (verificação com `scripts/sql/`) | mesmo relatório, "Verificações (18 de 18 OK)" |
| T-CQ05-03 | `scripts/restaurar-um-tenant.ps1` | mesmo relatório, seção 3.3 |

O `web/e2e/conta.spec.js` (exportar e cancelar pela tela) apoia o T-LGPD-01 (exportação sem senha) e o
T-LGPD-02 (a linha do T-LGPD-02 já cita o arquivo).

---

## 4. Contas por trás dos números

Nenhum número novo foi criado. Os que aparecem aqui vêm do `CLAUDE.md`, do [`atributos.md`](atributos.md)
ou dos prompts dos blocos, e os derivados têm a conta ao lado.

| Número | Conta | Origem |
|---|---|---|
| 3 lotes no T-IMP-01 | ⌈250 ÷ 100⌉ = 3 | lote de 100 |
| ≥ 24,5 s no T-IMP-13 | 5.000 ÷ 100 = 50 lotes → 49 pausas × 0,5 s | lote e pausa |
| 5.000 linhas | 1 MB ÷ ~200 bytes por linha ≈ 5.242, arredondado para baixo | D2 |
| Linhas de ~50 bytes no T-IMP-06 | 5.001 × 50 ≈ 250 KB, bem abaixo de 1 MB, para o 422 não virar 413. A linha não pode passar de 1.048.576 ÷ 5.001 ≈ 209 bytes | limite de 1 MB |
| 1.048.577 bytes no T-IMP-07 | 1 MB = 1.024 × 1.024 = 1.048.576 bytes, mais 1 | `bodyLimit` |
| 61ª requisição no T-RL-01 | 60 req/min × 1 usuário do plano individual = 60 | `planos.js` |
| 600 no T-RL-02 | 60 × 10 usuários do plano equipe | `planos.js` |
| Rate limit não atrapalha o CQ-01 | Observador: 1 busca a cada 3 s = 20 req/min < 60 do individual | CQ-01 e `planos.js` |
| 900 s no T-AUTH-07 | 15 min × 60 | token de 15 min |
| p90 de 20 execuções | ⌈0,9 × 20⌉ = 18º valor ordenado | CQ-03 |
| 20 cadastros não estouram o limite | 20 < 60 cadastros por minuto | `LIMITE_CADASTRO_POR_MIN` |
| 503 em < 2 s | Valor do `prompts/bloco-05.md`; é o mesmo teto do p100 do CQ-01 | bloco 5 |
| Amostras do T-CQ01-01 (geral) | 10 VUs × (120 s ÷ 3 s) = 400 buscas; o p95 é a 380ª | CQ-01 e bloco 9 |
| Por que 5.000 linhas no barulhento do CQ-01 | Com 500 linhas, cada importação tem 5 lotes e 4 pausas × 0,5 s = 2 s de pausa: janelas de poucos segundos e só ≈ 20 a 50 buscas dentro delas, e com n = 20 o p95 é o 19º valor, quase o máximo. Com 5.000 linhas: 50 lotes → 49 pausas × 0,5 s ≥ 24,5 s por importação. Começando em 0, 20 e 40 s, as janelas se sobrepõem, e a união vai de 0 a ≥ 64,5 s. Os observadores fazem 10 ÷ 3 s ≈ 3,3 buscas/s → 3,3 × 64,5 ≈ **215, ou seja, ≈ 200 buscas na janela** (estimativa; o relatório registra o n real) | decisão 4 + decisão do bloco 9 |
| Tamanho do CSV do barulhento | 5.000 linhas de ~50 bytes + cabeçalho ≈ 250 KB < 1 MB. A linha não pode passar de 1.048.576 ÷ 5.001 ≈ 209 bytes; com nome, e-mail, telefone, empresa e observação preenchidos, o CSV passaria de 1 MB e daria 413 em vez de carga | limite de 1 MB; T-IMP-06 |
| Concorrência do barulhento | Na pior hipótese, as 3 importações estão ativas ao mesmo tempo: 3 ≤ 5 importações simultâneas do plano Equipe (não dá 429). O worker processa no máximo 2 ao mesmo tempo (`concurrency: 2`); a terceira, que começa em 40 s, encontra a primeira já perto do fim | `planos.js`; worker |
| T-CQ01-02 (sem mitigação) com 5.000 linhas | `IMPORT_LOTE=5000`: cada importação vira **1 lote de 5.000 contatos** num só `POST /interno/importacoes/:id/lotes`. Em JSON, ~100 a 150 bytes por contato ≈ 500 a 750 KB, perto do `bodyLimit` padrão do Fastify (1 MB). O bloco 9 confere esse limite na rota `/interno` antes de rodar. **Conferido:** a rota `/lotes` tem `bodyLimit` próprio de 4 MB (`interno.js`); com linhas curtas, o lote de 5.000 fica bem abaixo disso. A janela fica curta (sem pausa), então o n "na janela" é pequeno; como o T-CQ01-02 não tem critério de aprovação, o relatório só o declara | decisão do bloco 9 |
| Restauração ≤ 30 min, verificação ≤ 60 min | Linhas da tabela do RTO no CQ-05; detecção (15) + decisão (30) = 45 min não são medidos localmente | CQ-05 |
| 240 amostras da sonda (decisão 7) | 60 min × 60 s ÷ 15 s = 240. A versão anterior (30 min a cada 60 s = 30 amostras) não servia: 1 falha já derrubava para 96,7%. Para que 1 falha pese **no máximo** 0,5%, são precisas 1 ÷ 0,005 = 200 amostras; 240 passa disso. Cada amostra vale 0,42%: 0 falhas = 100%; 1 falha = 99,58% (aprova); 2 falhas = 99,17% (reprova). Cada amostra representa 15 s de serviço | CQ-04 |
| Limitação das 240 amostras | 0 falhas em 240 **não prova** 99,5%: pela "regra de três" da estatística, com 0 falhas em n amostras o limite superior da taxa de falha (95% de confiança) é 3 ÷ n = 3 ÷ 240 = 1,25%. Provar 99,5% com 0 falhas exigiria 3 ÷ 0,005 = 600 amostras (150 min a cada 15 s). E 60 min não representam o mês: o mês comercial tem 12 h × 22 dias = 264 h, e 0,5% disso são 79 min (os do CQ-04). O ensaio prova o **método**; a medida real é a sonda rodando o mês em produção (L2) | CQ-04 |
| 24 casos do CQ-02 | 12 rotas do C4 × 2; ~~na Etapa 2 são 8 rotas~~ na Etapa 2 eram 10 rotas com dado de tenant (seção 2.2); hoje (10/11/2026, Bloco 15) são 15 das 21 rotas, todas cobertas pelo T-ISO-15 (ver nota do CQ-02 em [`atributos.md`](atributos.md#cq-02)) | CQ-02 |

---

## 5. Pontos de atenção encontrados ao escrever o plano

Problemas que os testes vão expor. A solução sugerida vem ao lado, para decidir antes do bloco correspondente.

1. **As 12 situações de RLS.** As 12 situações de isolamento validadas num PostgreSQL 16 real em 29/10/2026
   estão mapeadas na seção 2.1. O cadastro de tenant é o T-RLS-18, e o DELETE cruzado (T-RLS-06) fica como extra.
   Os IDs foram mantidos.
2. **Status HTTP do `/saude` com a fila fora.** No kind, a `readinessProbe` usa `/saude`. Se a resposta for 503
   quando o Redis cai, o Kubernetes tira **todas** as réplicas da API do ar, contrariando o "fila fora não
   derruba a API". **Decidido (decisão 2):** `/saude` responde HTTP 200 com `fila:"fora"` quando só o Redis
   cai, e 503 apenas com o banco fora. Coberto pelo T-OBS-03 (unitário, as 4 combinações) e pelo T-RES-04
   (ensaio com o Redis parado de verdade).
3. **Store do rate limit × Redis fora.** Se o `@fastify/rate-limit` guardar os contadores no Redis, o T-RES-04
   falha: com o Redis fora, toda requisição dá erro. Em memória, com 2 réplicas no kind, o limite efetivo
   dobra (2 × 60 = 120 req/min no individual). **Decidido (decisão 3):** contadores no **Redis**, com
   `skipOnError: true`. Com o Redis fora, o limite deixa de valer em vez de derrubar a API, e volta sozinho
   quando o Redis volta. Risco aceito: enquanto o Redis estiver fora, não há rate limit (nem o de login).
   É curto e visível (`/saude` mostra `fila:"fora"`), e o RLS continua isolando os tenants. Conferido no
   T-RES-04 (requisições seguem 2xx com o Redis parado). Já está no `CLAUDE.md` (números do projeto).
4. **CQ-01 pode ficar diluído.** 3 importações de 500 linhas são 15 lotes. Com a pausa, o barulhento trabalha
   só uma parte dos 2 minutos, e o p95 das 400 buscas inclui muitas feitas com o banco ocioso. O teste pode
   passar sem provar nada. **Decidido (decisão 4):** o relatório do bloco 9 mostra o p95 das buscas feitas
   **durante** as janelas de importação, separado do p95 geral, e a aprovação do CQ-01 usa o da janela.
   **Decidido também (08/11/2026):** com importações de 500 linhas as janelas seriam curtas, com só ≈ 20 a 50
   buscas dentro delas, e o p95 da janela seria quase o máximo. Por isso o barulhento faz **3 importações de
   5.000 linhas** num tenant do plano Equipe (no papel da TechConsult), com linhas curtas como no T-IMP-06.
   Isso continua dentro do "500 ou mais" do CQ-01 e dá ≈ 200 buscas na janela (contas na seção 4). O relatório
   registra o n de cada grupo. O tenant é criado pelo setup do k6, não é a conta de demonstração do seed:
   15 mil contatos a mais estragariam a demo de isolamento e as capturas do Portal.
5. **Teste de concorrência instável.** Uma importação individual de 100 linhas é um lote só e termina em cerca de
   1 s. Disparar 3 seguidas e esperar 429 depende de quem chega primeiro. *Solução:* a fixture do T-IMP-08
   cria as importações `na_fila` direto no banco.
6. **Limite de cadastro × suíte inteira.** Todos os testes rodam do mesmo IP. Se a suíte criar mais de 60
   tenants por minuto, ela mesma recebe 429. *Solução:* reaproveitar tenants dentro de cada arquivo de teste e
   manter o padrão de 60 (o T-RL-04 testa o limite com valor reduzido, sem afetar a suíte).
7. **"100% das rotas cobertas" depende de alguém lembrar.** A tabela de rotas do `isolamento.test.js` só cobre o
   que for adicionado nela. *Solução:* T-ISO-15 compara as rotas registradas com a tabela e falha se faltar alguma.

---

## 6. Critério de pronto por etapa

| Etapa | Blocos | Precisa passar |
|---|---|---|
| **Etapa 2** — núcleo multi-tenant | 1 a 7 | `npm test` verde com T-RLS-01 a 17, T-ISO-01 a 13, 15 e 19, T-AUTH-01 a 08, T-CON-01 a 04, T-IMP-01 a 13 e 15 a 22, T-RL-01 a 05, T-OBS-01 e T-OBS-03. Ensaios T-RES-01 a 05, T-IMP-14 e T-OBS-02 executados com saída registrada. `scripts/demo-isolamento.ps1` rodando até o fim no Compose e no kind |
| **Etapa 3** — qualidade medida | 8 a 11 | Tudo da Etapa 2 rodando **no CI** a cada push. T-ISO-14 demonstrado (build vermelha com rota proibida). T-CQ01-01 aprovado e T-CQ01-02 registrado em `docs/ensaios/cq01-<data>.md`. T-CQ03-01 aprovado e T-RES-06 executado. T-CQ04-01 e T-CQ04-02 e T-CQ05-01 a 03 com relatório em `docs/ensaios/` |
| **Etapa 4** — produto e entrega | 12 a 15 | Tudo das etapas 2 e 3, mais T-ISO-16 a 18, T-PROD-01 a 03, T-WEB-01 a T-WEB-09 (contra a stack real) e T-LGPD-01 a 03. T-RLS-15 continua verde com a tabela `interacoes`. Lacunas da seção 3.5 resolvidas ou declaradas na defesa |

Uma etapa só está pronta se **nenhum** teste de isolamento (T-RLS, T-ISO) estiver vermelho ou desativado.
O CQ-02 não admite exceção: um vazamento em mil continua sendo vazamento.

---

## Referências

- Regras e números: [`../CLAUDE.md`](../CLAUDE.md)
- Cenários CQ-01 a CQ-05: [`atributos.md`](atributos.md)
- Decisões: [ADR-001](adr/adr-001-tenancy.md), [ADR-002](adr/adr-002-identidade-tenant.md), [ADR-003](adr/adr-003-processamento-assincrono.md)
- LGPD: [`lgpd.md`](lgpd.md)
- Decisões D1 a D4 e lacunas: [`pendencias-bloco-7.md`](pendencias-bloco-7.md)
- Prompts dos blocos: [`../prompts/`](../prompts/)

*Documento versionado em `docs/plano-de-testes.md`.*

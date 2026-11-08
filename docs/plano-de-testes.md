# Plano de testes do OrbitaTI

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen
**Escrito em:** 29/10/2026, antes do código da Etapa 2
**Status:** todos os casos estão **planejados**. Cada bloco que automatiza um caso troca o status dele neste arquivo.

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
| **Integração contínua** | A suíte inteira roda a cada push e a build vermelha bloqueia o merge (CQ-02) | GitHub Actions (`.github/workflows/ci.yml`) | a partir do bloco 8 |

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
(DELETE cruzado) não está entre as 12: fica como extra, junto com T-RLS-13 a 17 e T-RLS-19.

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
| T-RLS-19 | Nenhuma função `SECURITY DEFINER` de `orbita` fica aberta | Regra 6; decisão do bloco 1 (o PostgreSQL dá `EXECUTE` a `PUBLIC` em toda função nova) | — | Listar as funções `SECURITY DEFINER` de `orbita` e conferir `has_function_privilege` para `public`, `importacao_svc` e `api_contatos`; como `migrador`, criar uma função nova numa transação desfeita | Nenhuma executável por `PUBLIC` nem por `importacao_svc`; só `buscar_credencial` executável, e só por `api_contatos`; a função nova nasce sem `EXECUTE` para ninguém (`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`). É o equivalente do T-RLS-15 para funções: protege a função do bloco 14 (dona `orbita_auth`, com `BYPASSRLS`) | Integração | Vitest + pg | 1 | automatizado (`tests/rls.test.js`) |

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
| T-ISO-08 | Importação de outro tenant | CQ-02; regra 5 | importação de B | A faz `GET /importacoes/:idB` | 404 | Integração | Vitest | 4 | planejado |
| T-ISO-09 | Token de serviço de A não grava lote em importação de B | Regra 7; CQ-02 | idem | Token de serviço com `tenant_id = A` em `POST /interno/importacoes/:idB/lotes` | 404; nenhum contato novo em A nem em B | Integração | Vitest | 4 | planejado |
| T-ISO-10 | JWT adulterado | ADR-002 | token de A | Trocar o `tenant_id` do payload para B **sem reassinar** e chamar `GET /contatos` | 401 | Integração | Vitest | 3 | automatizado |
| T-ISO-11 | JWT expirado | ADR-002 | — | Token assinado com `JWT_SEGREDO` e `exp` no passado | 401 | Integração | Vitest | 3 | automatizado |
| T-ISO-12 | Token de serviço não serve em rota de usuário | Regra 7 (dois segredos) | — | Token de serviço válido em `GET /contatos` | 401 | Integração | Vitest | 4 | planejado |
| T-ISO-13 | Nenhuma rota aceita `tenant_id` | Regra 1; ADR-002 | — | `buildApp()` + hook `onRoute`: procurar "tenant" no caminho e nos nomes de propriedade dos schemas de params, querystring e corpo. Contra-teste: registrar rotas proibidas e conferir que o verificador acusa (`services/api-contatos/test/rotas-sem-tenant.test.js`) | Nenhuma ocorrência; o teste falha se aparecer | Unitário | Vitest | 3 | automatizado |
| T-ISO-14 | A regra acima bloqueia a build | CQ-02 ("build falha se a suíte falhar") | CI ativo | Branch descartável com rota `/tenants/:tenant_id/contatos`; push | Workflow vermelho; o branch é apagado | Integração contínua | GitHub Actions | 8 | planejado |
| T-ISO-15 | Toda rota com dado de tenant está na tabela da suíte | CQ-02 ("100% das rotas cobertas") | — | (a) As rotas com `config.publica` são exatamente as de uma lista fixa (hoje `GET /saude`, `POST /auth/cadastro`, `POST /auth/login`; os blocos 4, 10 e 14 acrescentam `/planos`, `/auth/confirmar` e `/conta/exportacao/arquivo`). (b) As demais rotas registradas no `onRoute` (sem HEAD) são exatamente as da tabela de `isolamento.test.js` | Rota fora da tabela, rota fantasma na tabela ou rota pública não prevista → falha. A lista fixa impede que marcar uma rota como pública seja um jeito de escapar da autenticação e da suíte ao mesmo tempo | Unitário | Vitest | 3 | automatizado |
| T-ISO-16 | Interações de contato de outro tenant | CQ-02 | contato de B | A faz `GET` e `POST /contatos/:idB/interacoes` | 404 nos dois; nenhuma interação criada | Integração | Vitest | 12 | planejado |
| T-ISO-17 | "Esfriando" não mostra contatos de outro tenant | CQ-02 | contatos frios em B | A faz `GET /contatos/esfriando` | Nenhum id de B | Integração | Vitest | 12 | planejado |
| T-ISO-18 | Exportação só traz o próprio tenant | CQ-02; LGPD | dados em A e B | A (admin) faz `GET /conta/exportacao` | Nenhum id, e-mail ou nome de B no JSON | Integração | Vitest | 14 | planejado |
| T-ISO-19 | Todo 404 em rota com `:id` gera o evento `recurso_nao_encontrado` no log | CQ-02 ("evento registrado no log"); decisão 6 | contato de B; API montada no processo do teste (`buildApp()` com o log numa lista) | Para cada linha da tabela de rotas com `:id`, A chama a rota com o id de B; depois, `GET /contatos/nao-e-uuid` e uma rota inexistente | Um evento por 404, com `tenant_id` de A, `metodo`, `rota` (`/contatos/:id`) e `id`. O `:id` que não é UUID também gera o evento; rota inexistente não gera | Integração | Vitest | 3 | automatizado |

**Cobertura de rotas na Etapa 2.** O [`atributos.md`](atributos.md#cq-02) dimensiona **24 casos** =
12 rotas previstas no C4 × 2 (leitura e escrita cruzadas). Essa conta vale para o produto completo.
Na Etapa 2 existem 8 rotas com dado de tenant, e cada uma tem pelo menos um caso para a operação que faz:

| Rota | Leitura cruzada | Escrita cruzada |
|---|---|---|
| `GET /contatos` | T-ISO-04, T-ISO-07 | — (não escreve) |
| `POST /contatos` | — (não lê de outro) | T-ISO-06 |
| `GET /contatos/:id` | T-ISO-01, T-ISO-05 | — |
| `PATCH /contatos/:id` | — | T-ISO-02 |
| `DELETE /contatos/:id` | — | T-ISO-03 |
| `POST /importacoes` | — | T-IMP-02 |
| `GET /importacoes/:id` | T-ISO-08 | — |
| `POST /interno/importacoes/:id/lotes` | — | T-ISO-09 |

8 de 8 rotas cobertas = **100%**, com 10 casos de rota mais 3 de token (T-ISO-10 a 12). A conta de 24 volta a
valer quando as 12 rotas do C4 existirem. O T-ISO-15 garante que nenhuma rota nova fique de fora.

### 2.3 Autenticação — bloco 2, `tests/auth.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-AUTH-01 | Cadastro self-service | CQ-03; ADR-001 | e-mail novo | `POST /auth/cadastro {empresa, plano, nome, email, senha}` | 201 `{token}`; o token traz `tenant_id`, `plano` e `papel: "admin"` | Integração | Vitest | 2 | planejado |
| T-AUTH-02 | E-mail repetido no cadastro | Regra 8 | e-mail já cadastrado | Repetir o cadastro, também com o e-mail em maiúsculas | 409 nos dois | Integração | Vitest | 2 | planejado |
| T-AUTH-03 | Corpo inválido no cadastro | Bloco 2, item 4 | — | Sem e-mail; plano fora de `individual`/`equipe` | 400 | Integração | Vitest | 2 | planejado |
| T-AUTH-04 | Login correto | ADR-002 | usuário cadastrado | `POST /auth/login` | 200 `{token}` com o mesmo `tenant_id` do cadastro | Integração | Vitest | 2 | planejado |
| T-AUTH-05 | Senha errada e e-mail inexistente dão a mesma resposta | Bloco 2, item 5 | idem | Login com senha errada; login com e-mail inexistente | 401 nos dois, com **corpo idêntico** (não revela qual campo errou) | Integração | Vitest | 2 | planejado |
| T-AUTH-06 | Rota protegida sem token | ADR-002 | — | `GET /contatos` sem `Authorization` | 401 | Integração | Vitest | 2 | planejado |
| T-AUTH-07 | Token de acesso vale 15 min | ADR-002; números do projeto | token do login | Decodificar o JWT | `exp − iat = 900` s (15 × 60) | Integração | Vitest | 2 | planejado |
| T-AUTH-08 | Senha guardada com Argon2id | LGPD (medidas de segurança) | usuário cadastrado | Ler `senha_hash` (via `buscar_credencial`) | Começa com `$argon2id$` e não contém a senha | Integração | Vitest + pg | 2 | planejado |

### 2.4 Contatos (comportamento) — bloco 2, `tests/contatos.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-CON-01 | CRUD completo de um tenant | Bloco 2, item 6 | tenant A | Criar, ler, alterar, listar e excluir | 201, 200, 200, 200 e 204; depois do DELETE, GET → 404 | Integração | Vitest | 2 | planejado |
| T-CON-02 | Só `nome` é obrigatório | D3 de [`pendencias-bloco-7.md`](pendencias-bloco-7.md) | — | `POST /contatos {"nome":"x"}`; depois sem `nome` | 201; sem nome → 400 | Integração | Vitest | 2 | planejado |
| T-CON-03 | E-mail em minúsculas e único no tenant | Regra 8 | contato `a@x.com` em A | Criar outro com `A@X.com` em A; criar `a@x.com` em B | Em A → 409; em B → 201 | Integração | Vitest | 2 | planejado |
| T-CON-04 | Busca por nome, e-mail ou empresa, com teto | Bloco 2, item 6 | 101 contatos em A | `GET /contatos?busca=<termo>` | Acha pelos três campos, ordenado por nome, no máximo 100 itens | Integração | Vitest | 2 | planejado |

### 2.5 Importação — bloco 4, `tests/importacao.test.js` e `tests/idempotencia.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-IMP-01 | CSV válido com algumas linhas inválidas | ADR-003; regra 8 | tenant equipe | `POST /importacoes` com 250 linhas válidas + 3 inválidas; consultar `GET /importacoes/:id` até concluir | 202 `{importacao_id}`; `concluida`; `total_lotes = 3` (⌈250 ÷ 100⌉); 250 contatos; 3 linhas em `importacao.erros_linha` | Integração | Vitest | 4 | planejado |
| T-IMP-02 | Contatos importados ficam só no tenant que importou | CQ-02 | T-IMP-01 concluído | Outro tenant lista contatos | Nenhum dos 250 aparece | Integração | Vitest | 4 | planejado |
| T-IMP-03 | CSV do Excel em português | Bloco 4, item 6 | — | CSV com `;` e BOM UTF-8 | Mesmo resultado de um CSV com `,` | Integração | Vitest | 4 | planejado |
| T-IMP-04 | Linha sem e-mail ou com e-mail inválido é erro de linha | D3; regra 8 | — | CSV com linha sem e-mail, linha com e-mail inválido e linha com `Fulano@X.com` | 2 erros de linha; o terceiro gravado como `fulano@x.com` | Integração | Vitest | 4 | planejado |
| T-IMP-05 | Limite do plano individual | `planos.js` (100) | tenant individual | CSV de 100 linhas; depois de 101 | 100 → 202; 101 → 422 | Integração | Vitest | 4 | planejado |
| T-IMP-06 | Limite do plano equipe | `planos.js` (5.000) | tenant equipe | CSV de 5.000 linhas curtas; depois de 5.001 | 5.000 → 202; 5.001 → 422. As linhas têm ~50 bytes (5.001 × 50 ≈ 250 KB), para o 422 não ser confundido com o 413 | Integração | Vitest | 4 | planejado |
| T-IMP-07 | Limite de 1 MB no corpo | Números do projeto | — | Corpo com 1.048.577 bytes (1 MB + 1 byte) | 413; nada gravado em `orbita.importacoes` | Integração | Vitest | 4 | planejado |
| T-IMP-08 | Importações simultâneas por plano | `planos.js` (2 / 5) | Individual com 2 importações `na_fila` e equipe com 5, criadas **direto no banco** (fixture determinística) | `POST /importacoes` em cada tenant | Individual → 429; equipe → 429; outro tenant individual sem importações → 202 | Integração | Vitest + pg | 4 | planejado |
| T-IMP-09 | Mesmo lote enviado duas vezes | Regra 8 | importação de A | Mesmo `(importacao_id, numero)` 2× na rota interna, com token de serviço | 1º `{aplicado:true}`; 2º `{aplicado:false}`; contatos e `lotes_aplicados` não mudam | Integração | Vitest | 4 | planejado |
| T-IMP-10 | Rota interna recusa JWT de usuário | Regra 7 | token de usuário de A | `POST /interno/importacoes/:id/lotes` | 401 | Integração | Vitest | 4 | planejado |
| T-IMP-11 | Token de serviço com claim errado ou vencido | Regra 7 | — | Tokens com `aud` ≠ `api-contatos`; `iss` ≠ `importacao`; `exp` no passado; assinado com `JWT_SEGREDO` | 401 nos quatro | Integração | Vitest | 4 | planejado |
| T-IMP-12 | Progresso e transições de status | Bloco 4, item 3 | — | Consultar `GET /importacoes/:id` durante uma importação de equipe | `na_fila` → `processando` → `concluida`; no fim `lotes_aplicados = total_lotes` | Integração | Vitest | 4 | planejado |
| T-IMP-13 | A pausa de 500 ms existe de verdade | ADR-003; CQ-01 | `IMPORT_PAUSA_MS=500` | Importar 5.000 linhas (50 lotes) e medir `concluida_em − criado_em` | ≥ 24,5 s (49 pausas entre 50 lotes × 0,5 s). Teste lento: marcar para rodar só no CI e antes de entrega | Integração | Vitest | 4 | planejado |
| T-IMP-14 | Job reprocessado não duplica contatos | Regra 8 (`jobId`, lotes, upsert) | importação de 5.000 linhas em andamento | `docker compose kill importacao` no meio; `docker compose up -d importacao` | `concluida`; exatamente 5.000 contatos; `lotes_aplicados = 50` | Ensaio operacional | PowerShell | 5 | planejado |

### 2.6 Resiliência — bloco 5, `scripts/demo-degradacao.ps1`

Derrubar o Redis no meio do `npm test` quebraria os outros testes que rodam em paralelo. Por isso estes
casos são **ensaios** executados pelo script, com o resultado registrado.

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-RES-01 | Importação fora não derruba o CRM | ADR-003; CLAUDE.md (observabilidade) | stack no ar | `docker compose stop importacao`; login, busca, `POST /contatos` | Todos 2xx | Ensaio operacional | PowerShell | 5 | planejado |
| T-RES-02 | Importação enviada com o worker fora espera e conclui | ADR-003 | T-RES-01 | `POST /importacoes` → `docker compose start importacao` | 202 e `na_fila`; depois `concluida` | Ensaio operacional | PowerShell | 5 | planejado |
| T-RES-03 | Redis fora → 503 rápido | CLAUDE.md (`enableOfflineQueue: false`) | stack no ar | `docker compose stop redis`; `POST /importacoes` cronometrado | 503 com a mensagem "Importação indisponível no momento..." em **< 2 s**; nenhum registro órfão em `orbita.importacoes` | Ensaio operacional | PowerShell | 5 | planejado |
| T-RES-04 | Redis fora não derruba o resto | CLAUDE.md | T-RES-03 | Login, busca, CRUD de contatos e `GET /saude` | 2xx; `/saude` → HTTP 200 com `{db:"ok", fila:"fora"}` | Ensaio operacional | PowerShell | 5 | planejado |
| T-RES-05 | Redis volta sem reiniciar a API | ADR-003 | T-RES-03 | `docker compose start redis`; `POST /importacoes` | 202, sem reiniciar a `api-contatos` | Ensaio operacional | PowerShell | 5 | planejado |
| T-RES-06 | Cadastro funciona com a fila de e-mail fora | Bloco 10, item 3; CQ-03 | Redis parado | `POST /auth/cadastro` | 201; aviso no log; nenhum e-mail enviado | Ensaio operacional | PowerShell | 10 | planejado |

### 2.7 Rate limit por tenant — bloco 5, `tests/rate-limit.test.js`

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-RL-01 | Um tenant estoura e o outro segue normal | ADR-003 (vizinho barulhento); números do projeto | tenants individuais A e B | A faz 61 `GET /contatos` em menos de 1 min; logo depois B faz 1 | A: 60 × 200 e a 61ª → 429 com `Retry-After`; B → 200 | Integração | Vitest | 5 | planejado |
| T-RL-02 | Limite calculado pelo plano | `planos.js` | — | Ler o limite de cada plano | Individual 60 × 1 = 60; equipe 60 × 10 = 600 req/min | Unitário | Vitest | 5 | planejado |
| T-RL-03 | Força bruta no login | Números do projeto | usuário de A | 11 logins com o mesmo IP + e-mail; depois 1 com outro e-mail | 11ª → 429, mesmo com a senha certa; o outro e-mail → resposta normal (a chave é IP + e-mail) | Integração | Vitest | 5 | planejado |
| T-RL-04 | Limite de cadastro por IP | Números do projeto | `buildApp()` com limite reduzido (3) | 4 cadastros seguidos com `app.inject()` | 4º → 429. Unitário para não bloquear o IP da suíte por 1 min | Unitário | Vitest | 5 | planejado |
| T-RL-05 | `/saude`, `/planos` e `/interno` ficam fora do limite | Bloco 5, item 2 | — | 70 `GET /saude` e 70 `GET /planos` em menos de 1 min | Nenhum 429 | Integração | Vitest | 5 | planejado |

### 2.8 Observabilidade — bloco 5

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-OBS-01 | `x-request-id` aceito ou gerado | CLAUDE.md (observabilidade) | — | Requisição com `x-request-id: demo-123`; outra sem o header | 1ª devolve `demo-123`; 2ª devolve um UUID | Integração | Vitest | 5 | planejado |
| T-OBS-02 | O id atravessa a fila | CLAUDE.md | — | Importação com `x-request-id: demo-123`; `docker compose logs \| Select-String demo-123` | Linhas da `api-contatos` **e** da `importacao` com `demo-123`, `reqId` e `tenant_id` | Ensaio operacional | PowerShell | 5 | planejado |

### 2.9 Cenários de qualidade CQ-01, CQ-03, CQ-04 e CQ-05

Critérios copiados de [`atributos.md`](atributos.md). Nenhum threshold é ajustado para o teste passar:
se falhar, o relatório diz que falhou e propõe a causa (regra do bloco 9).

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-CQ01-01 | Vizinho barulhento **com** a mitigação | CQ-01; ADR-003 | `IMPORT_LOTE=100`, `IMPORT_PAUSA_MS=500`; setup cria 1 tenant equipe e 10 individuais com 50 contatos cada | Barulhento: 3 importações de 500 linhas, uma a cada 20 s. Observadores: 10 VUs, `GET /contatos?busca=` a cada 3 s, por 2 min | Observadores: **p95 < 800 ms**, **máx < 2 s**, **0 falhas** (`http_req_failed rate == 0`) | Carga | k6 | 9 | planejado |
| T-CQ01-02 | Mesma carga **sem** a mitigação | CQ-01 (comparação) | `IMPORT_LOTE=5000`, `IMPORT_PAUSA_MS=0` | Igual ao T-CQ01-01 | Sem critério de aprovação: registrar p50/p95/p99/máx para comparar com T-CQ01-01 em `docs/ensaios/cq01-<data>.md` | Carga | k6 | 9 | planejado |
| T-CQ03-01 | Onboarding self-service | CQ-03 | Mailpit no Compose | 20 cadastros; medir do POST até a mensagem aparecer na API do Mailpit | **p90 < 45 s** (p90 de 20 = 18º valor ordenado); 0 ações manuais; imprime p50, p90 e máximo | Integração | Vitest | 10 | planejado |
| T-CQ04-01 | Medição de disponibilidade | CQ-04 | stack no ar | `scripts/sonda.ps1 -Minutos 30`: `/saude` a cada 60 s | CSV com data, status e latência; % de sucesso e pior latência. Prova o **método**, não os 99,5% (conta na seção 4) | Ensaio operacional | PowerShell | 11 | planejado |
| T-CQ04-02 | Deploy sem parada | CQ-04 ("deploy sem downtime") | kind com 2 réplicas da API | Sonda a cada 1 s enquanto roda `kubectl rollout restart deployment/api-contatos -n orbitati` | 0 respostas 5xx ou timeout. **Proposta nova** (seção 5) | Ensaio operacional | PowerShell + kubectl | 11 | planejado |
| T-CQ05-01 | Restauração cronometrada | CQ-05 | backup recente (`scripts/backup.ps1`) | `scripts/ensaio-restauracao.ps1` em container `postgres-ensaio` separado | Restauração ≤ 30 min e verificação ≤ 60 min (orçamento do CQ-05); somadas aos 45 min de detecção e decisão, total ≤ **4 h** | Ensaio operacional | PowerShell | 11 | planejado |
| T-CQ05-02 | Integridade da cópia restaurada | CQ-05 | T-CQ05-01 | Comparar origem e cópia | Contagem igual em todas as tabelas; políticas em `pg_policies`; `FORCE` ativo; nenhum papel de aplicação com BYPASSRLS. Qualquer divergência reprova | Ensaio operacional | PowerShell | 11 | planejado |
| T-CQ05-03 | Restaurar um tenant só | ADR-001 (consequência negativa) | T-CQ05-01 | `scripts/restaurar-um-tenant.ps1 -Email <admin>` | CSV só com linhas daquele `tenant_id`; contagem igual à da origem para o tenant | Ensaio operacional | PowerShell | 11 | planejado |

### 2.10 Produto e LGPD — blocos 12, 13 e 14

| ID | O que verifica | Origem | Pré-condição | Passos | Resultado esperado | Tipo | Ferramenta | Bloco | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-PROD-01 | Interação atualiza o contato | Bloco 12, item 2 | contato de A | `POST /contatos/:id/interacoes` | 201; `ultima_interacao_em` atualizado na mesma transação | Integração | Vitest | 12 | planejado |
| T-PROD-02 | Regra do "esfriando" | Bloco 12, item 3 | contatos com interação há 100 dias, há 10 dias, sem interação e um `perdido` | `GET /contatos/esfriando?dias=90` | Vêm o de 100 dias e o sem interação, do mais frio ao mais recente; o de 10 dias e o `perdido` não vêm | Integração | Vitest | 12 | planejado |
| T-PROD-03 | Valores fora do domínio | Bloco 12, item 1 | — | Interação com `tipo` inválido; `PATCH` com `estagio` inválido | 400 nos dois | Integração | Vitest | 12 | planejado |
| T-WEB-01 | O Portal nunca envia `tenant_id` | Regra 1; ADR-002; bloco 13 | Portal no ar | Fluxo inteiro (cadastro, contato, interação, importação) com toda requisição do navegador interceptada | Nenhuma URL, query ou corpo contém "tenant" (o tenant só vai no token, no cabeçalho `Authorization`) | E2E | Playwright, `web/e2e/fluxo.spec.js` | 13 | automatizado (simulador); falta na stack real |
| T-WEB-02 | Fluxo principal no celular (375 px) | Bloco 13, Fase 5; "cadastro em 30 s" | Portal no ar | Cadastrar empresa → contato só com nome (Enter) → interação → importar CSV de 50 linhas com 2 inválidas | Contato aparece sem recarregar em < 30 s; "Último contato hoje" vem da resposta; "48 contatos importados, 2 linhas com erro"; nenhum erro no console (inclui violação de CSP) | E2E | Playwright, `web/e2e/fluxo.spec.js` | 13 | automatizado (simulador); falta na stack real |
| T-WEB-03 | Sessão vencida ou adulterada | ADR-002 (token de 15 min); bloco 13 | empresa nova | Abrir `/contatos` com token de assinatura inválida; com token vencido; sem token | Adulterado: API 401 → `/entrar` com "Sua sessão expirou"; vencido: o mesmo, sem nem chamar a API; token apagado da aba; `?voltar=` guarda a tela; sem token: login sem o aviso | E2E | Playwright, `web/e2e/sessao.spec.js` | 13 | automatizado (simulador); falta na stack real |
| T-WEB-04 | Isolamento visto pela tela | CQ-02; regra 5 | contato e importação de A | B abre `/contatos/<id de A>`, `/importar/<id de A>` e a própria lista | "Não encontramos esse contato." / "...essa importação." (API 404, nunca 403); nada de A aparece | E2E | Playwright, `web/e2e/isolamento.spec.js` | 13 | automatizado (simulador); falta na stack real |
| T-WEB-05 | Erros de importação na tela | Bloco 13, tabela da Fase 3 | empresa nova | Arquivo > 1 MB; CSV sem coluna `email`; fila fora (503 `FILA_INDISPONIVEL` simulado no navegador) | Mensagem da tabela em cada caso, com foco no aviso; > 1 MB nem é enviado; fila fora não derruba o resto do Portal | E2E | Playwright, `web/e2e/importacao-erros.spec.js` | 13 | automatizado (simulador); fila fora real fica para a Fase 6 |
| T-WEB-06 | nginx do Portal | Bloco 13, Fase 4 | imagem `orbitati/web` no ar | `/healthz`; `/api/saude`; `/api/interno` e variações (`//`, `%69`, `../`); `x-request-id`; cabeçalhos; cache; CSV de 1,5 MB pelo proxy | 200; proxy remove `/api`; interno → 404; id repassado ou gerado; CSP, nosniff, no-referrer, sem HSTS; assets 1 ano imutável com gzip; 413 `ARQUIVO_GRANDE` vem da API em JSON | E2E | Playwright, `web/e2e/nginx.spec.js` e `importacao-erros.spec.js` | 13 | automatizado (simulador); falta na stack real |
| T-WEB-07 | Acessibilidade no celular | WCAG 2.5.8 e 2.4.11; checklist da skill | empresa com 12 contatos | Medir alvos de toque em 7 telas (375 px); Tab por Contatos, Contato e Conta | Todo alvo ≥ 44 × 44 px; nenhum foco atrás da barra inferior ou do botão "+" | E2E | Playwright, `web/e2e/acessibilidade.spec.js` | 13 | automatizado (simulador) |
| T-WEB-08 | Layout em 4 larguras × 2 temas | Bloco 13, Fase 5 | conta de demonstração (seed) | Capturar 8 telas em 375, 768, 1024 e 1440 px, claro e escuro | Nenhuma rolagem horizontal, nenhum texto vazando da caixa; 64 capturas revisadas a olho | E2E + revisão | Playwright, `web/e2e/capturas.spec.js` | 13 | automatizado (simulador); na stack real depende do seed do bloco 3 |
| T-WEB-09 | Desempenho e acessibilidade (Lighthouse mobile) | CQ-01 (4G no orçamento); bloco 13 | Portal no ar | `npm run lighthouse` em `/entrar` e `/contatos`, claro e escuro, cache vazio | Desempenho ≥ 90, Acessibilidade ≥ 95, Boas práticas ≥ 95, JS inicial ≤ 170 KB gzip | Ensaio | `web/scripts/medir-lighthouse.mjs`; [relatório](ensaios/portal-lighthouse-2026-11-07.md) | 13 | feito em 07/11/2026 (simulador): 93–98 / 100 / 100, 103–112 KB |
| T-LGPD-01 | Exportação só para admin e sem senha | LGPD (exportação) | admin e consultor em A | `GET /conta/exportacao` com cada um | Admin → 200 sem `senha_hash`; consultor → 403 (autorização dentro do próprio tenant, por isso 403 e não 404) | Integração | Vitest | 14 | planejado |
| T-LGPD-02 | Tenant cancelado não entra | LGPD (cancelar) | A cancelado | Login de um usuário de A | 401 | Integração | Vitest | 14 | planejado |
| T-LGPD-03 | Exclusão após 30 dias, só de quem deve | LGPD (excluir); R4 | Tenants cancelados há 31 e há 29 dias e um ativo (data simulada) | Rodar o job de exclusão | O de 31 dias some de todas as tabelas; o de 29 e o ativo ficam intactos | Integração | Vitest | 14 | planejado |

---

## 3. Matriz de rastreabilidade

### 3.1 Cenários de qualidade

| Cenário | Medida | Testes |
|---|---|---|
| CQ-01 — vizinho barulhento | p95 < 800 ms; p100 < 2 s; 0 erros 5xx | T-CQ01-01, T-CQ01-02; apoio: T-IMP-13 (pausa), T-IMP-08 (simultâneas), T-RL-01 |
| CQ-02 — isolamento | 100% das tentativas → 404; 100% das rotas; build falha | T-ISO-01 a T-ISO-19, T-IMP-02, T-RLS-01 a T-RLS-16; pela tela: T-WEB-04 |
| CQ-03 — onboarding | p90 < 45 s; 0 ações manuais | T-CQ03-01, T-AUTH-01, T-RES-06 |
| CQ-04 — disponibilidade | 99,5% em horário comercial; ≤ 79 min/mês | T-CQ04-01, T-CQ04-02; apoio: T-RES-01, T-RES-04 |
| CQ-05 — recuperação | RPO ≤ 15 min; RTO ≤ 4 h | T-CQ05-01, T-CQ05-02, T-CQ05-03 (só RTO; o RPO não é testado, ver lacunas) |

### 3.2 ADRs

| ADR | Decisão | Testes |
|---|---|---|
| [ADR-001](adr/adr-001-tenancy.md) | Pool + RLS com `FORCE` | T-RLS-01 a T-RLS-17, T-CQ05-03 (restore por tenant) |
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
| Login 10/min por IP + e-mail | T-RL-03 |
| Cadastro `LIMITE_CADASTRO_POR_MIN` | T-RL-04 |
| Token de 15 min | T-AUTH-07 |
| Token de serviço de 60 s | T-IMP-11 |
| CQ-01 p95 < 800 ms | T-CQ01-01 |
| CQ-02 100% → 404 | seção 2.2 |

### 3.5 Lacunas: o que ficou sem teste

| # | O que | Por que ficou sem teste | O que fazer |
|---|---|---|---|
| L1 | CQ-02 pede "evento registrado no log de auditoria" no 404 cruzado | **Resolvida (decisão 6, bloco 3).** Com RLS, a API não distingue "de outro tenant" de "inexistente" (os dois são 0 linhas). Por isso todo 404 em rota com `:id` gera o evento `recurso_nao_encontrado` com `tenant_id`, rota e id, coberto pelo T-ISO-19 | Bloco 7: ajustar o texto do CQ-02 em `atributos.md` ([`pendencias-bloco-7.md`](pendencias-bloco-7.md), C11) |
| L2 | CQ-04: 99,5% ao mês | 30 amostras não conseguem medir 0,5% (conta na seção 4) | Declarar no relatório que é medição de método; a medida real exige a sonda rodando o mês em produção |
| L3 | CQ-05: RPO de 15 min | Depende de arquivamento contínuo de WAL, que é recurso do banco gerenciado | Declarar no relatório do bloco 11; o ensaio local prova só o RTO e o procedimento |
| L4 | CQ-03: parte do provedor de e-mail | Localmente não existe provedor real (96% do orçamento de 45 s) | Ressalva no relatório do bloco 10 |
| L5 | ADR-002: refresh token de 7 dias e denylist em Redis | Não estão em nenhum bloco | Decidir no bloco 7: implementar ou registrar como adiado |
| L6 | ADR-003: prioridade por plano na fila e "429 com tempo de espera no corpo" | Não estão nos prompts dos blocos | Decidir no ADR-004 se ficam; se ficarem, criar teste |
| L7 | ADR-003: "intervalo de 5 min entre jobs" | Substituído pela decisão D2 | Nenhum teste; a nota de revisão entra no ADR-003 no bloco 7 |
| L8 | Notificações, Gerador de Documentos, S3 e R6 da LGPD (URL de PDF) | Não existem nas Etapas 2 e 3 | Criar testes quando os containers existirem |

Casos que **este plano acrescenta** e que não estão nos prompts dos blocos (combinar antes de automatizar):
T-RLS-06 (DELETE cruzado), T-RLS-13 a 17, T-ISO-05, 06, 07, 12, 15, T-AUTH-03, 07, 08, T-CON-02 a 04,
T-IMP-03 a 08, 11 a 14, T-RL-02 a 05, T-OBS-01, T-CQ04-02, T-PROD-03, T-LGPD-01.
T-WEB-02 a T-WEB-09 vieram do bloco 13 (Fases 4 e 5) e já estão automatizados contra o simulador do
contrato; falta rodá-los contra a stack real (Fase 6, ver [`portal-pendencias.md`](portal-pendencias.md)).

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
| Amostras do T-CQ01-01 | 10 VUs × (120 s ÷ 3 s) = 400 buscas; o p95 é a 380ª | CQ-01 e bloco 9 |
| Restauração ≤ 30 min, verificação ≤ 60 min | Linhas da tabela do RTO no CQ-05; detecção (15) + decisão (30) = 45 min não são medidos localmente | CQ-05 |
| Por que 30 min de sonda não medem 99,5% | 30 amostras: 1 falha já derruba para 96,7%. Para que 1 falha valha 0,5%, são 200 amostras (200 min a cada 60 s). O mês comercial tem 264 h = 15.840 amostras, e 0,5% delas são 79 (os 79 min do CQ-04) | CQ-04 |
| 24 casos do CQ-02 | 12 rotas do C4 × 2; na Etapa 2 são 8 rotas, todas cobertas (seção 2.2) | CQ-02 |

---

## 5. Pontos de atenção encontrados ao escrever o plano

Problemas que os testes vão expor. A solução sugerida vem ao lado, para decidir antes do bloco correspondente.

1. **As 12 situações de RLS.** As 12 situações de isolamento validadas num PostgreSQL 16 real em 29/10/2026
   estão mapeadas na seção 2.1. O cadastro de tenant é o T-RLS-18, e o DELETE cruzado (T-RLS-06) fica como extra.
   Os IDs foram mantidos.
2. **Status HTTP do `/saude` com a fila fora.** No kind, a `readinessProbe` usa `/saude`. Se a resposta for 503
   quando o Redis cai, o Kubernetes tira **todas** as réplicas da API do ar, contrariando o "fila fora não
   derruba a API". *Solução:* `/saude` responde HTTP 200 sempre que o banco estiver ok, com `fila:"fora"` no
   corpo (é o que o T-RES-04 exige).
3. **Store do rate limit × Redis fora.** Se o `@fastify/rate-limit` guardar os contadores no Redis, o T-RES-04
   falha: com o Redis fora, toda requisição dá erro. Em memória, com 2 réplicas no kind, o limite efetivo
   dobra (2 × 60 = 120 req/min no individual). *Solução:* usar Redis com `skipOnError: true` (o limite deixa
   de valer só enquanto o Redis estiver fora) ou memória documentando o fator de réplicas. É decisão em
   aberto da [`pendencias-bloco-7.md`](pendencias-bloco-7.md).
4. **CQ-01 pode ficar diluído.** 3 importações de 500 linhas são 15 lotes. Com a pausa, o barulhento trabalha
   só uma parte dos 2 minutos, e o p95 das 400 buscas inclui muitas feitas com o banco ocioso. O teste pode
   passar sem provar nada. *Solução para o bloco 9:* marcar no k6 as buscas feitas **durante** uma importação
   e reportar o p95 delas também, ou usar no barulhento importações de 5.000 linhas.
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
| **Etapa 2** — núcleo multi-tenant | 1 a 7 | `npm test` verde com T-RLS-01 a 17, T-ISO-01 a 13, 15 e 19, T-AUTH-01 a 08, T-CON-01 a 04, T-IMP-01 a 13, T-RL-01 a 05 e T-OBS-01. Ensaios T-RES-01 a 05, T-IMP-14 e T-OBS-02 executados com saída registrada. `scripts/demo-isolamento.ps1` rodando até o fim no Compose e no kind |
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

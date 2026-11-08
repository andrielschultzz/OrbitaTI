# Pendências para o Bloco 7 — contradições e decisões

**Origem:** leitura do Bloco 0 (29/10/2026), que comparou o `CLAUDE.md` com os documentos de `docs/`.
**Por que este arquivo existe:** a Etapa 2 venceu em 15/10, então o código vem primeiro. As correções de
documentação e o ADR-004 ficam para o Bloco 7, e este arquivo garante que nada se perca até lá.

---

## 1. Decisões tomadas em 29/10/2026

| # | Tema | Decisão | Por quê |
|---|---|---|---|
| D1 | Foco | **Fechar a Etapa 2** (núcleo multi-tenant rodando). A Etapa 3 vem depois | A Etapa 2 venceu em 15/10 |
| D2 | Limite de linhas por importação | **Individual 100 · Equipe 5.000**, **sem** o intervalo de 5 min entre jobs | 5.000 vem de 1 MB ÷ ~200 bytes por linha ≈ 5.242, arredondado para baixo. A proteção do CQ-01 vem do lote de 100, da pausa de 500 ms e da `concurrency: 2` do worker, não de um intervalo entre jobs |
| D3 | E-mail do contato | **Opcional no cadastro manual** (só `nome` é obrigatório). **Obrigatório na importação**: linha sem e-mail vira erro de linha | Cadastro em 30 segundos é requisito do produto. Na importação, o e-mail é a chave que impede contato duplicado (`ON CONFLICT (tenant_id, email)`) |
| D4 | Registro das mudanças | **ADR-004 no Bloco 7**, junto com a correção de C1 a C10 | O código da Etapa 2 tem prioridade |

**Observações sobre D2 para o ADR-004:**
- Os dois limites valem **juntos**: 5.000 linhas **e** 1 MB. Se as linhas tiverem mais de 200 bytes
  (nome, e-mail, telefone, empresa e notas), o limite de 1 MB barra antes das 5.000 linhas.
- A `concurrency: 2` do worker é um número novo. Ele precisa entrar na tabela "Números do projeto" do `CLAUDE.md`.
- O ADR-003 afirma que a TechConsult migra "em ~1 hora" e que 3.000 contatos levam "várias horas". Sem o
  intervalo de 5 min, essas frases deixam de valer e precisam ser refeitas com a conta nova
  (5.000 linhas = 50 lotes × 500 ms ≈ 25 s só de pausa, mais o tempo de gravação).

---

## 2. Contradições a corrigir no Bloco 7

| # | Tema | O que `docs/` diz | O que o `CLAUDE.md` diz | Correção prevista | Arquivos |
|---|---|---|---|---|---|
| C1 | Como o worker grava contatos | O worker faz INSERT direto no banco, sob RLS | O worker não tem GRANT em `orbita`; grava por `POST /interno/importacoes/:id/lotes` com token de serviço | ADR-004: worker → API por HTTP (database-per-service) | `docs/adr/adr-004-*.md` (novo), `adr-003`, `02-arquitetura-c4.md`, `registro-enc11-cristofer.md` |
| C2 | Onde está o CSV | No S3; o job leva só `arquivo_id` | CSV de até 1 MB no payload do job; não há S3 na stack | ADR-004: "S3 adiado, CSV no payload", com a conta de memória do Redis | `adr-003`, `02-arquitetura-c4.md`, `registro-enc11-cristofer.md` |
| C3 | Política de RLS | `current_setting('app.tenant_id')::uuid`, e "sem tenant, não devolve linha nenhuma" | `NULLIF(current_setting('app.tenant_id', true), '')::uuid` | Corrigir o SQL. A versão dos docs **dá erro** sem tenant; ela não devolve vazio | `adr-001`, `02-arquitetura-c4.md`, `atributos.md` (CQ-02), `registro-enc11-cristofer.md` |
| C4 | `SET LOCAL` × `set_config` | `SET LOCAL app.tenant_id = '...'` | `set_config('app.tenant_id', $1, true)` | Nota: `SET LOCAL` não aceita parâmetro e obrigaria concatenar texto (risco de SQL injection) | `adr-001`, `02-arquitetura-c4.md`, `adr-003` |
| C5 | Caminho que ignora o RLS | ADR-002: "não existe caminho privilegiado que contorne o RLS" | `orbita_auth` com BYPASSRLS, dona de `orbita.buscar_credencial`, usada no login | Registrar a exceção única: ela roda só no login, não em toda requisição como na opção B rejeitada | `adr-002` |
| C6 | Limite por importação | 100 por job, para todos os planos, e intervalo de 5 min entre jobs | Individual 100 · Equipe 5.000, sem intervalo | **Decidido (D2), falta documentar** | `adr-003`, `adr-004`, `01-visao-produto.md` |
| C7 | Rate limits | Só a quota de jobs (429 com tempo de espera) | 60 req/min por usuário do plano (60/600), login 10/min, cadastro 60/min | Documentar a conta (600 = 10 usuários × 60) | `adr-003` ou `atributos.md` |
| C8 | Quem lê o progresso da importação | A API lê o schema `importacao` (seta ⑨) | `api_contatos` só tem acesso a `orbita` | Status em `orbita.importacoes`, atualizado pela rota `/interno/.../lotes` | `adr-004`, `registro-enc11-cristofer.md` |
| C9 | E-mail obrigatório | Visão: nome, telefone e contexto bastam | Deduplicação por `(tenant_id, email)` | **Decidido (D3), falta documentar** | `01-visao-produto.md`, `adr-004` |
| C10 | Detalhes menores | README "EC6" × visão "EC7"; "Cristofer" sem sobrenome; enc06 com tabelas em inglês | "Cristofer Mateus Rutzen"; identificadores em português | Corrigir quando passar por perto | `README.md`, `01-visao-produto.md`, demais docs |
| C11 | Resposta do 404 cruzado (CQ-02) | "404 Not Found, **corpo vazio**, evento registrado no **log de auditoria**" | Corpo `{erro, codigo: "NAO_ENCONTRADO"}`, igual ao de um id inexistente (contrato, seção 2). Decisão 6 (bloco 3): com RLS a API não distingue "de outro tenant" de "inexistente", então **todo** 404 em rota com `:id` gera no log da aplicação (pino) o evento `recurso_nao_encontrado` com `tenant_id`, `metodo`, `rota` e `id`. Não existe log de auditoria separado | Reescrever a linha "Resposta" do CQ-02: "404 com o mesmo corpo de um recurso inexistente; evento `recurso_nao_encontrado` no log da aplicação". Citar o T-ISO-19 | `atributos.md` (CQ-02) |
| C12 | Refresh token e denylist (ADR-002) | "15 minutos para o token de acesso, **com refresh token de 7 dias**" e "a sessão vai para uma **denylist em Redis**" na remoção de usuário | Decisão 9 (08/11/2026): **fora do escopo do semestre**. Token de 15 min sem refresh; ao expirar, o usuário faz login de novo. Sem denylist: usuário removido ou tenant cancelado mantém acesso por até 15 min com o token já emitido (o contrato já diz isso em `DELETE /conta`) | O ADR-002 declara isso como **decisão**, não como esquecimento: o que foi decidido, a consequência aceita (até 15 min de acesso depois da remoção; login a cada 15 min de uso) e o **gatilho de revisão**. Gatilho sugerido: reclamação de usuário sobre login frequente, primeiro cliente com rotatividade de equipe que exija corte imediato, ou o Portal passar a ter sessões longas de trabalho contínuo. Ver seção 6 | `adr-002` |

---

## 3. Lacunas ainda abertas (decidir quando o bloco correspondente chegar)

- **Contatos:** quais campos existem, tamanhos, e como funciona a busca (`ILIKE`? `pg_trgm`? quantos por página?). É a busca que o CQ-01 mede.
- **Formato do CSV:** colunas e cabeçalho, separador (o Excel brasileiro exporta com `;`), encoding (UTF-8 ou Windows-1252) e onde ficam os erros por linha.
- **Importações simultâneas (2/5):** limite de concorrência por grupo é recurso do **BullMQ Pro** (pago). Proposta: contar no banco, no `POST /importacoes`, e responder 429 acima do limite.
- ~~Store do rate limit~~: **decidido** (decisão 3): Redis com `skipOnError: true`. Em memória, cada uma das 2 réplicas do kind contaria separado e o limite dobraria; com o Redis fora, o limite é ignorado em vez de derrubar a API. Já está no `CLAUDE.md`; falta documentar no ADR-003 junto com C7. Ver seção 6, P3.
- **Cadastro de tenant:** campos do payload, confirmação de e-mail (não há Serviço de Notificações na Etapa 2), se devolve token, e se o e-mail do usuário é único em toda a base (o `buscar_credencial(email)` depende disso).
- **Segredos:** nomes das variáveis de ambiente e o conteúdo do `.env.example`.
- ~~Refresh token de 7 dias e denylist em Redis (ADR-002)~~: **decidido** (decisão 9, fora do escopo do semestre). Falta escrever no ADR-002, ver C12.
- **Escopo:** exportação CSV/JSON e job de exclusão em 30 dias (`lgpd.md` marca estes dois para a Etapa 2).
- ~~Log de auditoria do 404 (CQ-02)~~: **resolvido no bloco 3** (decisão 6). Falta só o texto do `atributos.md`, ver C11.
- **`docs/desenho-servicos.jpg`:** citado em três documentos, mas o arquivo não existe no repositório.

---

## 4. Decisões do contrato da API (07/11/2026)

O contrato HTTP entre Portal e API foi escrito antes do código, em [`contrato-api.md`](contrato-api.md),
para o Portal (bloco 13) poder ser construído em paralelo com o backend. As decisões novas estão na
seção 11 dele e entram no ADR-004 no Bloco 7.

| # | Decisão | Fecha qual lacuna |
|---|---|---|
| K1 | Formato único de erro `{erro, codigo}` | — |
| K2 | Campos e tamanhos do contato; busca `ILIKE` com até 100 resultados (`{itens, limite}`) | "Contatos: quais campos existem, tamanhos…" (seção 3) |
| K3 | CSV com cabeçalho obrigatório (`nome`, `email`, `telefone`, `empresa`, `observacao`), `,` ou `;`, BOM aceito; 422 para CSV vazio ou sem colunas | "Formato do CSV" (seção 3) |
| K4 | Rotas `/interno/importacoes/:id/inicio` e `/falha`; `total_lotes` informado pelo worker | Bug de desenho: sem elas a importação podia nunca concluir |
| K5 | "Esfriando" usa `COALESCE(ultima_interacao_em, criado_em)`; interação usa `GREATEST` | — |
| K6 | `GET /planos` pública, com preço em centavos no `planos.js` e sem rate limit; `PORTAL_URL` nos links de e-mail; porta 3000 só em `127.0.0.1`; `trustProxy` | Preparo para o Portal atrás de Nginx e para a VM do LARCC |

---

## 5. Decisões e achados do bloco 1 (07/11/2026)

| # | O quê | Decisão ou consequência | Onde está |
|---|---|---|---|
| B1 | `ON DELETE CASCADE` não chega ao schema `importacao` | As tabelas de `orbita` têm chave estrangeira para `orbita.tenants` com `CASCADE`. As de `importacao` não têm, porque é a fronteira entre os serviços e o `importacao_svc` não enxerga `orbita`. **A exclusão de tenant do bloco 14 precisa apagar também `importacao.execucoes` e `importacao.erros_linha` do tenant** (como `importacao_svc`, com o tenant fixado). Apagar só `orbita.tenants` deixaria dados de contato (o `motivo` do erro pode citar a linha do CSV) depois dos 30 dias, contra a LGPD | `db/migrations/001_base.sql`; T-LGPD-03 |
| B2 | `GRANT orbita_auth TO migrador` | Necessário: no PostgreSQL 16, passar a função para o `orbita_auth` (`ALTER FUNCTION ... OWNER TO`) exige poder fazer `SET ROLE orbita_auth`. Concedido `WITH INHERIT FALSE`, então o migrador não herda os privilégios de objeto do `orbita_auth` (o `SELECT` em `usuarios`). O `BYPASSRLS` é atributo de papel e nunca é herdado por pertencimento, com ou sem `INHERIT`. **Risco aceito:** com `SET ROLE orbita_auth`, o migrador passa a agir como o `orbita_auth` e ignora o RLS. Mitigação: a senha do migrador só existe no job de migração, nunca em serviço | `db/init/01-papeis.sh` |
| B3 | Objetos futuros | `ALTER DEFAULT PRIVILEGES`: tabelas e sequências novas em `orbita` já nascem com CRUD para `api_contatos`, e em `importacao` para `importacao_svc`. Funções novas do migrador nascem **sem** `EXECUTE` para `PUBLIC` (o PostgreSQL dá esse `EXECUTE` por padrão). Assim a função do bloco 14, dona `orbita_auth` com `BYPASSRLS`, não nasce aberta. Garantido pelos T-RLS-15 e T-RLS-19 | `001_base.sql`; `tests/rls.test.js` |
| B4 | Cadastro de tenant sob RLS (fecha parte da lacuna "Cadastro de tenant" da seção 3) | A política de `orbita.tenants` compara o `id`. A API gera o UUID no Node, fixa `app.tenant_id` com ele e só então insere o tenant e o primeiro usuário. O e-mail do usuário é único na base inteira (índice `usuarios_email_unico`), porque o login acha o usuário só pelo e-mail. T-RLS-18 e T-RLS-12 | `001_base.sql`; bloco 2 |
| B5 | Senhas dos papéis | Gravadas só no primeiro boot do Postgres (`db/init`). Trocar no `.env` depois não muda o banco: o papel continua com a senha antiga até recriar o volume. O `npm run env` nunca sobrescreve um `.env` existente | `README.md`; `scripts/gerar-env.js` |
| B6 | Ordem do `REVOKE`/`GRANT` na função de login (achado do T-RLS-19) | Na primeira versão da `001_base.sql`, o `REVOKE ... FROM PUBLIC` e o `GRANT ... TO api_contatos` vinham **depois** do `ALTER FUNCTION ... OWNER TO orbita_auth`. Sem ser mais o dono, e com `INHERIT FALSE`, o migrador não tinha como mexer nas permissões; o PostgreSQL só emitiu um WARNING e a função ficou executável por todos os papéis. Correção: permissões antes de passar a posse. Para essa classe de erro não passar de novo em silêncio, o `migrate.js` agora **falha** (e desfaz) quando o PostgreSQL emite qualquer WARNING durante uma migração. A 001 foi corrigida antes do primeiro commit, e o volume local foi recriado | `001_base.sql`; `db/migrate.js`; T-RLS-19 |

---

## 6. Decisões sobre o plano de testes (08/11/2026)

**Origem:** `prompts/decisoes-plano-de-testes.md`, que respondeu aos pontos levantados no
[`plano-de-testes.md`](plano-de-testes.md).

**Onde cada decisão já está:**
- casos de teste e lacunas: `plano-de-testes.md` (seções 2, 3.5, 4 e 5);
- instruções de execução: `prompts/bloco-09.md` e `prompts/bloco-11.md`.

O que fica para o Bloco 7 é o texto dos documentos da Etapa 1.

| # | Tema | Decisão | Já aplicado em | Falta no Bloco 7 |
|---|---|---|---|---|
| P2 | `/saude` com o Redis fora | HTTP 200 com `{"fila":"fora"}` quando só o Redis cai; 503 apenas com o banco fora. Assim a `readinessProbe` do kind não tira a API do ar por causa da fila | `contrato-api.md` (`GET /saude`); plano: T-OBS-03 (novo, unitário) e T-RES-04 | Nada. O contrato já estava assim |
| P3 | Store do rate limit | **Redis com `skipOnError: true`.** Em memória, cada uma das 2 réplicas do kind contaria separado e o limite dobraria (2 × 60 = 120 req/min no individual). Com o Redis fora, o limite é ignorado em vez de derrubar a API. Risco aceito: sem rate limit (nem o de login) enquanto o Redis estiver fora | `CLAUDE.md` (números do projeto); plano: seção 5, item 3, e T-RES-04 | Documentar no ADR-003 junto com C7 (os números do rate limit) |
| P4 | CQ-01 diluído | O relatório do bloco 9 mostra o p95 das buscas feitas **durante** as janelas de importação, separado do p95 geral; a aprovação usa o da janela. **Complemento (08/11/2026):** o barulhento faz 3 importações de **5.000 linhas** (plano Equipe, no papel da TechConsult, criado pelo setup do k6, não a conta do seed), com linhas curtas (~50 bytes), para ter ≈ 200 buscas na janela em vez de ≈ 20 a 50 | Plano: T-CQ01-01 e 02, seções 4 e 5; `prompts/bloco-09.md` | Opcional: uma frase no CQ-01 do `atributos.md` dizendo que a medida é feita nas janelas de importação, com importações de 5.000 linhas |
| P6 | Log do 404 (CQ-02) | Todo 404 em rota com `:id` gera o evento `recurso_nao_encontrado` | Código (bloco 3); T-ISO-19 | C11 |
| P7 | CQ-04: tamanho da amostra | Sonda a cada **15 s por 60 min = 240 amostras**. Conta: 60 × 60 ÷ 15 = 240. 1 falha = 0,42% (< 0,5%), então 1 falha aprova e 2 reprovam. **Limite:** 0 falhas em 240 não provam 99,5% (o limite de 95% de confiança é 3 ÷ 240 = 1,25%); a medida real é a sonda do mês em produção | Plano: T-CQ04-01, seção 4, L2; `prompts/bloco-11.md` | O `atributos.md` (CQ-04, "Como medir") fala em sonda a cada 60 s com apuração mensal: isso continua valendo para **produção**. Acrescentar que o ensaio local usa 15 s × 60 min e por quê |
| P8 | CQ-05: RPO | O RPO de 15 min fica **declarado como limitação do ensaio local**: depende de arquivamento de WAL do banco gerenciado. O ensaio prova o procedimento e o RTO | Plano: T-CQ05-01, L3; `prompts/bloco-11.md` (já dizia isso) | Nota no CQ-05 do `atributos.md`: o RPO é garantido pelo provedor do banco gerenciado e não é ensaiado localmente |
| P9 | Refresh token e denylist | **Fora do escopo do semestre.** Token de 15 min sem refresh; ao expirar, login de novo | Plano: L5 | C12: o ADR-002 declara a decisão, com gatilho de revisão |

---

## 7. Decisões, riscos e achados do bloco 4 (08/11/2026)

### 7.1 Risco aceito: a API cai entre o COMMIT e o enfileiramento (I1)

**Como o `POST /importacoes` funciona.** A API grava a importação (`na_fila`), faz COMMIT e **só depois**
enfileira o job. Se enfileirar falhar, uma transação de compensação apaga o registro e a resposta é 503
(T-IMP-22). A ordem é proposital: enfileirar **antes** do COMMIT abriria uma corrida, porque o worker
poderia chamar `/interno/.../inicio` antes de a linha existir e receber 404.

**O que sobra.** Se o processo da API **morrer** entre o COMMIT e o `add` (OOM, `kill`, o kind
reiniciando o pod), a compensação nunca roda. A importação fica `na_fila` para sempre:
- o Portal mostra "na fila" sem fim;
- ela **ocupa uma vaga de importação simultânea**. No plano Individual são só 2: duas dessas e o tenant não
  importa mais nada.

O CSV estava só na memória da API e no payload do job que não chegou a existir. Não há como reenfileirar.

**Por que é aceito agora.** A janela é de milissegundos (um `add` no Redis) e exige o processo morrer
exatamente nela. Nenhum teste da Etapa 2 provoca isso.

**Ideia de mitigação (não implementada).** Um "faxineiro" no próprio `POST /importacoes`, restrito ao
tenant que está importando, antes de contar as simultâneas. Para cada importação `na_fila` do tenant com
mais de 2 minutos, perguntar ao BullMQ se o job existe (`queue.getJob(importacao_id)`, possível porque
`jobId = importacao_id`). Se não existir, marcar `falhou`.
- Custo: uma consulta ao Redis por importação velha, só quando o tenant tenta importar de novo.
- Não precisa de processo novo nem de cron.
- O Portal passa a mostrar "falhou", e a vaga é liberada.
- Os 2 minutos dão folga para um job que está de fato na fila esperando o worker (a `concurrency: 2` pode
  segurar a fila por algumas dezenas de segundos em pico).

Alternativa mais robusta, se o problema aparecer de verdade: **outbox**. O CSV é gravado no banco junto com
o registro, e um processo separado enfileira e apaga. Isso tira o CSV do payload, o que contraria o ADR-004
(até 1 MB no job), e por isso fica só como registro.

**Falta no Bloco 7:** registrar o risco aceito e a ideia de mitigação no ADR-004, ao lado de C2.

### 7.2 Decisões do contrato e do código (I2 a I7)

| # | O quê | Decisão | Onde está |
|---|---|---|---|
| I2 | Lacunas da seção 8 do contrato | `inicio` e `falha` respondem `200 {"status": ...}`; `inicio` repetido mantém os primeiros números; lote depois de `falhou` → `{aplicado:false}`, sem aplicar; lote com `numero` além de `total_lotes` → 400 | `contrato-api.md` (seção 8); T-IMP-15 a 18 |
| I3 | E-mail repetido no mesmo arquivo | Erro de linha ("e-mail repetido (já aparece na linha N)"), conta em `linhas_invalidas`. Sem isso, o upsert do lote daria 500 no PostgreSQL ("ON CONFLICT ... cannot affect row a second time"), e "X contatos importados" mentiria. O simulador mudou junto | `contrato-api.md` (seção 7); worker; `web/simulador/`; T-IMP-21 |
| I4 | Separador do CSV | Decidido **uma vez**, pela linha do cabeçalho (o que aparecer mais vezes, `;` ou `,`). Aceitar os dois ao mesmo tempo quebraria `"Silva, João"` num arquivo do Excel em português | `contrato-api.md` (seção 7); API e worker (`csv.js`); T-IMP-03 |
| I5 | Reimportar um contato | Upsert com `COALESCE`: célula vazia no CSV **não apaga** telefone, empresa ou observação que já existia; nome sempre atualiza | `contrato-api.md` (seção 7); rota `/lotes`; T-IMP-09 |
| I6 | Token de serviço verificado com `fast-jwt` direto | O `namespace` do `@fastify/jwt` transforma `fastify.jwt` num mapa e quebraria o `app.jwt.sign()` do login. A API também recusa token de serviço com mais de 60 s de vida, mesmo assinado corretamente (um token longo que vaze em log valeria por muito tempo) | `autenticacao.js`; T-IMP-11 |
| I7 | Contagem de linhas da API × do worker | A API conta linhas físicas não vazias (definição do contrato). Uma célula do Excel com quebra de linha **dentro de aspas** conta 2 na API e 1 no worker: o limite do plano fica um pouco mais conservador, e "X contatos importados" pode sair 1 ou 2 a mais. **Limitação declarada**; resolver exigiria a API fazer o parse completo | `api-contatos/src/csv.js` |

### 7.3 Achados (I8 a I10)

| # | Achado | O que foi feito | Falta |
|---|---|---|---|
| I8 | **BullMQ "envenenado" na partida.** Com `skipWaitingForReady` e `enableOfflineQueue: false`, a `Queue` manda um `INFO` ao Redis assim que é criada. A API sobe antes de a conexão ficar pronta, o `INFO` falha, e a `Queue` guarda essa falha para sempre: todo `add()` recebia "Stream isn't writeable" **com o Redis no ar**. Os testes unitários (fila simulada) não pegavam; o teste de integração pegou | A `Queue` passou a ser criada só quando a conexão já está `ready`, e é recriada se a inicialização falhar. Ensaio manual: Redis parado → 503; Redis de volta → 202 em 2 s, sem reiniciar a API | Citar no ADR-004 como exemplo de por que o teste de integração existe |
| I9 | Jobs que sobrevivem ao tenant | Um job de um tenant já apagado ainda roda: o worker grava em `importacao.execucoes`, a API responde 404, o worker desiste sem gastar as 3 tentativas e o `/falha` também dá 404. Sobra uma linha órfã em `importacao.execucoes` | Bloco 14 (junto com B1): a exclusão de tenant precisa também remover os jobs pendentes do tenant na fila, ou apagar `importacao.*` **depois** que eles terminarem |
| I10 | `concurrency: 2` e o lote máximo | A rota `/lotes` aceita até 5.000 contatos por lote (corpo até 4 MB), para o bloco 9 poder rodar "sem a mitigação" (`IMPORT_LOTE=5000`). O worker valida `IMPORT_LOTE` entre 1 e 5.000 | Entrar na tabela "Números do projeto" do `CLAUDE.md` junto com a `concurrency: 2` (observação de D2) |

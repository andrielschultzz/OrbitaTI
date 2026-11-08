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

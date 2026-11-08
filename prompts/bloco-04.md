# Bloco 4 — Serviço de Importação

Objetivo: implementar o segundo serviço (services/importacao) e as rotas da API que
conversam com ele.

Contexto: CLAUDE.md (regras 7 e 8, números do projeto), docs/adr/adr-003-processamento-assincrono.md,
docs/contrato-api.md (seções 7 e 8 — formato do CSV, rotas e códigos de erro),
docs/servicos-rascunho.md e o diagrama de sequência da importação que segue abaixo:
  usuário -> POST /importacoes (CSV) -> API registra em orbita.importacoes e enfileira
  job (jobId = importacao_id, payload {importacao_id, tenant_id, usuario_id, request_id, csv})
  -> worker lê, valida, grava erros em importacao.erros_linha, divide em lotes de 100
  -> para cada lote: POST /interno/importacoes/:id/lotes com token de serviço -> espera 500 ms.

Faça na API:
1. src/planos.js: nome, preço mensal em centavos (4900 | 24900) e limites por plano (linhas por
   importação 100 | 5000; importações simultâneas 2 | 5; usuários 1 | 10). É a única fonte desses números.
2. POST /importacoes com corpo text/csv (parser de content-type, bodyLimit 1 MB -> 413):
   lê só o cabeçalho e conta as linhas de dados (sem as colunas nome e email -> 422
   CSV_SEM_COLUNAS; nenhuma linha -> 422 CSV_VAZIO; acima do plano -> 422 LINHAS_ACIMA_DO_PLANO),
   conta importações na_fila|processando do tenant
   (no limite -> 429), insere em orbita.importacoes e enfileira no BullMQ dentro da mesma
   transação lógica: se o enfileiramento falhar, desfaz o registro e responde 503
   {"erro": "Importação indisponível no momento. O restante do sistema segue funcionando."}.
   Conexão do Queue com enableOfflineQueue: false para falhar rápido com o Redis fora.
   Resposta 202 {importacao_id}.
3. GET /importacoes/:id -> status, total_lotes, lotes_aplicados (404 se de outro tenant).
4. POST /interno/importacoes/:id/lotes: aceita SOMENTE token de serviço (JWT_SERVICO_SEGREDO,
   iss "importacao", aud "api-contatos"); JWT de usuário -> 401. Usa o tenant_id do token
   em withTenant. Numa transação: se (importacao_id, numero) já está em lotes_aplicados,
   responde {aplicado:false}; senão faz upsert dos contatos ON CONFLICT (tenant_id, email),
   registra o lote, incrementa lotes_aplicados, marca processando/concluida e responde
   {aplicado:true}. Importação de outro tenant -> 404.
5. GET /saude passa a informar também { fila: "ok" | "fora" }. Status (decisão 2 de
   prompts/decisoes-plano-de-testes.md; contrato, GET /saude): 200 quando o banco está ok, MESMO
   com a fila fora ({"db":"ok","fila":"fora"}); 503 só com o banco fora. Por quê: no kind a
   readinessProbe usa /saude, e um 503 com o Redis fora tiraria todas as réplicas da API do ar.
   Teste T-OBS-03 (docs/plano-de-testes.md, seção 2.8):
     - arquivo services/api-contatos/test/saude.test.js, unitário, sem stack;
     - buildApp() com banco e fila simulados, cobrindo as 4 combinações de ok e fora;
     - para isso, o buildApp() precisa aceitar a verificação da fila como opção, assim como já
       aceita o pool.
5a. POST /interno/importacoes/:id/inicio {total_lotes, linhas_invalidas} e
    POST /interno/importacoes/:id/falha {motivo}, com o mesmo token de serviço da rota de lotes
    (contrato, seção 8). total_lotes nasce nulo no POST /importacoes e quem o informa é o worker.
    Por quê: se a API contasse as linhas inválidas, 100 válidas + 3 inválidas esperariam 2 lotes e
    receberiam 1; um CSV todo inválido não mandaria lote nenhum; um job que esgota as tentativas
    ficaria processando. Nos três casos a importação nunca concluiria e o Portal ficaria esperando.
    inicio com total_lotes 0 já marca concluida; repetir inicio não muda nada; concluida e
    falhou nunca voltam atrás.
5b. GET /planos (contrato, seção 7): rota PÚBLICA, sem token e sem rate limit, que lista os planos
    com nome, preco_mensal_centavos e limites, tudo lido do planos.js (tamanho máximo do CSV vem do
    bodyLimit). O cadastro do Portal mostra os planos antes de existir token; depois do login o Portal
    escolhe o plano atual pelo claim `plano`. Sem dado de tenant: acrescente "GET /planos" à lista fixa
    ROTAS_PUBLICAS de tests/isolamento.test.js (hoje GET /saude, POST /auth/cadastro e
    POST /auth/login), senão o T-ISO-15 acusa a rota. A lista é fixa de propósito: marcar uma rota
    como pública não pode ser um jeito de escapar da autenticação e da suíte ao mesmo tempo.

Faça no serviço services/importacao:
6. Worker BullMQ (concurrency 2, attempts 3, backoff exponencial), DATABASE_URL_IMPORTACAO,
   csv-parse com bom: true e separador "," ou ";" (o Excel em português exporta CSV com
   ponto e vírgula, e o PowerShell 5 grava UTF-8 com BOM). Valida cada linha (nome obrigatório, e-mail obrigatório e válido, normalizado
   em minúsculas); inválidas vão para importacao.erros_linha via withTenant próprio.
   Registra a execução em importacao.execucoes.
7. Envia os lotes válidos à API (API_URL_INTERNA) com token de serviço assinado por ele
   (claims tenant_id, iss, aud, exp 60 s) e o header x-request-id do job.
   Tamanho do lote e pausa vêm de IMPORT_LOTE (padrão 100) e IMPORT_PAUSA_MS (padrão 500),
   para o teste de carga comparar com e sem a mitigação.
   Antes do primeiro lote, chama /interno/importacoes/:id/inicio; se o job esgotar as 3
   tentativas, chama /interno/importacoes/:id/falha.
8. Dockerfile e serviço "importacao" no compose (sem porta publicada).

Testes:
9. tests/importacao.test.js: tenant equipe importa CSV de 250 linhas válidas + 3 inválidas
   -> concluida, 3 lotes, 250 contatos; outro tenant não vê nenhum deles; tenant individual
   com 101 linhas -> 422.
10. tests/idempotencia.test.js: o mesmo lote enviado duas vezes à rota interna -> segundo
    {aplicado:false} e nenhum contato duplicado; JWT de usuário na rota interna -> 401;
    token de serviço do tenant A para importação do tenant B -> 404.

11. Mais testes: 100 linhas válidas + 3 inválidas -> concluida com 1 lote e linhas_invalidas 3;
    CSV só com linhas inválidas -> concluida com 0 lotes; CSV sem a coluna email -> 422; token de
    serviço de A em inicio e falha de uma importação de B -> 404 (acrescente essas rotas à tabela
    de tests/isolamento.test.js). Registre os casos novos em docs/plano-de-testes.md.

Não faça: nenhum GRANT de importacao_svc em orbita; o worker não acessa orbita de jeito
nenhum. Não guarde o CSV fora do payload (decisão do ADR-004: até 1 MB no job).

Pronto quando: docker compose up -d --build --wait com os 5 serviços saudáveis; npm test
passa inteiro; e uma importação manual de CSV aparece concluída em GET /importacoes/:id.

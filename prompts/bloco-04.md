# Bloco 4 — Serviço de Importação

Objetivo: implementar o segundo serviço (services/importacao) e as rotas da API que
conversam com ele.

Contexto: CLAUDE.md (regras 7 e 8, números do projeto), docs/adr/adr-003-processamento-assincrono.md,
docs/servicos-rascunho.md e o diagrama de sequência da importação que segue abaixo:
  usuário -> POST /importacoes (CSV) -> API registra em orbita.importacoes e enfileira
  job (jobId = importacao_id, payload {importacao_id, tenant_id, usuario_id, request_id, csv})
  -> worker lê, valida, grava erros em importacao.erros_linha, divide em lotes de 100
  -> para cada lote: POST /interno/importacoes/:id/lotes com token de serviço -> espera 500 ms.

Faça na API:
1. src/planos.js: limites por plano (linhas por importação 100 | 5000; importações
   simultâneas 2 | 5; usuários 1 | 10). É a única fonte desses números.
2. POST /importacoes com corpo text/csv (parser de content-type, bodyLimit 1 MB -> 413):
   conta linhas (acima do plano -> 422), conta importações na_fila|processando do tenant
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
5. GET /saude passa a informar também { fila: "ok" | "fora" }.

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
8. Dockerfile e serviço "importacao" no compose (sem porta publicada).

Testes:
9. tests/importacao.test.js: tenant equipe importa CSV de 250 linhas válidas + 3 inválidas
   -> concluida, 3 lotes, 250 contatos; outro tenant não vê nenhum deles; tenant individual
   com 101 linhas -> 422.
10. tests/idempotencia.test.js: o mesmo lote enviado duas vezes à rota interna -> segundo
    {aplicado:false} e nenhum contato duplicado; JWT de usuário na rota interna -> 401;
    token de serviço do tenant A para importação do tenant B -> 404.

Não faça: nenhum GRANT de importacao_svc em orbita; o worker não acessa orbita de jeito
nenhum. Não guarde o CSV fora do payload (decisão do ADR-004: até 1 MB no job).

Pronto quando: docker compose up -d --build --wait com os 5 serviços saudáveis; npm test
passa inteiro; e uma importação manual de CSV aparece concluída em GET /importacoes/:id.

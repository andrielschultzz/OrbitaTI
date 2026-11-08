# Bloco 9 — Medir o CQ-01 (vizinho barulhento) com e sem a mitigação

Objetivo: medir o cenário CQ-01 de docs/atributos.md com k6.

Faça:
1. tests/carga/cq01.js (k6):
   - setup: cria pela API 1 tenant equipe (o barulhento, no papel da TechConsult) e 10 tenants
     individuais (observadores), cada observador com 50 contatos. O barulhento é um tenant NOVO
     do setup, não a conta de demonstração do seed (gestor@techconsult.com.br): 15 mil contatos a
     mais estragariam a demo de isolamento e as capturas do Portal.
   - cenário "barulhento": 3 importações de 5.000 linhas, uma a cada 20 s (CSV com cabeçalho, no
     formato de docs/contrato-api.md, seção 7). Decidido em 08/11/2026 (plano de testes, seção 5,
     item 4):
       - 5.000 é o limite do plano Equipe e continua sendo "500 ou mais" do CQ-01;
       - com 500 linhas, as janelas teriam só ≈ 20 a 50 buscas; com 5.000, ≈ 200.
     Linhas CURTAS, como no T-IMP-06: só nome e e-mail, ~50 bytes cada (ex.:
     "Carga 0001,c0001-i1@carga.orbitati.dev"). 5.000 × 50 ≈ 250 KB, abaixo de 1 MB; com todas
     as colunas preenchidas o CSV passaria de 1 MB e daria 413. E-mails diferentes em cada
     importação (sufixo -i1, -i2, -i3), para as três gravarem contatos novos.
     Para cada importação, registra a JANELA:
     início = momento do POST /importacoes; fim = quando GET /importacoes/:id (consultado a cada
     1 s) devolve concluida ou falhou. As janelas vão para a saída (ex.: uma linha
     "JANELA <inicio> <fim>" no log do k6, em milissegundos).
   - cenário "observadores": 10 VUs, cada um faz GET /contatos?busca=<termo> a cada 3 s,
     durante 2 minutos. Tag cenario=observadores.
   - thresholds: http_req_duration{cenario:observadores} p(95)<800 e max<2000;
     http_req_failed{cenario:observadores} rate==0. Valem para o conjunto geral e funcionam
     como barreira mínima; a aprovação do CQ-01 é a do item 3 (buscas dentro das janelas).
   - rode com --out json para guardar cada requisição com o horário (é a entrada do item 3).
2. Serviço "k6" no docker-compose (imagem grafana/k6, profile "carga", volume com
   tests/carga, alvo http://api-contatos:3000) para rodar na rede interna do compose:
   docker compose --profile carga run --rm k6 run /scripts/cq01.js
3. Separar as buscas feitas DURANTE as importações (decisão 4 de prompts/decisoes-plano-de-testes.md).
   Por quê: o barulhento trabalha só uma parte dos 2 minutos. O p95 das 400 buscas mistura muitas
   feitas com o banco ocioso, e o teste pode passar sem provar nada.
   - Um script (ex.: tests/carga/janelas.js, Node) lê o JSON do k6 e as janelas.
   - Conta como "na janela" a busca de observador que COMEÇOU dentro de alguma janela
     (horário do ponto menos a duração).
   - Calcula p50/p95/p99/máx e o n de dois grupos: "na janela" e "geral".
   - Aprovação do CQ-01: p95 < 800 ms e máx < 2 s no grupo "na janela", e 0 falhas no total.
     O "geral" aparece ao lado, para comparação.
   - Tamanho da amostra (conta em docs/plano-de-testes.md, seção 4):
       - com a mitigação, cada importação de 5.000 linhas leva ≥ 49 × 0,5 s = 24,5 s;
       - as três janelas se sobrepõem, e a união vai de 0 a ≥ 64,5 s;
       - isso dá ≈ 3,3 buscas/s × 64,5 s ≈ 200 buscas na janela.
     O relatório SEMPRE mostra o n real. Com n < 100, declara que o p95 da janela é pouco
     confiável e propõe a causa.
   - Sem a mitigação, a janela é curta e o n "na janela" sai pequeno. Isso é esperado: o T-CQ01-02
     não tem critério de aprovação, e o relatório só registra o n.
   - Antes de rodar sem a mitigação: com IMPORT_LOTE=5000, cada importação vira UM lote de 5.000
     contatos num só POST /interno/importacoes/:id/lotes. Em JSON, isso fica em ≈ 500 a 750 KB,
     perto do bodyLimit padrão do Fastify (1 MB). Confira o limite dessa rota. Se não couber,
     pare e pergunte: não aumente o bodyLimit sem decidir, porque é uma mudança na API.
4. scripts/medir-cq01.ps1: roda duas vezes — com os padrões (IMPORT_LOTE=100,
   IMPORT_PAUSA_MS=500) e sem mitigação (IMPORT_LOTE=5000, IMPORT_PAUSA_MS=0), recriando
   o serviço importacao entre as rodadas — e salva os resumos do k6, o JSON das requisições,
   as janelas e a saída do item 3.
5. docs/ensaios/cq01-<data>.md com:
   - máquina usada e configuração;
   - as janelas de cada rodada (início, fim e duração);
   - tabela p50/p95/p99/máx e n dos observadores nas duas rodadas, com uma linha "na janela" e
     uma linha "geral" para cada rodada;
   - se o critério passou (pelo grupo "na janela");
   - a interpretação.

Pronto quando: as duas rodadas executaram e o relatório mostra os números reais, separados
entre "na janela" e "geral", com o n de cada grupo.
Não ajuste os thresholds para fazer passar: se falhar, o relatório diz que falhou e
propõe a causa.

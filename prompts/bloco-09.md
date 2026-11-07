# Bloco 9 — Medir o CQ-01 (vizinho barulhento) com e sem a mitigação

Objetivo: medir o cenário CQ-01 de docs/atributos.md com k6.

Faça:
1. tests/carga/cq01.js (k6):
   - setup: cria pela API 1 tenant equipe (o barulhento) e 10 tenants individuais
     (observadores), cada observador com 50 contatos.
   - cenário "barulhento": 3 importações de 500 linhas, uma a cada 20 s (CSV com cabeçalho, no
     formato de docs/contrato-api.md, seção 7).
   - cenário "observadores": 10 VUs, cada um faz GET /contatos?busca=<termo> a cada 3 s,
     durante 2 minutos. Tag cenario=observadores.
   - thresholds: http_req_duration{cenario:observadores} p(95)<800 e max<2000;
     http_req_failed{cenario:observadores} rate==0.
2. Serviço "k6" no docker-compose (imagem grafana/k6, profile "carga", volume com
   tests/carga, alvo http://api-contatos:3000) para rodar na rede interna do compose:
   docker compose --profile carga run --rm k6 run /scripts/cq01.js
3. scripts/medir-cq01.ps1: roda duas vezes — com os padrões (IMPORT_LOTE=100,
   IMPORT_PAUSA_MS=500) e sem mitigação (IMPORT_LOTE=5000, IMPORT_PAUSA_MS=0), recriando
   o serviço importacao entre as rodadas — e salva os resumos do k6.
4. docs/ensaios/cq01-<data>.md com: máquina usada, configuração, tabela p50/p95/p99/máx
   dos observadores nas duas rodadas, se o threshold passou, e a interpretação.

Pronto quando: as duas rodadas executaram e o relatório mostra os números reais.
Não ajuste os thresholds para fazer passar: se falhar, o relatório diz que falhou e
propõe a causa.

# Bloco 7 — ADR-004, documentos e entrega da Etapa 2

Objetivo: documentar a Etapa 2. Não altere código neste bloco.

Faça:
1. docs/adr/adr-004-comunicacao-entre-servicos.md, no mesmo formato dos ADRs existentes
   (Status, Contexto, Opções, Decisão, Consequências positivas e negativas, Gatilhos de
   revisão), cobrindo: síncrono x assíncrono entre API e Importação e por que fila;
   por que a Importação grava pela API e não no banco; propagação do tenant (JWT ->
   payload -> token de serviço) e por que dois segredos; idempotência (jobId + lotes_aplicados
   + upsert); o CSV no payload até 1 MB em vez de S3, com gatilho "revisar se o limite
   passar de 5 MB ou se a fila passar de 200 MB"; comportamento quando a Importação ou o
   Redis caem. Use números do projeto, com a conta.
2. docs/02-arquitetura-c4.md: atualize o nível 2 para o que existe hoje e marque como
   "planejado — Etapa 4" ou "adiado — ver ADR-004" o que não foi construído (Portal Web,
   Notificações, Gerador de Documentos, armazenamento S3). Não apague o desenho original:
   acrescente uma seção "Estado na Etapa 2".
3. docs/adr/adr-003: acrescente nota de revisão: o "intervalo de 5 min entre jobs" foi
   substituído pelo limite de importações simultâneas por plano + concurrency 2 do worker,
   explicando por quê.
4. README.md: seção "Como rodar" (pré-requisitos, .env, docker compose, seed, testes,
   deploy no kind, scripts de demo) e tabela da Etapa 2 apontando para cada evidência.
5. docs/etapa-2.md: checklist do que a Etapa 2 pede x onde está a evidência no repositório.

Pronto quando: todos os links relativos dos arquivos de docs/ resolvem (verifique) e o
diagrama Mermaid alterado continua válido.

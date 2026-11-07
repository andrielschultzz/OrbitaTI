# Bloco 5 — Rastreamento, rate limit por tenant e degradação

Objetivo: aplicar ao OrbitaTI três padrões do Encontro 11: rastreamento de requisição
(experimento 1), degradação quando o segundo serviço cai (experimento 4) e limite por
tenant contra o vizinho barulhento (experimento 6).

Faça:
1. x-request-id: a API aceita o header ou gera um UUID, devolve na resposta, inclui no
   payload do job; o worker usa o mesmo id nos próprios logs e reenvia no callback.
   Todos os logs (pino) dos dois serviços com reqId e tenant_id.
2. Rate limit com @fastify/rate-limit rodando DEPOIS da autenticação (hook preHandler),
   chave = tenant_id, máximo = 60 req/min x usuários do plano (planos.js: 60 | 600).
   POST /auth/login: chave = IP + e-mail, 10 req/min (contra força bruta numa conta).
   POST /auth/cadastro: chave = IP, LIMITE_CADASTRO_POR_MIN (padrão 60, para a suíte de
   testes e o setup do k6 não se bloquearem). /saude e /interno ficam fora.
   Resposta 429 com header Retry-After e corpo {erro, codigo: "LIMITE_REQUISICOES"} do contrato
   (errorResponseBuilder do @fastify/rate-limit).
3. tests/rate-limit.test.js: um tenant individual faz 61 requisições -> a 61ª é 429,
   e um segundo tenant, logo em seguida, continua recebendo 200.
4. scripts/demo-degradacao.ps1: mostra /saude, para o serviço importacao
   (docker compose stop importacao), prova que login, busca e cadastro de contato seguem
   funcionando, envia uma importação (fica na_fila), sobe o serviço de novo e mostra a
   importação concluindo. Depois repete parando o redis: POST /importacoes -> 503 rápido
   (menos de 2 s) e o resto segue respondendo. Pausas com Read-Host.

5. trustProxy na API, pelo número de saltos (TRUST_PROXY_SALTOS, padrão 1, no .env.example).
   Por quê: o Portal (bloco 13) fica atrás de um Nginx; sem isso, toda requisição chega com o IP
   do Nginx e os limites de login (IP + e-mail) e de cadastro (IP) passam a valer para todos os
   usuários juntos. Prove com teste que chamadas diretas com X-Forwarded-For diferentes têm
   contadores de login separados. Explique o risco que sobra (quem fala direto com a API pode
   forjar o header) e por que a porta 3000 publicada só em 127.0.0.1 (bloco 2) resolve.

Não faça: nenhuma alteração em docs/ neste bloco (a documentação fica para o bloco 7).

Pronto quando: npm test passa; uma requisição com header x-request-id: demo-123 que gera
importação aparece com "demo-123" nos logs da API e do worker
(docker compose logs | Select-String demo-123); e scripts/demo-degradacao.ps1 roda até o fim.

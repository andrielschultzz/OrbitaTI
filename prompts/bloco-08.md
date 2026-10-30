# Bloco 8 — Integração contínua (Etapa 3)

Objetivo: criar a integração contínua do OrbitaTI no GitHub Actions.

Faça:
1. .github/workflows/ci.yml disparado em push e pull_request: checkout, Node 22 com cache
   do npm, copia .env.example para .env, docker compose up -d --build --wait, npm ci,
   npm test. Se falhar, imprime docker compose logs. Timeout de 15 minutos.
2. Badge do workflow no topo do README.
3. Garanta que os testes não dependem de dados deixados por execuções anteriores
   (cada teste cria seus próprios tenants com e-mails únicos).

Pronto quando: o workflow passa num push de teste. Depois, num branch descartável,
introduza uma rota com tenant_id e mostre que o CI fica vermelho. Apague o branch.

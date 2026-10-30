# Bloco 3 — Provar o isolamento (CQ-02) e preparar a demo

Objetivo: implementar a verificação do cenário CQ-02 (docs/atributos.md) e preparar a
demonstração de isolamento ao vivo da Etapa 2.

Faça:
1. tests/isolamento.test.js: cria dois tenants (A e B) pela API; B cria um contato;
   A tenta GET, PATCH e DELETE nesse id -> 404 em todos e o contato de B continua intacto;
   GET /contatos de A não contém nada de B; um JWT de A com o payload alterado para o
   tenant_id de B (sem reassinar) -> 401; JWT expirado -> 401.
   Organize como uma tabela de rotas (método, caminho) percorrida em laço, para que toda
   rota nova com :id entre na suíte só acrescentando uma linha.
2. services/api-contatos/test/rotas-sem-tenant.test.js: monta o app com buildApp(),
   coleta todas as rotas com o hook onRoute e falha se alguma tiver "tenant" no caminho,
   na querystring ou no schema do corpo. É a regra do ADR-002 verificada por máquina.
   Inclua esse teste no "npm test" da raiz.
3. scripts/seed.js (npm run seed): cria pelos endpoints públicos os tenants de demonstração
   DevSolo Sistemas (individual, marcelo@devsolo.dev) e TechConsult Solutions (equipe,
   gestor@techconsult.com.br), senha Demo@2026, com 5 e 20 contatos fictícios.
   Idempotente: se já existirem, só avisa.
4. scripts/demo-isolamento.ps1 (PowerShell, Invoke-RestMethod, parâmetro -BaseUrl com
   padrão http://localhost:3000): faz login nos dois, mostra quantos contatos cada um vê,
   pega o id de um contato da TechConsult e tenta lê-lo como DevSolo, imprimindo
   claramente "404 — isolamento OK" ou "FALHA DE ISOLAMENTO". Pausa entre os passos
   (Read-Host) para eu narrar na apresentação.

Pronto quando: npm test passa (rls, auth, contatos, isolamento, rotas-sem-tenant) e
.\scripts\demo-isolamento.ps1 roda até o fim mostrando os 404.

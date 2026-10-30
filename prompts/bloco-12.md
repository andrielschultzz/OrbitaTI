# Bloco 12 — O produto: interações e contatos esfriando (Etapa 4)

Objetivo: implementar as funcionalidades centrais do produto descritas em
docs/01-visao-produto.md.

Faça:
1. Migração 003: orbita.interacoes(id, tenant_id, contato_id fk, usuario_id, tipo
   check ligacao|whatsapp|email|reuniao|outro, nota, ocorrida_em, criado_em) com RLS
   (mesma política de sempre); orbita.contatos.estagio check lead|proposta|cliente|perdido
   default lead.
2. POST /contatos/:id/interacoes e GET /contatos/:id/interacoes; registrar uma interação
   atualiza contatos.ultima_interacao_em na mesma transação.
3. GET /contatos/esfriando?dias=90: contatos sem interação há N dias (ou nunca), do mais
   frio ao mais recente, excluindo estagio "perdido". Padrão 90.
4. PATCH /contatos/:id aceita estagio.
5. Acrescente TODAS as rotas novas à tabela de tests/isolamento.test.js (contato de B lido,
   alterado ou com interação criada por A -> 404) e confira que o teste de rotas sem
   tenant continua passando.
6. Testes de comportamento: interação atualiza ultima_interacao_em; esfriando respeita os
   dias e não mostra contatos de outro tenant.

Pronto quando: npm test passa inteiro, inclusive o CI.

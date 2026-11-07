# Bloco 12 — O produto: interações e contatos esfriando (Etapa 4)

Objetivo: implementar as funcionalidades centrais do produto descritas em
docs/01-visao-produto.md. Formatos e regras: docs/contrato-api.md, seções 5 e 6.

Faça:
1. Migração 003: orbita.interacoes(id, tenant_id, contato_id fk ON DELETE CASCADE, usuario_id, tipo
   check ligacao|whatsapp|email|reuniao|outro, nota, ocorrida_em, criado_em) com RLS
   (mesma política de sempre); orbita.contatos.estagio check lead|proposta|cliente|perdido
   default lead.
2. POST /contatos/:id/interacoes e GET /contatos/:id/interacoes; registrar uma interação
   faz ultima_interacao_em = GREATEST(ultima_interacao_em, ocorrida_em) na mesma transação
   (lançar hoje uma ligação antiga não pode esfriar o contato) e devolve {interacao, contato}.
3. GET /contatos/esfriando?dias=90&limite=100: referência = COALESCE(ultima_interacao_em, criado_em);
   entram os contatos com referência há mais de N dias, da mais antiga à mais recente, excluindo
   estagio "perdido", com dias_sem_interacao e nunca_contatado. Padrão: 90 dias, limite 100.
   Por que criado_em: depois de importar 500 contatos, todos seriam "nunca contatados" e
   lotariam o "Saindo de órbita" no primeiro dia.
4. PATCH /contatos/:id aceita estagio.
5. Acrescente TODAS as rotas novas à tabela de tests/isolamento.test.js (contato de B lido,
   alterado ou com interação criada por A -> 404) e confira que o teste de rotas sem
   tenant continua passando.
6. Testes de comportamento: interação atualiza ultima_interacao_em; interação antiga não a
   faz voltar no tempo; esfriando respeita os dias, não lista contato recém-criado e não mostra
   contatos de outro tenant; excluir contato com interações -> 204.

Pronto quando: npm test passa inteiro, inclusive o CI.

-- 002_email_confirmado: data em que o usuário confirmou o e-mail (bloco 10).
-- Roda como `migrador` (dono). O migrate.js abre a transação.
--
-- NULL = ainda não confirmou. O login NÃO exige confirmação (bloco 10, item 4): o e-mail não pode travar
-- o onboarding. Quem grava é o GET /auth/confirmar, dentro de withTenant (o tenant vem do token assinado).
--
-- Não precisa de GRANT nem de política nova: api_contatos já tem UPDATE em orbita.usuarios (001) e a
-- política isolamento_tenant da tabela vale para a coluna nova.
ALTER TABLE orbita.usuarios ADD COLUMN email_confirmado_em timestamptz;

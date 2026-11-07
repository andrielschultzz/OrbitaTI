# Bloco 10 — Notificações por e-mail e medição do CQ-03

Objetivo: implementar o envio de e-mail de confirmação de cadastro e medir o CQ-03
(docs/atributos.md: do envio do formulário ao e-mail entregue, p90 < 45 s).

Faça:
1. Mailpit no compose (axllent/mailpit, SMTP 1025, interface web em 127.0.0.1:8025).
2. services/notificacoes: worker BullMQ da fila "emails" que envia com nodemailer para o
   SMTP do Mailpit. Sem porta publicada, sem acesso ao schema orbita (não precisa de banco).
3. Na API: o cadastro enfileira {tipo:"confirmar-cadastro", para, nome, link} DEPOIS do
   commit. O link é ${PORTAL_URL}/confirmar-email?token=... (PORTAL_URL no .env.example, padrão
   http://localhost:8080; na VM, o endereço público — nunca "localhost" fixo no código). A tela
   /confirmar-email do Portal chama GET /auth/confirmar (contrato, seção 4). Se a fila estiver fora, o cadastro conclui mesmo assim e registra aviso no log
   — e-mail não pode impedir o onboarding.
4. Migração 002: orbita.usuarios.email_confirmado_em. GET /auth/confirmar?token=...
   (token assinado, válido 24 h) marca a data. O login NÃO exige confirmação.
5. tests/cq03-onboarding.test.js: 20 cadastros, mede do POST até a mensagem aparecer na
   API do Mailpit (http://localhost:8025/api/v1/search?query=to:<email>), calcula p90 e
   falha acima de 45 s. Imprime p50, p90 e máximo.
6. docs/ensaios/cq03-<data>.md com os números e esta ressalva: localmente não existe o
   provedor real de e-mail, que é 96% do orçamento de 45 s; o teste mede a parte que a
   arquitetura controla (banco + fila + worker).

Pronto quando: npm test passa e a mensagem aparece na interface do Mailpit.

# Serviços — rascunho (OrbitaTI)

**Foto do desenho:** `docs/desenho-servicos.jpg`

**a) Qual é o segundo serviço, e o que ele recebe do primeiro?**
O Serviço de Importação; recebe da API de Contatos um evento na fila com `tenant_id` e o arquivo CSV a importar.

**b) Onde o tenant é descoberto, e como chega ao segundo serviço?**
Na API de Contatos, a partir do JWT; chega ao segundo serviço dentro da mensagem na fila.

**c) Se alguém esquecer o filtro no código, o que segura o vazamento?**
O Row-Level Security (RLS) do PostgreSQL.

**d) Se o segundo serviço cair, o que o usuário ainda consegue fazer?**
Tudo menos importar contatos em massa; as importações ficam na fila até ele voltar.

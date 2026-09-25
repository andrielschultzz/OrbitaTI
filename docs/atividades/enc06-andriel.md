# Atividade Dirigida — Encontro 06
**Disciplina:** Arquitetura de Software SaaS — EC7, SETREM 2026-2
**Aluno:** Andriel
**Produto:** Mini-CRM para profissionais de TI que pegam trabalhos por fora

---

## Parte A — Autoverificações

### AV1

Pensando no nosso produto, o que precisa acontecer entre "assinou" e "primeiro login" é basicamente isso:

O sistema insere um registro na tabela `tenants` do banco PostgreSQL — que é compartilhado, já que optamos pelo modelo pool. A partir desse INSERT já temos o `tenant_id`. Logo depois, o próprio sistema cria o primeiro usuário com papel de admin vinculado a esse tenant, sem precisar de nenhuma ação manual da nossa parte. Aí o Serviço de Notificações manda o e-mail de confirmação, o usuário clica, valida o token e está logado.

O dado do tenant novo nasce na tabela `tenants` no momento do passo 1. Quem cria o admin é o sistema automaticamente — não tem humano no caminho em nenhum momento.

---

### AV2

A diferença principal está em *onde* cada um vive e *quem* é responsável por ele.

Uma feature flag por tenant fica na camada de configuração — fora do código, visível pra qualquer pessoa da equipe sem precisar abrir o repositório. Ela tem um dono e, idealmente, uma data pra ser revisada ou removida. Já um `if cliente == 'Ferrosul'` dentro do código não tem dono nenhum, não tem data de validade e ninguém vai lembrar que ele existe no próximo release. É um fork disfarçado. A flag é governada; o `if` hardcoded virou dívida técnica antes mesmo de ser mergeado.

---

### AV3

No nosso caso, o tenant barulhento típico seria uma consultoria de TI com vários colaboradores que resolve importar toda a base de contatos de uma vez via CSV — pensa em 500 registros sendo inseridos ao mesmo tempo no banco compartilhado. Essa importação em massa no **Módulo de Contatos** satura o PostgreSQL com escritas pesadas e começa a atrasar as queries simples de quem está usando o sistema no mesmo momento, mesmo que seja só um freelancer pequeno consultando 3 contatos.

---

## Parte B — O caso TreinaMais

> *Nota: o arquivo `caso06-o-tenant-que-pediu-feature-exclusiva.md` não veio junto com a atividade, então os números da B-Q1 foram estimados com base nos elementos que aparecem no próprio enunciado — especialmente o R$ 900/mês da Opção B e o contexto dos 95 tenants.*

### B-Q1

Base usada nas três linhas: **R$ 10.800/ano = R$ 900/mês × 12** (receita anual do pacote de conformidade que a Ferrosul pediu). O risco de perder o contrato inteiro da Ferrosul vai numa coluna separada — porque é uma grandeza diferente.

| Opção | Semanas de time de produto | R$ 10.800/ano em jogo (R$ 900 × 12) | Risco de perder o contrato inteiro da Ferrosul | Efeito no roadmap dos outros 94 tenants |
|---|---|---|---|---|
| **A** — código exclusivo | ~8 semanas | Preservado — Ferrosul fica, mas o valor foi gasto em dev exclusivo, não gerado como receita nova | Eliminado (cliente recebeu o que pediu) | Roadmap travado por ~2 meses; cria precedente péssimo de "quem paga bem ganha código próprio" |
| **B** — feature de plano, atrás de flag | ~4 semanas | Gerado — Ferrosul paga o pacote + potencial de outros tenants do mesmo segmento | Baixo (Ferrosul tem a necessidade atendida via plano; depende de aceitar o preço) | Impacto mínimo; a feature vira produto para todos que precisarem |
| **C** — recusar com parceria | 0 semanas | Não gerado — sem o pacote, sem receita desse item | Alto (Ferrosul provavelmente sai se não tiver a funcionalidade) | Nenhum |

### B-Q2

Acho que é defensável sim, mas depende muito de como o comercial apresenta. Cobrar R$ 900/mês por log de auditoria faz sentido se o argumento for sobre o valor entregue — afinal, isso exige metering, armazenamento com garantia de integridade e rastreabilidade que vão muito além do produto padrão. Não é "pagou mais, ganhou mais atenção"; é um plano diferente com capacidade técnica diferente.

O problema começa se metade do funil comercial for indústria como a Ferrosul. Nesse cenário, o que parece um pedido pontual vira na verdade um requisito de mercado, e fica estranho cobrar separado por algo que todo mundo daquele segmento precisa. O certo seria absorver isso num tier de plano "Compliance" ou "Industrial" e fechar esse gap de uma vez. Manter o R$ 900 avulso pra metade dos prospects só complica a venda.

---

## Parte C — Aplicação ao produto da equipe

### C1 — Dois tenants de referência

**Entidade central do produto:** Contato Comercial — a pessoa ou empresa que o profissional de TI está tentando fechar como cliente, manter aquecida ou transformar em projeto.

|  | **Tenant pequeno** | **Tenant grande** |
|---|---|---|
| Nome fictício e cidade | DevSolo Sistemas — Erechim, RS | TechConsult Solutions — Porto Alegre, RS |
| Nº de usuários | 1 (o próprio freelancer) | 6 (3 consultores + 2 comerciais + 1 gestor) |
| Volume mensal da entidade central | ~80 contatos ativos | ~600 contatos ativos |
| Mensalidade (premissa declarada) | R$ 49/mês — plano Individual | R$ 249/mês — plano Equipe |

---

### C2 — Onboarding a partir do nosso modelo de tenancy

**Decisão do ADR (27/08):**
> Modelo **Pool** — tabelas compartilhadas com coluna `tenant_id` no PostgreSQL. A escolha foi baseada no perfil do produto: freelancers de TI não têm budget pra pagar por isolamento de banco, e o risco de vazamento entre tenants é resolvido com Row-Level Security. O benefício principal é onboarding self-service imediato — sem provisionar nada.

> *O ADR ainda não foi versionado no repositório — commit pendente em `docs/adr/` (prazo era 08/09, já declarado na entrega; o commit precisa ser feito antes de 10/09).*

**Passos para a TechConsult Solutions entrar no ar:**

| # | O que acontece | Automático ou manual? |
|---|---|---|
| 1 | Usuário preenche o formulário de cadastro no **Portal Web** | Automático — self-service |
| 2 | Sistema faz INSERT na tabela `tenants` do PostgreSQL e gera o `tenant_id` | Automático |
| 3 | Sistema cria o usuário admin vinculado ao `tenant_id` na tabela `users` | Automático |
| 4 | Seed de configuração na tabela `tenant_settings` (categorias padrão, funil vazio, limites do plano) | Automático |
| 5 | **Serviço de Notificações** manda o e-mail de confirmação | Automático |
| 6 | Usuário confirma o e-mail → sessão criada | Automático |
| 7 | Primeiro login no **Portal Web** — dashboard vazio, pronto pra usar | Automático |

Tempo total: 2 a 4 minutos. O único gargalo é o usuário clicar no e-mail, o que às vezes leva uns minutos dependendo do servidor. Comparando com os 20 minutos da TreinaMais — que usa schema-per-tenant e precisa provisionar schema e rodar migrações a cada novo cliente — nosso modelo é bem mais rápido e não precisa de nenhuma intervenção nossa. Se quisermos chegar a sub-minuto, dá pra trocar a confirmação por e-mail por magic link, sem mudar nada no modelo de tenancy.

---

### C3 — Pedido de feature exclusiva da TechConsult Solutions

**(a) O pedido, na voz do cliente:**
> "A gente precisa que o sistema gere automaticamente uma proposta em PDF quando a gente marca um contato como Oportunidade Quente no **Módulo de Oportunidades**. Já com nosso logo e os serviços que a gente mais vende. Hoje o processo é manual — abre o Word, copia os dados, ajusta o texto — e perde muito tempo. Tô disposto a pagar a mais por isso."

**(b) Onde isso cai na escada:**

Cai no **Degrau 2 — feature de plano**, não em código exclusivo. A razão é simples: gerar proposta em PDF a partir de um template é algo que qualquer consultoria de TI que usa o mini-CRM provavelmente quer. Construir isso pra TechConsult já entrega valor pra outros tenants também.

O container que implementa isso é o **Gerador de Documentos** (C4 nível 2): ele escuta o evento de status "Oportunidade Quente" do **Módulo de Oportunidades**, pega o template configurado pelo tenant (logo, cabeçalho, texto padrão — isso é degrau 1, configuração por tenant, grátis), renderiza o PDF e disponibiliza no Portal Web. O que é pago é a automação por evento — sem precisar clicar pra gerar.

**(c) Impacto no billing:**

A geração de documentos entra como dimensão do plano **Equipe** (R$ 249/mês), com limite de 50 PDFs gerados por mês. No plano **Individual** (R$ 49/mês), dá pra gerar manualmente, mas sem automação por evento e com limite de 10/mês.

Sobre quando vale a pena construir: com **3 ou 4 tenants do Equipe** pedindo a mesma coisa (3 × R$ 249 = R$ 747/mês), o custo de ~4 semanas de desenvolvimento se paga em torno de 11 meses — e ainda atrai novos tenants que vêem a feature.

---

### C4 — O vizinho barulhento como cenário de qualidade

A operação que vai dar problema é a **importação em massa de contatos via CSV** pela TechConsult Solutions. Quando ela importa 500+ registros de uma vez pro **Módulo de Contatos**, o banco PostgreSQL compartilhado fica sobrecarregado com INSERTs pesados e a DevSolo Sistemas — que tem 80 contatos e tá usando o sistema ao mesmo tempo — começa a sentir lentidão nas buscas mais simples.

**Cenário para `docs/atributos.md`:**
> "Durante uma importação em massa de contatos pelo tenant grande (estímulo: job de importação de 500+ registros no Módulo de Contatos), as operações de busca e listagem de outros tenants respondem em menos de **800 ms** para **95% das requisições**, sem degradação perceptível."

**Quota proposta:**
> Máximo de **100 contatos por job de importação**, com intervalo mínimo de **5 minutos entre jobs consecutivos** para qualquer tenant.
>
> A lógica dos números vem diretamente do C1: a DevSolo opera com ~80 contatos/mês e nunca vai importar em massa, então a quota de 100 não atrapalha ela em nada. A TechConsult precisaria de 6 jobs ao longo de 30 minutos pra importar sua base completa — distribui a carga, protege os menores.

---

### C5 — Política de customização em 3 regras

| Regra | Resposta |
|---|---|
| 1. O que é **configuração por tenant** (grátis, disponível em todos os planos) | Campos extras no cadastro de Contatos (ex.: "Tipo de Projeto", "Origem do Lead"), etiquetas e categorias no **Módulo de Oportunidades**, logo da empresa no Portal Web, papéis de usuário (admin / consultor / visualizador) e nome das etapas do funil. O usuário mesmo faz tudo isso nas Configurações — sem precisar falar com a gente. |
| 2. O que vira **plano pago** | Acesso à **API REST** pra integrar com sistemas externos, geração automática de PDFs via **Gerador de Documentos** disparada por evento, importação em massa via CSV acima de 100 por job, histórico de interações completo (no Individual fica limitado a 6 meses) e mais de 1 usuário por tenant. |
| 3. O que é **sempre "não"** — e o que oferecemos no lugar | Nunca: desenvolver tela, fluxo ou lógica de negócio exclusiva pra um único tenant. No lugar: se for algo de configuração, mostramos o que dá pra fazer no degrau 1 (campos, etiquetas). Se for uma integração específica, configuramos um webhook no Portal Web pra o tenant apontar pra onde quiser (degrau 3). Se 3 ou mais tenants pedirem a mesma coisa, vai pro roadmap como feature de plano. |

---

## Parte D — Evidências e declaração de uso de IA

### E0 — Ambiente

> ⚠️ Inserir aqui o print dos 4 comandos do Lab 0:
> ```
> docker version
> kind version
> kind get clusters
> kubectl get nodes
> ```
> Se ainda não fechou o ambiente, cola o print do erro — também conta e já coloca na fila do checkpoint de 10/09.

---

### E1 — ADR de tenancy

> ⚠️ **Commit urgente — antes de 10/09.** O prazo declarado era 08/09 e já passou. Rode os comandos abaixo no repositório da equipe:
>
> ```bash
> # No repositório da equipe, com o arquivo do ADR já salvo em docs/adr/
> git add docs/adr/
> git commit -m "ADR de tenancy - modelo pool"
> git push
>
> # Depois confirme:
> git log -1 --format="%h %ad %an %s" --date=short -- docs/adr/
> # Cole a saída aqui e atualize o arquivo no repositório
> ```
>
> **Rascunho do ADR (colar em `docs/adr/adr-tenancy.md`):**
>
> **Contexto:** produto pra freelancers e pequenas consultorias de TI. Volume por tenant baixo a médio. Precisa de onboarding self-service sem intervenção manual.
>
> **Decisão:** Pool — tabelas compartilhadas com `tenant_id` no PostgreSQL. Custo operacional baixo por tenant, provisiona em segundos, sem infraestrutura separada por cliente.
>
> **Consequência negativa:** toda query deve filtrar por `tenant_id` obrigatoriamente. Mitigação: Row-Level Security (RLS) no PostgreSQL ativado por padrão.

---

### Declaração de uso de IA

```
Ferramenta: Claude (Anthropic)

Para quê: ajuda na estruturação e redação das respostas das Partes A, B e C,
com base no contexto do meu produto (mini-CRM para TI freelancers) que eu passei.

O que aceitei, rejeitei ou corrigi:
- Aceitei a estrutura geral e os nomes dos containers (Portal Web, Módulo de Contatos,
  Módulo de Oportunidades, Gerador de Documentos, Serviço de Notificações).
- Os valores de mensalidade (R$ 49 e R$ 249/mês) e os volumes do C1 (80 e 600 contatos)
  foram ajustados por mim pra ficarem dentro do que faz sentido pro mercado.
- A análise do B-Q2 e a política do C5 foram discutidas e os argumentos são meus.
- Pra defesa oral de 10/09 (sem IA) vou defender com base no entendimento real
  do que está escrito aqui.
```

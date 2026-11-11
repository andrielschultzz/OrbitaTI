# 1.5 — Mapeamento LGPD preliminar

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen
**Etapa 1 — Proposta de arquitetura**
**Status:** preliminar — aprofundado na Etapa 3. **Revisão de 10/11/2026 (bloco 14):** exportação, cancelamento e exclusão em 30 dias implementados; ver "Como está implementado" e a tabela "A implementar"

> Documento de arquitetura, não parecer jurídico. As bases legais indicadas são a leitura técnica da equipe e devem ser validadas por profissional da área antes de o produto entrar em produção com clientes reais.

---

## O ponto que define tudo

O OrbitaTI tem uma característica que o separa da maioria dos SaaS de gestão: **o dado mais importante do sistema pertence a alguém que não é usuário do sistema**.

O Contato Comercial — a entidade central definida em [`01-visao-produto.md`](01-visao-produto.md) — é uma pessoa real, com nome, telefone e e-mail, que nunca criou conta no OrbitaTI, nunca aceitou termo de uso e, na maioria dos casos, não sabe que está cadastrada. Ela foi inserida pelo profissional de TI depois de uma conversa, uma indicação ou um orçamento.

Isso produz uma divisão de papéis que precisa estar clara antes de a primeira linha de código ser escrita:

| Papel LGPD | Quem é | Responsável por |
|---|---|---|
| **Controlador** | **O tenant** — o profissional de TI ou a consultoria | Decidir quais contatos cadastrar, para quê, e por quanto tempo. Responder ao titular que exercer direitos |
| **Operador** | **O OrbitaTI** | Tratar os dados **exclusivamente** conforme instrução do tenant. Garantir segurança. Não usar os dados para finalidade própria |

A consequência prática é direta: **o OrbitaTI não decide nada sobre os dados dos contatos**. Não os usa para treinar modelo, não os cruza entre tenants, não os enriquece com fonte externa, não os usa para prospectar. Qualquer uma dessas coisas transformaria o OrbitaTI em controlador de dados de milhares de pessoas que nunca ouviram falar dele.

Há uma exceção: para os dados dos **usuários** do tenant — quem faz login, com e-mail, senha e logs de acesso — o OrbitaTI é controlador, porque é ele quem decide coletá-los para operar a conta.

---

## Inventário de dados

### Dados de usuário do tenant — OrbitaTI é controlador

| Dado | Titular | Finalidade | Base legal | Retenção |
|---|---|---|---|---|
| Nome e e-mail | Usuário | Identificação e autenticação | Execução de contrato — art. 7º, V | Vida da conta + 30 dias |
| Nome, e-mail e link de confirmação no job da fila `emails` (bloco 10) | Usuário | Enviar o e-mail de confirmação do cadastro | Execução de contrato — art. 7º, V | **Até o envio** (`removeOnComplete`); se o envio falhar de vez, **24 h** (`removeOnFail`), o mesmo prazo de validade do link |
| Nome, e-mail e link de exportação no job da fila `emails` (bloco 14) | Usuário (o admin que cancelou) | Enviar o link de exportação depois do cancelamento | Execução de contrato — art. 7º, V | **Até o envio** (`removeOnComplete`); se o envio falhar de vez, **24 h** (`removeOnFail`). O link em si vale até `cancelado_em + 30 dias` |
| Id do tenant no job da fila `exclusao-importacao` (bloco 14) | — (não é dado pessoal) | Pedir ao Serviço de Importação que apague o schema dele | — | Até o fim do job; se falhar de vez, 7 dias para reprocessar |
| Data de confirmação do e-mail (`usuarios.email_confirmado_em`) | Usuário | Saber se o endereço é da pessoa | Execução de contrato — art. 7º, V | Vida da conta |
| Senha (hash Argon2id) | Usuário | Autenticação | Execução de contrato — art. 7º, V | Vida da conta |
| Logs de acesso — IP, data/hora, ação | Usuário | Segurança, auditoria e investigação de incidente | Obrigação legal — art. 7º, II, c/c Marco Civil art. 15 | **6 meses** |
| Dados de cobrança | Tenant (PJ ou MEI) | Faturamento e obrigação fiscal | Obrigação legal — art. 7º, II | **5 anos** (prazo fiscal) |

### Dados de contato comercial — OrbitaTI é operador

| Dado | Titular | Finalidade (definida pelo tenant) | Base legal do tenant | Retenção |
|---|---|---|---|---|
| Nome | Contato — terceiro | Gestão do relacionamento comercial | Legítimo interesse — art. 7º, IX | Definida pelo tenant; padrão: vida da conta |
| E-mail e telefone | Contato | Contato comercial e envio de proposta | Legítimo interesse — art. 7º, IX | Idem |
| Empresa e cargo | Contato | Qualificação comercial | Legítimo interesse — art. 7º, IX | Idem |
| Histórico de interações — notas livres | Contato | Registro do relacionamento | Legítimo interesse — art. 7º, IX | Idem |
| Oportunidades — valor, estágio, prazo | Contato e tenant | Acompanhamento comercial | Legítimo interesse — art. 7º, IX | Idem |
| Propostas em PDF | Contato | Formalização de orçamento | Execução de contrato — art. 7º, V | Idem |

### Dado sensível

**O OrbitaTI não coleta nem solicita dado sensível** na acepção do art. 5º, II — origem racial, convicção religiosa, opinião política, filiação sindical, saúde, vida sexual, dado genético ou biométrico. Não há campo para isso no produto.

O risco real está no **campo livre de notas de interação**, onde um usuário pode digitar qualquer coisa — inclusive informação sensível sobre um contato. É o ponto mais frágil do mapeamento.

*Medidas:* aviso no rótulo do campo orientando a registrar apenas informação de negócio; cláusula no contrato de operador atribuindo ao tenant a responsabilidade pelo que seus usuários escrevem; e, a partir da Etapa 3, verificação automática que alerta — sem bloquear — quando o texto contém padrão de CPF ou de dado de saúde.

---

## Ciclo de vida e a fase que quase ninguém projeta

O tenant passa por cinco fases — assinar, configurar, usar, crescer e sair. A última é a que gera obrigação de LGPD e a que costuma ficar de fora do desenho.

| Fase | O que acontece com os dados |
|---|---|
| **Assinar** | Criação do tenant e do usuário admin. Dados mínimos: nome, e-mail, senha |
| **Configurar / usar** | Tenant insere contatos. A partir daqui o OrbitaTI trata dado de terceiro como operador |
| **Crescer** | Volume aumenta; papéis e permissões se diferenciam |
| **Cancelar** | O login passa a ser recusado (o token já emitido vale até expirar, no máximo 15 min). **Exportação completa em JSON disponível por 30 dias**, por um link enviado por e-mail ao admin. *Revisão do bloco 14:* o desenho original dizia "modo somente leitura" e "CSV e JSON". Ficou mais simples: sem login não há leitura, e o formato é o do contrato (JSON, seção 9 de [`contrato-api.md`](contrato-api.md)). Quem precisar de CSV no formato do modelo de importação tem o `scripts/restaurar-um-tenant.ps1` (bloco 11, uso do operador) |
| **Excluir** | Após 30 dias, exclusão definitiva por um job diário: cada serviço apaga o próprio schema (`orbita` pela API, `importacao` pelo worker), sempre com o tenant fixado e sob RLS. O armazenamento de objetos está adiado ([ADR-004](adr/adr-004-comunicacao-entre-servicos.md)), então não há prefixo para remover. Logs de acesso sobrevivem os 6 meses do Marco Civil, desvinculados do conteúdo: o log da exclusão leva só o `tenant_id` e quantas linhas saíram de cada tabela |

O prazo de 30 dias é declarado no contrato e implementado como job agendado, não como tarefa manual. **Exclusão que depende de alguém lembrar não é medida de segurança.**

**O cascade não alcança o schema `importacao`** (achados B1 e I9, revisão de 08/11/2026; **resolvido no bloco 14**). As tabelas de `orbita` apagam em cascata a partir de `orbita.tenants`, mas as de `importacao` não têm chave estrangeira para lá: é a fronteira entre os serviços, e o papel `importacao_svc` não enxerga `orbita`.

- **Como ficou:** a API pede pela fila `exclusao-importacao` que o worker apague `importacao.execucoes` e `importacao.erros_linha` do tenant, como `importacao_svc` e com o tenant fixado. Só depois de o pedido entrar na fila a API apaga `orbita`. Coberto pelo T-LGPD-03.
- **Jobs pendentes:** não sobram jobs de importação do tenant quando a exclusão roda. O token de sessão morre no máximo 15 min depois do cancelamento (nenhuma importação nova), e job falho some do Redis em 24 h; a exclusão só vem 30 dias depois. Para o caso extremo (worker parado por semanas e um job velho rodando depois da exclusão), o worker apaga o que acabou de gravar quando a API responde 404 para a importação (teste unitário em `services/importacao/test/processar.test.js`).

### Como está implementado (bloco 14, 10/11/2026)

| Parte | Onde | Como | Testes |
|---|---|---|---|
| Exportação pelo Portal | `GET /conta/exportacao` (`services/api-contatos/src/rotas/conta.js`), botão "Exportar meus dados" em Conta | Só `admin` (outro papel: 403). Um `withTenant` lê as cinco partes com colunas explícitas: nunca `senha_hash` | T-LGPD-01, T-ISO-18, E2E `web/e2e/conta.spec.js` |
| Cancelamento | `POST /conta/cancelamento`, botão "Cancelar conta" (digitar CANCELAR) | Grava `cancelado_em` e enfileira o e-mail com o link **na mesma transação**: fila fora → 503 e nada muda. O login passa a ser recusado pela `buscar_credencial` | T-LGPD-02, T-LGPD-05 |
| Link de exportação | `GET /conta/exportacao/arquivo?token=` (pública, 10/min por IP); e-mail montado em `services/notificacoes/src/mensagens.js` | JWT com `finalidade: "exportar-conta"`, vence em `cancelado_em + 30 dias`. Não serve como sessão, e a sessão não serve como link. Fora do log | T-LGPD-04, T-OBS-04 |
| Lista de quem excluir | `orbita.tenants_para_excluir()` (`db/migrations/004_exclusao.sql`) | `SECURITY DEFINER`, dona `orbita_auth`, `EXECUTE` só para `api_contatos`. Devolve **só ids** cancelados há mais de 30 dias | T-RLS-19, T-RLS-21 |
| Job diário | `services/api-contatos/src/exclusao.js` | Agendador do BullMQ com id fixo (`exclusao-diaria`, 3 h, fuso de São Paulo): com 2 réplicas da API, roda uma vez. Para cada id: enfileira o pedido ao worker e, só se conseguiu, apaga `orbita` tabela por tabela com `withTenant`. Fila fora: adia para o dia seguinte, sem apagar nada | T-LGPD-03 |
| Schema `importacao` | `services/importacao/src/worker.js` e `db.js` (`apagarDadosDoTenant`) | O próprio worker apaga, como `importacao_svc`, com o tenant fixado (database-per-service: a API nunca toca esse schema) | T-LGPD-03 |
| Execução manual | `docker compose exec api-contatos node src/excluir-agora.js` (no kind: `kubectl -n orbitati exec deploy/api-contatos -- node src/excluir-agora.js`) | A mesma função do job, com a fila de verdade. Para a demonstração e para o operador | Conferido em 10/11/2026: tenant cancelado há 31 dias, 1 linha em cada tabela dos dois schemas antes, 0 depois |

**Como demonstrar sem esperar 30 dias:** cancelar uma conta pelo Portal, mudar a data como `migrador`
(`UPDATE orbita.tenants SET cancelado_em = now() - interval '31 days'`, com o `app.tenant_id` do tenant fixado,
que é o que o T-LGPD-03 faz pelo `comoDono`) e rodar a execução manual. O link do e-mail passa a responder
"Este link é inválido ou venceu."

**Limitações conhecidas (declaradas, não escondidas):**

- **A exportação não inclui `importacao.erros_linha`.** Esses erros (número da linha e motivo, que pode citar
  o dado da planilha) são do schema do Serviço de Importação, e a API não lê esse schema (regra 10). Incluir
  exigiria uma rota interna do worker só para isso. O tenant ainda tem a própria planilha, que é a origem desses
  dados, e os erros são apagados junto com o resto na exclusão.
- **Os 15 minutos depois do cancelamento.** O token já emitido continua valendo até expirar (sem denylist):
  nesse tempo, quem estava logado ainda pode ler e gravar. O Portal sai da conta logo depois de cancelar.
- **Falha definitiva ao apagar o schema `importacao`.** O pedido tenta 10 vezes (espera exponencial a partir
  de 30 s, cobre horas de indisponibilidade). Se mesmo assim falhar, o worker registra
  `evento: "exclusao_importacao_falhou"` e o job fica 7 dias no Redis para alguém reprocessar à mão: a API já
  apagou `orbita` e não vai pedir de novo.
- **A exportação é montada em memória.** Para o tamanho do produto (até 10 usuários, contatos na casa dos
  milhares) cabe com folga. Um tenant muito maior pediria streaming do JSON.
- **No kind local, o limite de 10/min por IP do link vira global** (todos os clientes chegam com o mesmo IP
  interno): K2 em [`pendencias-bloco-7.md`](pendencias-bloco-7.md). No compose, modelo da VM, o IP real chega.

---

## Medidas de segurança

### Já decididas nesta Etapa

| Medida | Onde está | Protege contra |
|---|---|---|
| **Row-Level Security no PostgreSQL** | [ADR-001](adr/adr-001-tenancy.md) | Vazamento entre tenants — o risco número um do modelo pool |
| **`tenant_id` no JWT assinado, nunca em parâmetro** | [ADR-002](adr/adr-002-identidade-tenant.md) | Acesso cruzado por manipulação de URL |
| **Suíte de isolamento a cada deploy** | [CQ-02](atributos.md#cq-02) | Regressão silenciosa de isolamento |
| **TLS 1.3 em todo tráfego** | Infraestrutura | Interceptação em trânsito |
| **Criptografia em repouso** | Banco e armazenamento de objetos | Acesso físico ao meio |
| **Senha com Argon2id** | API REST | Vazamento de credenciais em caso de dump |
| **Log sem e-mail completo e sem token de link** (bloco 10): `?token=` vira `[oculto]` na API, o nginx registra só o caminho e o worker de e-mail mascara o destinatário (`m***@dominio`) | API, nginx do Portal, Serviço de Notificações (T-OBS-04) | Quem lê o log ganhar um link válido por 24 h ou uma lista de e-mails |
| **Prefixo por tenant no armazenamento** | [C4 nível 2](02-arquitetura-c4.md) | Acesso cruzado a PDFs e anexos |
| **Logs de acesso por 6 meses** | Infraestrutura | Investigação de incidente |
| **Backup com RPO de 15 min** | [CQ-05](atributos.md#cq-05) | Perda de dados — art. 46 exige integridade |

### A implementar até a Etapa 3

> **Revisão de 08/11/2026:** os três itens marcados originalmente para a Etapa 2 não entraram nela (a Etapa 2 priorizou o núcleo multi-tenant) e foram remarcados para o bloco 14, na Etapa 4.
>
> **Revisão de 10/11/2026 (bloco 14):** os três foram feitos. Detalhes em "Como está implementado".

| Medida | Prazo | Estado |
|---|---|---|
| Contrato de operador (DPA) no termo de uso, com instruções de tratamento | Esboço de uma página no bloco 14 (Etapa 4) | ✅ **Esboço feito:** [`dpa-esboco.md`](dpa-esboco.md). Falta a revisão jurídica e entrar no termo de uso antes do primeiro cliente real |
| Exportação self-service pelo Portal Web (o contrato define JSON, seção 9 de [`contrato-api.md`](contrato-api.md)) | Bloco 14 (Etapa 4) | ✅ **Feito:** `GET /conta/exportacao` e o link de 30 dias depois do cancelamento (`rotas/conta.js`); botões em Conta no Portal. T-LGPD-01, 04 e 05, T-ISO-18 |
| Job de exclusão automática 30 dias após cancelamento | Bloco 14 (Etapa 4) | ✅ **Feito:** `orbita.tenants_para_excluir()` (migração 004) + job diário do BullMQ (`exclusao.js`) + worker de importação apagando o próprio schema. T-LGPD-03, T-RLS-19 e 21 |
| Registro de operações de tratamento — art. 37 | Etapa 3 | Pendente |
| Procedimento de resposta a incidente com prazo de comunicação à ANPD | Etapa 3 | Pendente |
| Alerta de dado sensível em campo livre | Etapa 3 | Pendente |
| Relatório de impacto (RIPD) | Etapa 4 | Pendente |

---

## Direitos do titular

O art. 18 dá ao titular direito de confirmação, acesso, correção, anonimização, portabilidade e eliminação. Para o OrbitaTI, **a resposta depende de quem é o titular**:

| Titular | Quem responde | Como o OrbitaTI atende |
|---|---|---|
| **Usuário do tenant** | OrbitaTI, como controlador | Tela de conta: ver, corrigir, exportar e excluir os próprios dados |
| **Contato comercial** | **O tenant**, como controlador | O OrbitaTI encaminha o pedido ao tenant em até 2 dias úteis e fornece as ferramentas — busca, edição, exclusão e exportação — para o tenant cumprir o prazo legal |

Se um contato comercial escrever para o OrbitaTI pedindo exclusão, a resposta não é apagar. É identificar em quais tenants aquele dado existe, comunicar esses tenants e dar a eles a ferramenta. **Apagar por conta própria seria o operador decidindo sobre dado que não é dele** — e ainda destruiria informação do controlador sem autorização.

Esse fluxo precisa estar no termo de uso antes do primeiro cliente real.

---

## Riscos identificados

| # | Risco | Impacto | Probabilidade | Tratamento |
|---|---|---|---|---|
| R1 | Vazamento entre tenants por falha de isolamento | **Crítico** — dado de terceiro exposto, incidente comunicável à ANPD | Baixa | RLS com `FORCE`, suíte CQ-02 a cada deploy, ponto único de acesso ao banco |
| R2 | Dado sensível digitado em campo livre | Alto — tratamento sem base legal adequada | **Média** | Aviso no campo, cláusula contratual, detecção na Etapa 3 |
| R3 | Tenant cadastra contatos sem base legal válida | Alto — mas a responsabilidade é do controlador | Média | Contrato de operador explicitando a obrigação do tenant |
| R4 | Retenção indefinida após cancelamento | Médio — art. 16 exige eliminação após a finalidade | Baixa | Job automático de exclusão em 30 dias (**implementado no bloco 14**, T-LGPD-03) |
| R5 | Vazamento da chave de assinatura do JWT | **Crítico** — permite forjar acesso a qualquer tenant | Baixa | Chave em gerenciador de segredos fora do repositório, rotação semestral |
| R6 | PDF de proposta acessível por URL adivinhável | Alto — expõe dado de contato e valores | Baixa | URL assinada com validade curta; prefixo por tenant; sem listagem pública |

---

## O que muda se o produto crescer

| Cenário | Consequência LGPD |
|---|---|
| Tenant fora do Brasil | Transferência internacional — arts. 33 a 36. Hoje fora de escopo; a infraestrutura fica em região brasileira |
| Integração que envia contato para sistema externo | O tenant passa a compartilhar dado com terceiro; o webhook precisa de registro e o DPA de cláusula específica |
| Enriquecimento automático de contatos | **Mudaria o papel do OrbitaTI para controlador.** Não está no roteiro, e o motivo é este |
| Uso de dados para treinar modelo | Idem — vedado pelo contrato de operador. Não está no roteiro |

---

## Rastreabilidade

| Item | Onde |
|---|---|
| Entidade central e por que o dado é de terceiro | [`01-visao-produto.md`](01-visao-produto.md) |
| Camadas de isolamento | [`02-arquitetura-c4.md`](02-arquitetura-c4.md) |
| Decisão de pool e o risco que ela cria | [`adr/adr-001-tenancy.md`](adr/adr-001-tenancy.md) |
| Isolamento como cenário verificável | [`atributos.md#cq-02`](atributos.md#cq-02) |
| Integridade e recuperação | [`atributos.md#cq-05`](atributos.md#cq-05) |
| Exportação, cancelamento e link (formatos) | [`contrato-api.md`](contrato-api.md), seções 4 e 9 |
| Contrato de operador (esboço) | [`dpa-esboco.md`](dpa-esboco.md) |

**Referência:** BRASIL. Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais.

---

*Documento versionado em `docs/lgpd.md`. Preliminar — aprofundado na Etapa 3.*

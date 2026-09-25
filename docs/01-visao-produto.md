# 1.1 — Visão do Produto: OrbitaTI

**Unidade:** Andriel Schultz e Cristofer
**Disciplina:** Arquitetura de Software SaaS — EC7, SETREM 2026-2
**Etapa 1 — Proposta de arquitetura**

---

## O problema

Profissional de TI que pega trabalho por fora — criação de site, manutenção de servidor, implantação de sistema — vive de indicação. O próximo contrato quase sempre vem de alguém que ele já atendeu, de um colega que repassou um serviço ou de uma conversa que ficou pela metade três meses atrás.

O problema é que esse relacionamento não mora em lugar nenhum. Está espalhado entre a conversa do WhatsApp que rolou tela abaixo, o e-mail perdido na caixa de entrada, o contato salvo como "João Servidor" no celular e uma planilha que parou de ser atualizada em fevereiro. O resultado prático é receita que evapora em silêncio: o orçamento que nunca teve follow-up, o cliente que trocou de fornecedor porque ninguém apareceu em seis meses, a manutenção anual que passou da data.

Os CRMs de mercado não resolvem porque foram desenhados para outro problema. Eles pressupõem time de vendas, meta trimestral, funil com sete estágios e um administrador que configura o processo. O freelancer de TI não tem nada disso — tem uma agenda cheia de trabalho técnico e quinze minutos por semana, na melhor das hipóteses, para pensar em comercial. Ferramenta que exige configuração de trinta minutos antes do primeiro uso já perdeu essa pessoa.

## O que o OrbitaTI é

Um CRM enxuto, multi-tenant, para o profissional de TI que trabalha por conta própria ou em consultorias de até dez pessoas. Ele resolve uma coisa só e resolve bem: manter vivo o relacionamento comercial que gera o próximo contrato.

O nome vem da ideia de que os contatos orbitam o profissional em distâncias diferentes — alguns próximos e ativos, outros distantes e esfriando — e o produto existe para mostrar quem está saindo de órbita antes que se perca.

Três decisões de escopo definem o produto:

**Cadastro em menos de trinta segundos.** Nome, telefone e uma linha de contexto bastam para criar um contato. Todo o resto é opcional. A ferramenta que exige formulário completo não é usada entre um atendimento e outro.

**O produto avisa, o usuário não precisa lembrar.** O valor não está em armazenar contatos — está em apontar quais deles estão esfriando. Um contato sem interação há noventa dias sobe para o topo da lista sozinho.

**Proposta comercial sai do próprio contato.** O ciclo freelancer é curto: conversou, orçou, fechou. Gerar a proposta em PDF a partir dos dados que já estão no sistema elimina o atrito entre a conversa e o orçamento.

Fica explicitamente fora do escopo: automação de marketing, disparo de campanhas em massa, previsão de receita e gestão de equipe de vendas. Esses recursos pertencem a produtos que atendem times comerciais, não profissionais técnicos.

## O cliente fictício

**TechConsult Solutions** — Porto Alegre, RS. Consultoria de TI com seis pessoas, fundada em 2021 por dois ex-funcionários de uma software house. Faturam entre R$ 80 mil e R$ 120 mil por mês prestando serviço de implantação e sustentação de ERP para indústrias e distribuidoras do interior gaúcho.

Hoje a operação comercial deles é uma planilha no Google Drive com 640 linhas, mantida de forma irregular por dois sócios que também atendem cliente. Perderam dois contratos de sustentação em 2025 porque a renovação anual passou em branco — ninguém era dono do acompanhamento. Procuram uma ferramenta que qualquer um dos seis consiga usar sem treinamento, que mostre o que está parado e que não custe o preço de um CRM corporativo.

É o cliente que define o teto do produto: se o OrbitaTI serve bem a TechConsult, serve para todo o mercado abaixo dela.

## Personas de tenant

As duas personas abaixo são a referência de dimensionamento usada em todos os demais artefatos desta Etapa. Os números que aparecem aqui sustentam o ADR de tenancy (1.3) e os cenários de qualidade (1.4).

### Tenant pequeno — DevSolo Sistemas

| Atributo | Valor |
|---|---|
| Perfil | Profissional autônomo, pessoa física com MEI |
| Cidade | Erechim, RS |
| Usuários | 1 |
| Contatos ativos | ~80 |
| Contatos acumulados em 12 meses | ~150 |
| Oportunidades abertas simultâneas | 3 a 5 |
| Plano | Individual — R$ 49/mês |
| Uso típico | Abre o sistema 2 ou 3 vezes por semana, entre atendimentos, quase sempre pelo celular |

Marcelo atende pequenos comércios da região: instala e mantém a rede, cuida dos computadores, faz sites institucionais simples. O trabalho técnico ocupa o dia inteiro. Ele nunca vai configurar um funil de vendas — precisa que o sistema mostre, ao abrir, quem ele deveria procurar esta semana.

**O que faz esse tenant desistir:** qualquer tela que peça mais de três campos obrigatórios; qualquer coisa que não funcione bem no celular.

### Tenant grande — TechConsult Solutions

| Atributo | Valor |
|---|---|
| Perfil | Consultoria de TI, empresa constituída |
| Cidade | Porto Alegre, RS |
| Usuários | 6 (3 consultores, 2 comerciais, 1 gestor) |
| Contatos ativos | ~600 |
| Contatos acumulados em 12 meses | ~1.200 |
| Oportunidades abertas simultâneas | 20 a 30 |
| Plano | Equipe — R$ 249/mês |
| Uso típico | Uso diário por todos os seis; o gestor acompanha o quadro geral semanalmente |

A TechConsult é o tenant que estressa a arquitetura. É ela que importa 500 contatos de uma vez ao migrar a planilha, que gera relatório consolidado, que pede integração com o sistema de faturamento e que tem seis pessoas escrevendo no banco ao mesmo tempo. Todo cenário de qualidade do artefato 1.4 nasce de uma operação dela.

**O que faz esse tenant desistir:** não conseguir separar o que é de cada consultor; lentidão no horário comercial.

## Entidade central

A entidade central do OrbitaTI — a coisa que o produto mais cria, lê e movimenta — é o **Contato Comercial**: a pessoa ou empresa com quem o profissional de TI mantém, ou quer manter, uma relação de negócio.

Tudo no produto orbita essa entidade. A Oportunidade é um Contato com valor e prazo. A Interação é um registro preso a um Contato. A Proposta é um documento gerado a partir de um Contato. Quando este documento fala em "volume do tenant", está falando em número de Contatos.

Essa escolha tem uma consequência que atravessa toda a arquitetura e reaparece no mapeamento LGPD (1.5): o dado mais importante do sistema é **dado pessoal de terceiro**. O contato não é usuário do OrbitaTI, não aceitou nenhum termo de uso e frequentemente não sabe que está cadastrado. Isso coloca o OrbitaTI na posição de operador, e o tenant na de controlador — o que muda quem responde pelo quê.

## Modelo comercial

| Plano | Preço | Usuários | Limites principais |
|---|---|---|---|
| **Individual** | R$ 49/mês | 1 | Histórico de interações de 6 meses; importação até 100 contatos por job; geração manual de até 10 propostas/mês |
| **Equipe** | R$ 249/mês | até 10 | Histórico completo; importação em massa; geração automática de propostas por evento; API REST e webhooks |

Premissa de mix declarada, usada no ADR de tenancy: **45 tenants em 12 meses, 80% no Individual e 20% no Equipe**, resultando em R$ 4.005/mês de receita recorrente. A faixa projetada é de 30 a 50 tenants; 45 é o ponto de trabalho.

## Critério de sucesso do produto

| Métrica | Alvo em 12 meses | Por que essa métrica |
|---|---|---|
| Tenants pagantes | 45 | Sustenta a operação e valida o preço |
| Tempo até o primeiro contato cadastrado | < 5 min do cadastro | Se o tenant não cadastra no primeiro acesso, não volta |
| Onboarding sem intervenção humana | 100% | Self-service é premissa da arquitetura, não meta comercial |
| Contatos reativados por mês | 3+ por tenant ativo | É a promessa do produto — se não acontece, o OrbitaTI não está entregando valor |

---

*Documento versionado em `docs/01-visao-produto.md`. Personas e números reutilizados em `docs/adr/adr-001-tenancy.md` e `docs/atributos.md`.*

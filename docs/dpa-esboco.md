# Contrato de operador de dados (DPA) — esboço

**Unidade:** Andriel Schultz e Cristofer Mateus Rutzen · **Bloco 14 (Etapa 4)** · **Versão:** esboço de 10/11/2026

> Esboço técnico para entrar no termo de uso. **Não é parecer jurídico**: precisa da revisão de um profissional
> da área antes do primeiro cliente real. Cada cláusula aponta para onde a promessa é cumprida no sistema.
>
> **Revisão de 10/11/2026 (Bloco 15):** o que depende de ambiente publicado (TLS, RPO, retenção de logs,
> suboperadores, retenção de backups) está marcado como **compromisso futuro**: a apresentação é local e a VM
> ficou **fora do escopo (D-15.1)** ([`pendencias-bloco-7.md`](pendencias-bloco-7.md), seção 13).

**Partes.** O **Cliente** (a empresa ou o profissional que assina o OrbitaTI) é o **controlador** dos dados dos
contatos que cadastra. O **OrbitaTI** é o **operador** (LGPD, art. 5º, VI e VII; [`lgpd.md`](lgpd.md)).

| # | Cláusula | O OrbitaTI se compromete a | Onde se cumpre |
|---|---|---|---|
| 1 | **Objeto** | Tratar os dados dos contatos **só** para guardá-los, mostrá-los, importá-los e exportá-los a pedido do Cliente | Escopo do produto ([`01-visao-produto.md`](01-visao-produto.md)) |
| 2 | **Instruções do controlador** | Não usar os dados para finalidade própria: nada de treinar modelo, cruzar entre clientes, enriquecer com fonte externa ou prospectar | [`lgpd.md`](lgpd.md), "O que muda se o produto crescer" |
| 3 | **Responsabilidade do Cliente** | — O **Cliente** garante a base legal de cada contato que cadastra e responde pelo que seus usuários escrevem em campos livres (notas), inclusive dado sensível que não deveria estar lá | Risco R2 e R3 de [`lgpd.md`](lgpd.md) |
| 4 | **Confidencialidade e isolamento** | Manter os dados de um Cliente inacessíveis aos outros | Row-Level Security no PostgreSQL ([ADR-001](adr/adr-001-tenancy.md)), tenant só no token assinado ([ADR-002](adr/adr-002-identidade-tenant.md)), suíte de isolamento a cada mudança (CQ-02) |
| 5 | **Segurança** | Senha com Argon2id, tráfego com TLS, backup com RPO de 15 min, log sem e-mail completo nem link de acesso. *Revisão de 10/11/2026:* **cumprido hoje:** Argon2id e o log sem e-mail nem link (T-OBS-04). **Compromisso futuro:** TLS (**fora do escopo, D-15.1**: o nginx local não tem TLS) e o RPO de 15 min (o ensaio do CQ-05 declara que o RPO **não foi provado**; depende do arquivamento de WAL de um banco gerenciado) | [`lgpd.md`](lgpd.md), "Medidas de segurança"; [CQ-05](atributos.md#cq-05), [`ensaios/cq05-2026-11-08.md`](ensaios/cq05-2026-11-08.md) |
| 6 | **Suboperadores** | Informar ao Cliente os suboperadores (hospedagem, provedor de e-mail) e avisar antes de trocar | ~~Lista a definir na VM (pendência N4: provedor de e-mail)~~ Fora do escopo (D-15.1), revisão de 10/11/2026; em produção, definir a lista (hospedagem e provedor de e-mail, N4) antes do primeiro cliente |
| 7 | **Direitos dos titulares** | Encaminhar ao Cliente em até **2 dias úteis** todo pedido de um contato, e dar as ferramentas (busca, edição, exclusão, exportação) para o Cliente responder. **Não apagar por conta própria** | [`lgpd.md`](lgpd.md), "Direitos do titular"; telas de contato e a exportação |
| 8 | **Incidentes** | Comunicar ao Cliente incidente que envolva os dados dele, sem demora indevida, com o que se sabe e o que foi feito | Procedimento na Etapa 3 ([`lgpd.md`](lgpd.md), "A implementar") |
| 9 | **Fim do contrato: devolução** | Depois do cancelamento, manter **30 dias** de acesso à exportação completa (JSON) por um link enviado ao administrador | `POST /conta/cancelamento` e `GET /conta/exportacao/arquivo` ([`contrato-api.md`](contrato-api.md), seções 4 e 9) |
| 10 | **Fim do contrato: eliminação** | Passados os 30 dias, **apagar de forma definitiva** todos os dados do Cliente, de forma automática (sem depender de alguém lembrar). Os backups expiram no ciclo de retenção. Ficam só os logs de acesso exigidos pelo Marco Civil (6 meses), sem o conteúdo | Job diário de exclusão (bloco 14, T-LGPD-03). *Revisão de 10/11/2026:* a eliminação automática está cumprida; a **retenção de 6 meses dos logs é compromisso futuro** (fora do escopo, D-15.1): hoje não há retenção configurada (pino no stdout, compose sem `logging`) |
| 11 | **Transferência internacional** | Manter os dados no Brasil. Mudar isso exige aditivo | [`lgpd.md`](lgpd.md), "O que muda se o produto crescer" |
| 12 | **Auditoria** | Dar ao Cliente, a pedido, a evidência das medidas desta tabela (relatórios de ensaio, resultados da suíte de isolamento) | [`docs/ensaios/`](ensaios/), CI |

**Limitações que o Cliente precisa conhecer.** (a) A exportação não traz os erros de linha das importações:
o Cliente já tem a planilha de origem ([`lgpd.md`](lgpd.md), "Limitações conhecidas"). (b) A cláusula 10 vale
para o banco principal; o prazo de expiração dos backups depende da política de retenção, ~~a definir na VM~~ fora do escopo (D-15.1, revisão de 10/11/2026); em produção, definir a retenção dos backups e declarar o prazo aqui.

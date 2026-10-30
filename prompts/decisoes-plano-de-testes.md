# Decisões sobre o plano de testes (respostas aos pontos levantados)

Atualize docs/plano-de-testes.md e docs/pendencias-bloco-7.md com as decisões abaixo.
Não altere nenhum outro arquivo. O CLAUDE.md já foi atualizado com os itens 2 e 6 — releia-o.

1. As 12 situações de RLS estão listadas no próprio prompts/plano-de-testes.md (cadastro de
   tenant pelo papel da API; SELECT sem WHERE; sessão sem tenant; conexão reaproveitada;
   INSERT com tenant de outro; UPDATE em registro de outro; importacao_svc sem acesso a orbita;
   dono com FORCE; buscar_credencial; api_contatos lendo usuarios sem tenant; upsert sem
   duplicar; e-mail repetido entre tenants). Confira que cada uma tem um T-RLS. O DELETE
   cruzado que você acrescentou fica.
2. /saude: aceito a sua proposta. 200 com {"fila":"fora"} quando só o Redis cai; 503 apenas
   com o banco fora. Acrescente um teste para isso.
3. Rate limit: Redis com skipOnError: true (já está no CLAUDE.md).
4. CQ-01: aceito. No bloco 9 o relatório mostra o p95 das buscas feitas DURANTE as janelas
   de importação, separado do p95 geral. Atualize o caso T-CQ01 correspondente.
5. Casos novos (413, 429 de importações simultâneas, T-ISO-15): aceitos. Ficam no bloco 4
   (413/429) e no bloco 3 (T-ISO-15).
6. Lacuna do CQ-02 (log de auditoria): com RLS a API não distingue "de outro tenant" de
   "inexistente". Decisão: todo 404 em rota com :id gera log evento "recurso_nao_encontrado"
   com tenant_id, rota e id. Crie um caso de teste para isso e registre em
   pendencias-bloco-7.md que o texto do CQ-02 em docs/atributos.md deve ser ajustado.
7. Lacuna do CQ-04: a sonda passa a rodar a cada 15 s por 60 min (240 amostras). Atualize o
   caso de teste e registre a conta.
8. Lacuna do CQ-05: o RPO de 15 min fica declarado como limitação do ensaio local (depende de
   arquivamento de WAL do banco gerenciado). O ensaio prova o procedimento e o RTO.
9. Lacuna do ADR-002 (refresh token e denylist): fora do escopo do semestre. Token de 15 min
   sem refresh; ao expirar, o usuário faz login de novo. Registre em pendencias-bloco-7.md
   que o ADR-002 deve declarar isso como decisão, com gatilho de revisão.

Pronto quando: os dois arquivos refletem as decisões e a seção de lacunas do plano mostra o
que foi resolvido, o que é limitação declarada e o que continua aberto.

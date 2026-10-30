# Pendências para o Bloco 7 — contradições e decisões

**Origem:** leitura do Bloco 0 (29/10/2026), que comparou o `CLAUDE.md` com os documentos de `docs/`.
**Por que este arquivo existe:** a Etapa 2 venceu em 15/10, então o código vem primeiro. As correções de
documentação e o ADR-004 ficam para o Bloco 7, e este arquivo garante que nada se perca até lá.

---

## 1. Decisões tomadas em 29/10/2026

| # | Tema | Decisão | Por quê |
|---|---|---|---|
| D1 | Foco | **Fechar a Etapa 2** (núcleo multi-tenant rodando). A Etapa 3 vem depois | A Etapa 2 venceu em 15/10 |
| D2 | Limite de linhas por importação | **Individual 100 · Equipe 5.000**, **sem** o intervalo de 5 min entre jobs | 5.000 vem de 1 MB ÷ ~200 bytes por linha ≈ 5.242, arredondado para baixo. A proteção do CQ-01 vem do lote de 100, da pausa de 500 ms e da `concurrency: 2` do worker, não de um intervalo entre jobs |
| D3 | E-mail do contato | **Opcional no cadastro manual** (só `nome` é obrigatório). **Obrigatório na importação**: linha sem e-mail vira erro de linha | Cadastro em 30 segundos é requisito do produto. Na importação, o e-mail é a chave que impede contato duplicado (`ON CONFLICT (tenant_id, email)`) |
| D4 | Registro das mudanças | **ADR-004 no Bloco 7**, junto com a correção de C1 a C10 | O código da Etapa 2 tem prioridade |

**Observações sobre D2 para o ADR-004:**
- Os dois limites valem **juntos**: 5.000 linhas **e** 1 MB. Se as linhas tiverem mais de 200 bytes
  (nome, e-mail, telefone, empresa e notas), o limite de 1 MB barra antes das 5.000 linhas.
- A `concurrency: 2` do worker é um número novo. Ele precisa entrar na tabela "Números do projeto" do `CLAUDE.md`.
- O ADR-003 afirma que a TechConsult migra "em ~1 hora" e que 3.000 contatos levam "várias horas". Sem o
  intervalo de 5 min, essas frases deixam de valer e precisam ser refeitas com a conta nova
  (5.000 linhas = 50 lotes × 500 ms ≈ 25 s só de pausa, mais o tempo de gravação).

---

## 2. Contradições a corrigir no Bloco 7

| # | Tema | O que `docs/` diz | O que o `CLAUDE.md` diz | Correção prevista | Arquivos |
|---|---|---|---|---|---|
| C1 | Como o worker grava contatos | O worker faz INSERT direto no banco, sob RLS | O worker não tem GRANT em `orbita`; grava por `POST /interno/importacoes/:id/lotes` com token de serviço | ADR-004: worker → API por HTTP (database-per-service) | `docs/adr/adr-004-*.md` (novo), `adr-003`, `02-arquitetura-c4.md`, `registro-enc11-cristofer.md` |
| C2 | Onde está o CSV | No S3; o job leva só `arquivo_id` | CSV de até 1 MB no payload do job; não há S3 na stack | ADR-004: "S3 adiado, CSV no payload", com a conta de memória do Redis | `adr-003`, `02-arquitetura-c4.md`, `registro-enc11-cristofer.md` |
| C3 | Política de RLS | `current_setting('app.tenant_id')::uuid`, e "sem tenant, não devolve linha nenhuma" | `NULLIF(current_setting('app.tenant_id', true), '')::uuid` | Corrigir o SQL. A versão dos docs **dá erro** sem tenant; ela não devolve vazio | `adr-001`, `02-arquitetura-c4.md`, `atributos.md` (CQ-02), `registro-enc11-cristofer.md` |
| C4 | `SET LOCAL` × `set_config` | `SET LOCAL app.tenant_id = '...'` | `set_config('app.tenant_id', $1, true)` | Nota: `SET LOCAL` não aceita parâmetro e obrigaria concatenar texto (risco de SQL injection) | `adr-001`, `02-arquitetura-c4.md`, `adr-003` |
| C5 | Caminho que ignora o RLS | ADR-002: "não existe caminho privilegiado que contorne o RLS" | `orbita_auth` com BYPASSRLS, dona de `orbita.buscar_credencial`, usada no login | Registrar a exceção única: ela roda só no login, não em toda requisição como na opção B rejeitada | `adr-002` |
| C6 | Limite por importação | 100 por job, para todos os planos, e intervalo de 5 min entre jobs | Individual 100 · Equipe 5.000, sem intervalo | **Decidido (D2), falta documentar** | `adr-003`, `adr-004`, `01-visao-produto.md` |
| C7 | Rate limits | Só a quota de jobs (429 com tempo de espera) | 60 req/min por usuário do plano (60/600), login 10/min, cadastro 60/min | Documentar a conta (600 = 10 usuários × 60) | `adr-003` ou `atributos.md` |
| C8 | Quem lê o progresso da importação | A API lê o schema `importacao` (seta ⑨) | `api_contatos` só tem acesso a `orbita` | Status em `orbita.importacoes`, atualizado pela rota `/interno/.../lotes` | `adr-004`, `registro-enc11-cristofer.md` |
| C9 | E-mail obrigatório | Visão: nome, telefone e contexto bastam | Deduplicação por `(tenant_id, email)` | **Decidido (D3), falta documentar** | `01-visao-produto.md`, `adr-004` |
| C10 | Detalhes menores | README "EC6" × visão "EC7"; "Cristofer" sem sobrenome; enc06 com tabelas em inglês | "Cristofer Mateus Rutzen"; identificadores em português | Corrigir quando passar por perto | `README.md`, `01-visao-produto.md`, demais docs |

---

## 3. Lacunas ainda abertas (decidir quando o bloco correspondente chegar)

- **Contatos:** quais campos existem, tamanhos, e como funciona a busca (`ILIKE`? `pg_trgm`? quantos por página?). É a busca que o CQ-01 mede.
- **Formato do CSV:** colunas e cabeçalho, separador (o Excel brasileiro exporta com `;`), encoding (UTF-8 ou Windows-1252) e onde ficam os erros por linha.
- **Importações simultâneas (2/5):** limite de concorrência por grupo é recurso do **BullMQ Pro** (pago). Proposta: contar no banco, no `POST /importacoes`, e responder 429 acima do limite.
- **Store do rate limit:** memória ou Redis. Em memória, com várias réplicas no kind, o limite fica multiplicado. Em Redis, definir o comportamento quando ele cair.
- **Cadastro de tenant:** campos do payload, confirmação de e-mail (não há Serviço de Notificações na Etapa 2), se devolve token, e se o e-mail do usuário é único em toda a base (o `buscar_credencial(email)` depende disso).
- **Segredos:** nomes das variáveis de ambiente e o conteúdo do `.env.example`.
- **Escopo:** refresh token de 7 dias e denylist em Redis (ADR-002), log de auditoria do 404 (CQ-02), exportação CSV/JSON e job de exclusão em 30 dias (`lgpd.md` marca estes dois para a Etapa 2).
- **`docs/desenho-servicos.jpg`:** citado em três documentos, mas o arquivo não existe no repositório.

# Bloco 13 — Portal Web (identidade OrbitaTI, mobile-first, pronto para VM)

> Substitui a versão anterior do bloco 13. **Pode rodar antes da API existir:** nesse caso o Portal é construído contra um simulador que segue `docs/contrato-api.md` e se liga à API real na Fase 6.

**Objetivo:** criar o Portal Web do OrbitaTI em `web/`. Ele é a única interface do produto. Deve:

- seguir a identidade visual da logo;
- ser pensado primeiro para o celular do Marcelo (DevSolo);
- conversar com a API sem nunca enviar `tenant_id`;
- rodar localmente no Docker Compose;
- estar pronto para ser publicado depois numa VM Linux do LARCC (SETREM) sem retrabalho.

**Leia antes de qualquer coisa:**

- `CLAUDE.md`: regras de multi-tenancy, números do projeto e "como trabalhar".
- `docs/contrato-api.md`: **o contrato HTTP**, com rotas, formatos, erros e `codigo`. O Portal consome exatamente isto.
- `docs/01-visao-produto.md`: personas, "cadastro em 30 s", "o produto avisa" e a metáfora da órbita.
- `docs/atributos.md`: o CQ-01 conta 200 ms de 4G no orçamento; o CQ-04 cobre o Portal no ar.
- `docs/plano-de-testes.md`: caso T-WEB-01.
- `docs/lgpd.md`: o OrbitaTI é operador, e o dado de contato é de terceiro.
- `docs/marca/logo-referencia.jpg`: a logo. Abra a imagem e olhe antes da Fase 1.

**Modo de trabalho:** são 8 fases. Ao fim das Fases 0 e 1, pare e espere minha aprovação. Nas outras, avance em passos pequenos e mostre a saída real dos comandos. Se algo exigir contrariar um ADR, o `CLAUDE.md` ou o contrato, pare e pergunte. Ao fim de cada fase, sugira a mensagem de commit.

---

## Fase 0 — Reconhecimento (não altere nenhum arquivo)

1. **Descubra o modo.** Veja se `services/api-contatos` existe e quais rotas do contrato já estão implementadas.
   - **Modo A (API real):** todas as rotas que as telas usam já existem. Liste cada divergência entre o código e o contrato.
   - **Modo B (simulador):** a API não existe ou está incompleta. O Portal é feito contra o simulador da Fase 2 e se liga à API real na Fase 6. Diga quais rotas faltam.
2. **Releia o contrato** e aponte o que estiver ambíguo para construir as telas: campos, status, códigos. Não invente; pergunte.
3. **Testes.** No modo A, rode `npm test` e mostre a saída; o Portal só começa sobre uma base verde.
4. **Entregue:** o modo escolhido, os riscos e o plano das Fases 1 a 7 com a lista de arquivos que vai criar ou alterar.

**PARE** e espere minha aprovação.

---

## Fase 1 — Design system com a skill ui-ux-pro-max (pare no fim)

1. **Gere o design system.** Carregue a skill `ui-ux-pro-max` e siga o SKILL.md dela. O script fica em `.claude/skills/ui-ux-pro-max/scripts/search.py` dentro do projeto, em `~/.claude/skills/ui-ux-pro-max/scripts/search.py` ou na pasta do plugin. No Windows, use `python` ou `py -3`. Gere com stack `react` e persista dentro de `web/`:
   ```
   python <caminho>/search.py "CRM SaaS para freelancers e pequenas consultorias de TI, mobile-first, tema espacial escuro, brilho neon ciano e azul, confiável, minimalista" --design-system --persist -p "OrbitaTI" --output-dir web
   ```
   - Valide o resultado antes de persistir. Se não combinar, refine a consulta.
   - Consulte também `--domain ux` e `--stack react`.
   - Não use `--force` sem me perguntar.
2. **A marca manda; a skill complementa.** Onde a skill divergir da logo em paleta, fontes ou estilo, vale a logo. Registre cada divergência no `MASTER.md`. Da skill, aproveite os padrões de UX, os anti-padrões, a acessibilidade, o espaçamento, o movimento e o checklist de pré-entrega.
3. **Tokens de partida.** As cores foram extraídas dos pixels da logo e o contraste WCAG já foi conferido. Ajuste um valor só se medir algo melhor.

   **Tema escuro (padrão, porque é a identidade):**

   | Token | Valor | Uso | Contraste |
   |---|---|---|---|
   | `fundo` | `#020A1F`, com brilho radial `#052645` no topo | página | — |
   | `superficie` | `#0B1B30` | cartões, folhas | — |
   | `superficie-elevada` | `#102840` | modal, menu | — |
   | `texto` | `#F1F7FF` | corpo | 18,3:1 no fundo |
   | `texto-secundario` | `#9FB3C8` | rótulos | 8,0:1 na superfície |
   | `texto-mudo` | `#7C93AB` | metadados | 5,4:1 na superfície |
   | `borda-sutil` | `#1E3A5F` | divisórias (só decoração) | — |
   | `borda-campo` | `#4F7099` | contorno de input | 3,4:1 (WCAG 1.4.11) |
   | `ciano` | `#42DEF7` | foco, destaque, link | 12,2:1 |
   | `teal` | `#24E0D1` | começo do anel | 11,9:1 |
   | `azul` | `#307FDC` | fim do gradiente | 4,9:1 |
   | `indigo` | `#4769E5` | só decoração (anel) | 4,1:1 — nunca em texto |
   | `sucesso` / `aviso` / `erro` | `#34D399` / `#FBBF24` / `#F87171` | estados | ≥ 6:1 |

   **Tema claro** (para ler no sol). Liga por `prefers-color-scheme` e também por um alternador manual:

   | Token | Valor | Contraste |
   |---|---|---|
   | `fundo` | `#F4F8FC` | — |
   | `superficie` | `#FFFFFF` | — |
   | `texto` | `#0A1628` | 17:1 |
   | `texto-secundario` | `#46607A` | 6,5:1 |
   | `borda-campo` | `#71879F` | 3,7:1 |
   | `primario` | `#1D5FC0` | 6,1:1 com texto branco |
   | `teal` | `#0B7F78` | — |
   | `aviso` | `#B45309` | — |
   | `erro` | `#B91C1C` | — |
   | `foco` | `#1D5FC0` | — |

   **Regras que vêm dessas medições:**
   - **Botão primário:** gradiente `#42DEF7 → #307FDC` com texto escuro `#020A1F` (contraste mínimo de 4,9:1). Texto branco sobre `#307FDC` dá 4,0:1 e reprova no AA, então não use.
   - **Gradiente do anel** (teal → ciano → azul → índigo): é só decoração. Use na logo, no mapa de órbita e em detalhes, nunca atrás de texto.
   - **Glow:** use só na logo, no foco, no botão primário, no item ativo e no mapa de órbita. Cartões e listas não brilham, e o texto do corpo é sempre nítido.
   - **Cor nunca é o único sinal.** O estado de um contato aparece como cor + ícone + texto.
4. **Tipografia.**
   - Montserrat 700/800 nos títulos e no logotipo. É a família mais próxima do lettering da logo; compare com a imagem e diga se concorda.
   - Inter na interface e no corpo.
   - Fontes auto-hospedadas via `@fontsource`. Nada de Google Fonts ou CDN: a VM do LARCC pode ter saída restrita, e assim não repassamos o IP do usuário a terceiros (LGPD).
   - Corpo com pelo menos 16 px no celular, para o iOS não dar zoom nos campos.
5. **Marca em SVG.** O JPG é só referência e não serve como asset.
   - `web/src/assets/marca/simbolo.svg`: planeta escuro com borda luminosa ciano e dois anéis em gradiente. O anel passa **atrás** do planeta em cima e **na frente** embaixo; desenhe a metade de trás, depois o planeta, depois a metade da frente. Faça o glow com filtro SVG.
   - Logotipo como texto HTML, não como texto dentro de SVG: Montserrat, com "Orbita" em branco e "TI" em gradiente ciano → azul via `background-clip: text`.
   - `favicon.svg` simplificado (sem blur, traços mais grossos, legível em 16 px), `apple-touch-icon` de 180 px, ícones de 192 e 512 px e um `manifest.webmanifest` simples, sem service worker.
   - Variações: só o símbolo, horizontal (símbolo + logotipo) e ícone de app com fundo arredondado, como na imagem.
6. **Amostra visual.** Crie a rota `/marca` (só em desenvolvimento, via `import.meta.env.DEV`). Ela mostra, nos dois temas:
   - a logo nas variações;
   - tokens e tipografia;
   - botões em todos os estados e campos com erro;
   - cartão de contato, toast e o mapa de órbita.

   Tire capturas com o Playwright em 375 px e 1440 px, nos dois temas. Compare com `docs/marca/logo-referencia.jpg` e me mostre.

**PARE:** espere eu aprovar a direção visual antes da Fase 2.

---

## Fase 2 — Fundação técnica e simulador

**Decisões já tomadas.** Se discordar de alguma, argumente no plano da Fase 0.

- **Stack:** `web/` com Vite, React e JavaScript (sem TypeScript, como o resto do projeto) e React Router em modo SPA.
- **Estilo:** Tailwind CSS v4 (`@tailwindcss/vite`), lendo os tokens de `web/src/estilos/tokens.css` como variáveis CSS. Os tokens são a única fonte de cor, espaço e raio.
- **Ícones:** `lucide-react`, um estilo só. Nunca use emoji como ícone.
- **Sem biblioteca** de estado nem de formulário: `fetch` e hooks pequenos.
- **Exceção ao "sem etapa de build" do `CLAUDE.md`:** vale só para `web/`. O build roda dentro do Docker (multi-stage), e os serviços Node continuam sem build.
- **Pacote independente:** `web/` tem `package-lock` próprio e fica **fora** dos workspaces da raiz. Garanta que o Vitest da raiz ignore `web/**`; senão ele pega os testes do Playwright e o `npm test` quebra.
- **Versões:** use as estáveis atuais, fixadas no lockfile.

1. **Cliente HTTP único** (`web/src/api/cliente.js`). Todo acesso à API passa por ele.
   - **URL:** base relativa `/api`. Nunca fixe host nem porta: o mesmo build serve simulador, compose, kind e VM.
   - **Token:** injeta `Authorization: Bearer`. O token nunca vai para URL nem para log.
   - **Trava do ADR-002 no cliente:** em desenvolvimento, lança erro se algum caminho, query ou corpo tiver uma chave contendo "tenant".
   - **Erros:** decide pelo `codigo` do formato de erro do contrato, nunca comparando texto. Usa o `erro` como mensagem, a não ser que a tela tenha um texto melhor (tabela da Fase 3).
   - **Sessão expirada:** `NAO_AUTENTICADO` limpa a sessão e leva para `/entrar?sessao=expirada&voltar=<rota atual>`. A rota vai na URL, não no storage (só o token fica no `sessionStorage`). `voltar` só é aceito se começar com "/" e não com "//"; senão vai para `/contatos`.
   - **Rastreio:** lê o `x-request-id` da resposta e mostra no toast de erro inesperado ("código: …"), para eu achar a requisição no log.
   - **Cancelamento:** usa `AbortController`, e uma busca nova cancela a anterior.
2. **Sessão.**
   - O token fica em `sessionStorage`.
   - O Portal decodifica o token, sem verificar a assinatura, só para ler `plano`, `papel` e `exp`. Se `exp` já passou ao abrir, vai direto para o login.
   - O token dura 15 min e não tem refresh (decisão registrada): quando expira, o usuário entra de novo.
   - Sair é apagar o token.
3. **Casca da aplicação.**
   - Celular (< 1024 px): barra inferior (Contatos, Importar, Conta) e botão flutuante "+" para novo contato, ao alcance do polegar e respeitando a safe-area.
   - Desktop (≥ 1024 px): barra lateral.
   - Breakpoints: 375, 768, 1024 e 1440.
   - Code splitting por rota, com `React.lazy`.
4. **Simulador do contrato** (`web/simulador/`): um servidor Fastify em memória, na porta 3001, que implementa `docs/contrato-api.md`. Siga o contrato à risca: rotas, corpos, status e `{erro, codigo}`.
   - **Multi-tenant de verdade:** gera JWT HS256 com segredo fixo de desenvolvimento e `tenant_id` nos claims, e filtra tudo pelo tenant do token. Recurso de outro tenant responde 404.
   - **Importação:** lê o cabeçalho e conta as linhas como no contrato. Avança um lote a cada 500 ms, para o Portal ver o progresso de verdade.
   - **Cenários de falha por variável de ambiente:** `SIM_FILA=fora` responde 503 `FILA_INDISPONIVEL`; `SIM_LIMITE_RPM=5` faz o rate limit estourar rápido.
   - **Dados iniciais:** os dois tenants de demonstração do bloco 3 (DevSolo e TechConsult, senha `Demo@2026`), com contatos frios variados para o mapa de órbita ter o que mostrar.
   - **Só para desenvolvimento e testes.** Nunca entra na imagem Docker nem roda em produção. O simulador não é um segundo backend: nada de banco, nada de regra que não esteja no contrato.
5. **Desenvolvimento:** `vite.config.js` com proxy de `/api` para `API_ALVO` (padrão `http://localhost:3000`), removendo o `/api`.
   - `npm run dev` usa a API real.
   - `npm run dev:sim` sobe o simulador e o Vite apontando para `http://localhost:3001`.

**Pronto quando:** `npm run dev:sim` abre o Portal com a casca, o login funciona contra o simulador, a trava do "tenant" está ativa e os unitários do cliente HTTP passam.

---

## Fase 3 — Telas

**Tom das mensagens:** português simples, como quem fala com o Marcelo. As palavras "tenant", "JWT" e "payload" nunca aparecem na tela. Use a metáfora da órbita com parcimônia: no "Saindo de órbita" e no mapa. No resto, linguagem direta.

1. **Entrar, Criar conta e Confirmar e-mail**
   - **Cadastro:** campos empresa, nome, e-mail e senha (com mostrar/ocultar; mínimo de 8 caracteres, conforme o contrato). O plano aparece em cartões selecionáveis, montados a partir de `GET /planos` (pública): nome, preço, usuários, linhas por importação e importações simultâneas. Nada de recurso que ainda não existe (propostas, webhooks, histórico). Use o `autocomplete` certo em cada campo: `organization`, `name`, `email`, `new-password` e `current-password`.
   - **Login:** um só erro, "E-mail ou senha incorretos." A API não revela qual campo errou, e o Portal também não.
   - **Depois do cadastro,** vai direto para Contatos, com o estado vazio guiando o primeiro cadastro. A meta do produto é o primeiro contato em menos de 5 min.
   - **`/confirmar-email?token=`:** chama `GET /auth/confirmar` e mostra "E-mail confirmado" ou "Este link é inválido ou venceu". É a tela para onde aponta o link do e-mail do bloco 10.
2. **Contatos (tela inicial)**
   - **"Saindo de órbita" no topo:** `GET /contatos/esfriando?limite=5`. O elemento-assinatura é um **mapa de órbita em SVG**:
     - você no centro (o planeta da logo) e anéis concêntricos ao redor;
     - cada contato frio é um ponto, mais longe quanto maior o `dias_sem_interacao`: 90 dias no anel interno, 365 ou mais no externo;
     - tocar no ponto abre o contato.

     A lista ao lado ou abaixo é o conteúdo principal e acessível: nome, empresa e "há N dias sem contato" (ou "cadastrado há N dias, nunca contatado", quando `nunca_contatado`). O SVG complementa, com `role="img"` e uma descrição. O mapa é **estático**, com ou sem `prefers-reduced-motion` (decisão de 07/11/2026: a rotação lenta que existia era movimento automático de mais de 5 s sem botão de pausa, o que não atende a WCAG 2.2.2, e gastava bateria no celular).
   - **Busca:** debounce de 300 ms e cancelamento da busca anterior. Isso protege o rate limit e o banco; é a busca que o CQ-01 mede. Se vierem `limite` itens, mostre "mostrando os primeiros {limite} — refine a busca".
   - **"Novo contato" em menos de 30 s:** uma folha ou modal com só três campos:
     - Nome: obrigatório, com foco automático;
     - Telefone: `inputmode="tel"`;
     - Observação: "uma linha de contexto".

     E-mail e empresa ficam em "mais campos", recolhido. Enter salva, e o contato aparece na lista sem recarregar.
   - **Estados:** carregando (skeleton), vazio no primeiro uso ("Cadastre seu primeiro contato" + "ou importe sua planilha"), busca sem resultado e erro com "tentar de novo".
3. **Contato**
   - **Dados editáveis,** com feedback ao salvar. `EMAIL_DUPLICADO` aparece no próprio campo de e-mail.
   - **Estágio:** lead, proposta, cliente ou perdido, num seletor segmentado.
   - **Ações rápidas,** só quando o dado existir: Ligar (`tel:`), WhatsApp (`https://wa.me/` só com dígitos, prefixando 55 quando vier sem DDI) e E-mail (`mailto:`).
   - **Histórico de interações:** linha do tempo, da mais recente para a mais antiga, com ícone por tipo.
   - **Nova interação:** tipo, nota e data/hora (padrão: agora; o seletor não deixa escolher data futura). Ao salvar, use o `contato` que volta na resposta para atualizar a "última interação". Não recalcule a regra no Portal.
   - **Excluir** pede confirmação e avisa que o histórico vai junto.
   - **`NAO_ENCONTRADO`:** "Não encontramos esse contato." Nunca sugira que ele existe em outra conta (CQ-02).
4. **Importar CSV**
   - **Envio do arquivo:** área de soltar arquivo mais um botão; no celular, abre o seletor de arquivos.
   - **Modelo e limites:** link "baixar modelo" para `web/public/modelo-contatos.csv`, com o cabeçalho do contrato e separador ";". Os limites do plano vêm de `GET /planos` (o plano atual é escolhido pelo claim `plano` do token); nenhum número fixo no Portal.
   - **Requisição:** `POST /api/importacoes` com `Content-Type: text/csv` e o arquivo como corpo.
   - **Progresso:**
     - enquanto está `na_fila`, mostre "Na fila…" com indicador indeterminado (`total_lotes` ainda é `null`);
     - depois, uma barra com `lotes_aplicados / total_lotes`, consultando `GET /importacoes/:id` a cada 2 s até `concluida` ou `falhou`.

     Pare de consultar ao sair da tela, pause com a aba oculta (`visibilitychange`) e respeite o `Retry-After` de um 429. Por quê: no plano Individual o limite é de 60 req/min, e só o polling de 2 s já gasta 30 por minuto.
   - **Resultado:** "{total_linhas − linhas_invalidas} contatos importados, {linhas_invalidas} linhas com erro", com um link para os contatos. O detalhe de cada linha não aparece: ele fica no schema `importacao`, que a API não lê (regra 10).
5. **Conta**
   - Sempre mostra o plano atual, os limites (de `GET /planos`, escolhido pelo claim `plano`), o alternador de tema e o botão Sair (fora do bloco de preferências). "Requisições por minuto" não aparece: é proteção técnica, não vantagem do plano.
   - Só para o papel admin: "Exportar meus dados" (download) e "Cancelar conta", com confirmação digitando CANCELAR. (Mudança decidida na Fase 3: o texto original pedia o nome da empresa, mas o Portal não o conhece; ele não está no token e nenhuma rota do contrato o devolve. Digitar uma palavra fixa é o padrão de GitHub e Vercel e cumpre o objetivo: evitar o clique por engano.) Depois de cancelar, sai da conta na hora. O simulador implementa as duas rotas. Se a API real responder 404 nelas, mostre "Essa função ainda não está disponível." (pelo contrato essas rotas nunca devolvem 404, então 404 ali só significa que o bloco 14 ainda não existe). Nada de flag nem requisição de teste.

**Mensagens por `codigo`.** Use o `erro` da API, menos onde esta tabela pede um texto específico da tela.

| `codigo` | Onde | Mensagem na tela |
|---|---|---|
| `CREDENCIAIS_INVALIDAS` | login | E-mail ou senha incorretos. |
| `NAO_AUTENTICADO` | qualquer | Sua sessão expirou. Entre de novo. (e volta para onde estava) |
| `NAO_ENCONTRADO` | contato | Não encontramos esse contato. |
| `EMAIL_DUPLICADO` | contato | Já existe um contato com esse e-mail. (no campo) |
| `EMAIL_JA_CADASTRADO` | cadastro | Esse e-mail já tem conta. Quer entrar? (com link) |
| `ARQUIVO_GRANDE` | importar | O arquivo passa de 1 MB. Divida a planilha em partes menores. |
| `CSV_SEM_COLUNAS` | importar | A primeira linha precisa ter as colunas nome e email. Baixe o modelo. |
| `LINHAS_ACIMA_DO_PLANO` | importar | Seu plano permite até {limite} linhas; o arquivo tem {linhas}. |
| `IMPORTACOES_SIMULTANEAS` | importar | Você já tem importações em andamento. Aguarde uma terminar. |
| `LIMITE_REQUISICOES` | login | Muitas tentativas. Aguarde um minuto. |
| `LIMITE_REQUISICOES` | outras telas | Muitas ações seguidas. Tente de novo em {Retry-After} s. |
| `FILA_INDISPONIVEL` | importar | (texto da API) Importação indisponível no momento. O restante do sistema segue funcionando. |
| rede ou `ERRO_INTERNO` | qualquer | Não conseguimos falar com o servidor. Tente de novo. (código: x-request-id) |

**Acessibilidade e UX (não negociáveis):**

- **Base:** `lang="pt-BR"` e WCAG 2.2 AA.
- **Foco visível:** anel ciano de 2 px com offset. Navegação completa por teclado.
- **Toque:** alvos de pelo menos 44×44 px, com 8 px ou mais entre eles; `cursor-pointer` em tudo que é clicável.
- **Formulários:** todo campo tem label visível (placeholder não é label), e o erro de `campos` fica ligado ao campo certo por `aria-describedby`.
- **Leitor de tela:** toasts e progresso em `aria-live`; ícone decorativo com `aria-hidden`; botão só de ícone com `aria-label`.
- **Movimento:** `prefers-reduced-motion` desliga as animações de glow e da órbita.
- **Estabilidade:** reserve espaço para o layout não pular ao carregar. Botões mostram estado de carregamento e não aceitam envio duplo.

**Compatibilidade com a VM.** O mesmo build precisa rodar em `http://<ip-da-vm>`, sem HTTPS.

- **Nada de APIs que exigem contexto seguro:** `crypto.randomUUID`, `navigator.clipboard` e service worker não existem em `http://IP` e quebram a tela.
- **Nada de CDN em tempo de execução:** fontes, ícones e scripts vão todos no bundle.
- **Nada fixo de endereço:** nenhum host, porta ou "localhost" no código do Portal.

**LGPD:**

- Sem analytics, sem rastreadores, sem scripts de terceiros.
- Nenhum dado de contato em `localStorage` ou `sessionStorage`; só o token.
- Nenhum dado de contato no console do navegador.

---

## Fase 4 — Empacotamento (Nginx + Docker)

1. **Nginx** (imagem `nginxinc/nginx-unprivileged`, alpine, não-root, porta 8080):
   - **SPA:** serve o build com fallback (`try_files $uri /index.html`).
   - **Proxy:** `location /api/` aponta para `${API_UPSTREAM}` (padrão `api-contatos:3000`) e remove o prefixo `/api`. Use os templates do nginx (envsubst) para o upstream vir de variável de ambiente.
   - **Bloqueio:** `location /api/interno/` responde 404. As rotas internas exigem token de serviço; isto é uma camada a mais.
   - **Cabeçalhos repassados:** `X-Forwarded-For`, `X-Real-IP` e `X-Request-Id`. Se o cliente não mandar um id, use o `$request_id` do próprio nginx, via `map`. A API usa o `X-Forwarded-For` graças ao `trustProxy` do bloco 5; sem ele, o rate limit de login e o de cadastro contariam todos os usuários como um IP só.
   - **Tamanho do corpo:** `client_max_body_size 2m`. Assim quem responde o 413 é a API (1 MB), em JSON com `ARQUIVO_GRANDE`. Com o padrão do nginx (1m), quem responderia seria o nginx, em HTML.
   - **Cache:** gzip ligado; assets com hash em cache de 1 ano, `immutable`; `index.html` com `no-cache`.
   - **Cabeçalhos de segurança:**
     - `Content-Security-Policy: default-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
     - `X-Content-Type-Options: nosniff`
     - `Referrer-Policy: no-referrer`
     - `Permissions-Policy` mínima
     - Sem HSTS, porque o Portal pode rodar em HTTP. Confira no console do navegador que nenhuma regra da CSP é violada.
   - **Healthcheck:** `GET /healthz` responde 200.
2. **Dockerfile multi-stage:** build em `node:22-alpine`, execução em `nginx-unprivileged`. O simulador fica fora da imagem. Arquivos `.conf` e `.sh` com fim de linha LF.
3. **Teste da imagem contra o simulador** (vale nos dois modos):
   ```
   docker build -t orbitati/web:0.1.0 web
   docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3001 orbitati/web:0.1.0
   ```
   Com o simulador rodando, `http://localhost:8080` precisa funcionar inteiro.
4. **Modo A:** acrescente já o serviço `web` no compose (detalhes na Fase 6). **Modo B:** deixe isso para a Fase 6.

**Pronto quando:**

- a imagem sobe;
- `curl.exe -s http://localhost:8080/api/saude` responde através do nginx;
- `curl.exe -s -o NUL -w "%{http_code}" http://localhost:8080/api/interno/x` devolve 404;
- `curl.exe -sI http://localhost:8080` mostra os cabeçalhos de segurança.

---

## Fase 5 — Qualidade

1. **E2E com Playwright** em `web/e2e/`. A URL vem de `E2E_URL` (padrão `http://localhost:8080`), para a mesma suíte rodar contra o simulador agora e contra a stack real na Fase 6. Rode com `npm run test:e2e` e instale só o Chromium (`npx playwright install chromium`).
   - **Fluxo principal:** cadastrar → criar contato só com nome → registrar interação → importar CSV de 50 linhas com 2 inválidas → ver "48 contatos importados, 2 linhas com erro".
   - **T-WEB-01 automatizado:** intercepte as requisições do fluxo inteiro e falhe se alguma URL, query ou corpo contiver "tenant".
   - **Sessão:** token expirado ou adulterado volta para `/entrar` com a mensagem de sessão expirada.
   - **Isolamento visto pela tela:** o usuário de B abre `/contatos/<id de A>` e vê "Não encontramos esse contato".
   - **Erros de importação:** arquivo maior que 1 MB, CSV sem a coluna email e importação com a fila fora mostram as mensagens da tabela da Fase 3.

   Use e-mails únicos por execução, como os testes da raiz.
2. **Unitários com Vitest em `web/`,** isolados da raiz:
   - cliente HTTP: decisão por `codigo`, `NAO_AUTENTICADO` → logout e trava do "tenant";
   - cálculo da posição dos pontos no mapa de órbita.
3. **Capturas com Playwright:** todas as telas, em 375, 768, 1024 e 1440 px, nos temas claro e escuro, salvas em `web/e2e/capturas/`. Coloque essa pasta no `.gitignore`, junto com `playwright-report/` e `test-results/`. Olhe cada captura e corrija o que estiver quebrado: texto cortado, rolagem horizontal, sobreposição, contraste.
4. **Lighthouse mobile** (aba do F12 ou `npx lighthouse`) em `/entrar` e `/contatos`:
   - metas: Acessibilidade ≥ 95, Boas práticas ≥ 95, Desempenho ≥ 90;
   - orçamento: JS inicial ≤ 170 KB gzip (mostre a saída do `vite build`).

   Se alguma meta não bater, diga por quê e o que mudaria. Não esconda.
5. **Checklist da skill:** rode o checklist de pré-entrega da `ui-ux-pro-max` e mostre item por item (ok / falhou / não se aplica).

---

## Fase 6 — Integração com a API real (só quando os blocos 2, 4 e 12 existirem)

1. **Contrato contra código.** Rode a suíte E2E contra a stack real. Para cada divergência entre a API e o contrato, me diga qual lado está errado antes de corrigir. Se o certo for mudar o contrato, atualize `docs/contrato-api.md` e o simulador juntos.
2. **Serviço `web` no compose:** porta `"${WEB_PORTA:-8080}:8080"`, depende do `api-contatos` saudável, healthcheck em `/healthz`. Acrescente `WEB_PORTA` ao `.env.example`.
3. **Confirme o que o bloco 5 fez:** `trustProxy` ativo e, via nginx, o IP registrado no log é o do cliente, não o do nginx. Confirme também que a porta 3000 da API está publicada só em `127.0.0.1` (bloco 2): na VM, só o `web` fica exposto.
4. **kind** (se o bloco 6 existir):
   - Antes de mudar, liste o que vai quebrar: seed, scripts de demo e testes que usam a porta 30080 direto. Ajuste tudo junto.
   - Crie Deployment e Service `web` com o NodePort 30080; o `api-contatos` passa a ser ClusterIP.
   - Imagem `orbitati/web:0.1.0` com `imagePullPolicy: IfNotPresent`, carregada com `kind load docker-image --name saas`.
   - O `deploy-kind.ps1` passa a buildar e carregar o `web`, e os scripts de demo passam a aceitar `-BaseUrl http://localhost:30080/api`.

**Pronto quando:**

- `docker compose up -d --build --wait` sobe com o `web` saudável;
- `npm test` (raiz) e `npm run test:e2e` (em `web/`, com `$env:E2E_URL="http://localhost:8080"` no PowerShell) passam contra a stack real;
- no kind, `http://localhost:30080` abre o Portal e `.\scripts\demo-isolamento.ps1 -BaseUrl http://localhost:30080/api` roda até o fim.

---

## Fase 7 — Documentação

1. **`CLAUDE.md`:** Stack (o `web/` e a exceção de build), Estrutura (`web/` e `web/simulador/`), Comandos (`npm run dev`, `npm run dev:sim`, `npm run test:e2e`, URL `http://localhost:8080`) e as variáveis novas.
2. **`README.md`:** como rodar o Portal (com o simulador, em modo dev e pelo compose) e como rodar os E2E.
3. **`docs/plano-de-testes.md`:** o T-WEB-01 passa de "ensaio manual" para automatizado, apontando o arquivo. Acrescente os casos novos como T-WEB-02, T-WEB-03 e assim por diante.
4. **`docs/02-arquitetura-c4.md`:** na seção de estado atual, Portal Web implementado (Nginx servindo a SPA e fazendo proxy de `/api`, mesma origem, sem CORS).
5. **`web/design-system/orbitati/MASTER.md`:** atualizado com o que foi de fato implementado.
6. **Pendências para a VM do LARCC:** no fim, uma lista curta, sem implementar nada:
   - HTTPS (proxy do laboratório ou certificado próprio);
   - os scripts `.ps1` precisam de versão bash ou `pwsh`;
   - backup;
   - expor só a porta do `web` e configurar firewall;
   - `PORTAL_URL` com o endereço público;
   - quem tem acesso à VM.

---

## Não faça

- Nada que envie `tenant_id`, em lugar nenhum.
- Nenhum número de plano fixo no Portal (eles vêm de `GET /planos`).
- Nenhuma rota, campo ou regra no simulador que não esteja no contrato.
- Nenhuma dependência de CDN ou serviço externo em tempo de execução.
- Nenhuma mudança em `services/` ou `db/` neste bloco: o backend segue os blocos 2, 4, 5, 10, 12 e 14. Se faltar algo, pare e me diga.
- `git push`, nem `docker compose down -v` sem perguntar.

## Pronto quando (mostre a saída real)

- `npm run test:e2e` passa contra o simulador (modo B) ou contra a stack real (modo A ou depois da Fase 6).
- No navegador com o celular simulado (F12 → modo dispositivo, 375 px), dá para cadastrar, criar um contato em menos de 30 s, registrar uma interação, importar um CSV e ver o progresso.
- As capturas nos 4 tamanhos × 2 temas foram revisadas.
- O Lighthouse e o checklist da skill foram reportados com números.
- `npm test` da raiz continua verde, se a API já existir.

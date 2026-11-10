# Portal Web: pendências (bloco 13)

**Estado em 09/11/2026: as 8 fases do bloco 13 estão feitas.** A Fase 6 ligou o Portal na API real.
Sobra só a lista da seção 2 (VM do LARCC), que não é deste bloco.

Resultado da Fase 6 (detalhes de cada item abaixo):

| Verificação | Compose (8080) | kind (30080) |
|---|---|---|
| `npm run test:e2e` contra a API real | 33/33 | 33/33 |
| Divergências entre API e contrato encontradas pelos E2E | nenhuma | nenhuma |
| `npm run capturas` (64 telas, conta do seed) | 64/64, nenhuma com 429 | — |
| Lighthouse mobile | 92–98 / 100 / 100 ([ensaio](ensaios/portal-lighthouse-2026-11-09.md)) | — |
| `demo-isolamento.ps1 -BaseUrl .../api` | — | isolamento OK |
| Deploy sem parada (`rollout restart deployment/web`) | — | [ensaio T-CQ04-02](ensaios/cq04-02-web-2026-11-09.md) |
| `npm test` da raiz (com `TESTES_LENTOS=1`) | 258/258 | — |
| Unitários do Portal | 42/42 | — |

## 1. Fase 6: integração com a API real (feita em 09/11/2026)

Detalhes em `prompts/bloco-13.md`, Fase 6. Abaixo, o texto original de cada item e, em **Feito**, o que
foi feito e medido.

**Feito, em resumo:**

1. **Contrato contra código:** os 33 E2E passaram contra a API real sem mudar nada, nem no contrato, nem no
   simulador, nem na API. As rotas `/conta/*` (bloco 14) respondem 404 `NAO_ENCONTRADO`, e o Portal mostra
   "Essa função ainda não está disponível." (item 7).
2. **Serviço `web` no compose**, com `WEB_PORTA` no `.env.example`. Achado: o `tmpfs` do `/etc/nginx/conf.d`
   precisa de `uid=101`. Sem isso, o entrypoint só registra "conf.d is not writable", e o nginx sobe **sem
   nenhum server** (o contêiner fica de pé e não escuta a 8080). O healthcheck pegou.
3. **Resolver:** `API_RESOLVER` (`web/nginx/16-api-resolver.envsh`) usa o `NGINX_LOCAL_RESOLVERS` que a
   imagem 1.28 já lê do `/etc/resolv.conf` (`NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1`). Valores medidos:
   `127.0.0.11` no compose e `192.168.127.7` no `docker run` da rede padrão; no kind, o kube-dns.
   - Com o upstream em variável, o `/api` sai por `rewrite` (com variável, o `proxy_pass http://$x/` não
     troca só o prefixo).
   - O log usa `$caminho` (o `$request_uri` sem a query), porque o `$uri` perderia o `/api` depois do rewrite.
   - No kind, o `API_UPSTREAM` usa o nome completo: o `resolver` do nginx não usa o `search`.
   - **Teste:** a API foi recriada com outro IP (`.6` → `.9`), e `/api/saude` voltou a responder 200 sem
     reiniciar o `web`.
4. **Capturas na stack real:** 64/64, com o seed do bloco 12 (3 itens no "Saindo de órbita"; ver a limitação
   abaixo). A conta DevSolo (Individual, 60 req/min) recebe 49 chamadas contadas por execução. A captura que
   recebe 429 espera o `Retry-After` e é refeita. Provado esgotando a cota antes: uma captura recebeu 429,
   esperou 40 s, foi refeita e nenhuma saiu com tela de erro. Nenhum limite foi subido.
5. **Fila fora de verdade:** com o Redis parado, `POST /api/importacoes` pelo nginx devolveu 503 com o corpo
   idêntico ao que o E2E simula e ao contrato. `/api/saude` mostrou `fila: fora`, e a lista de contatos seguiu 200.
6. **Bloco 5 confirmado no compose:** a API registra o IP do cliente (`172.20.0.1`), e não o do nginx
   (`172.20.0.8`). Um `X-Forwarded-For` forjado é ignorado, e a 3000 só existe em `127.0.0.1`.
7. **`/conta/*`:** 404 na API real, como previsto. Conferir de novo quando o bloco 14 existir.
8. **kind:** `deploy/k8s/70-web.yaml` (2 réplicas, NodePort 30080, `preStop: sleep 5`, probes em `/healthz`,
   raiz só leitura); `api-contatos` como ClusterIP com `TRUST_PROXY_SALTOS=1` (J6); `deploy-kind.ps1` faz o
   build, o `kind load` e o apply do `web`, nessa ordem depois da API; seed, sonda e demos em `.../30080/api`.
   - **N1 fechada:** o link do e-mail no kind abre o Portal e confirma.
   - **K2 continua no kind local:** `externalTrafficPolicy: Local` foi medido e não trouxe o IP real
     (`docs/pendencias-bloco-7.md`, K2).
9. **Lighthouse na stack real:** [ensaio de 09/11](ensaios/portal-lighthouse-2026-11-09.md), todas as metas
   batidas.

Também na Fase 6: **N5 fechada** (`error_log` em `crit`, `upstream=` no `access_log`) e os **E2E contra a API
real no CI** (job `api`).

Texto original dos itens, como registro:

1. **Contrato contra código.** Rodar `npm run test:e2e` (em `web/`) contra a stack real. Para cada
   divergência entre a API e o `docs/contrato-api.md`, decidir qual lado está errado antes de corrigir.
   Se o certo for mudar o contrato, mudar o contrato e o simulador juntos.
2. **Serviço `web` no compose:**
   - porta `"${WEB_PORTA:-8080}:8080"`;
   - `depends_on` do `api-contatos` saudável;
   - healthcheck em `/healthz`;
   - `WEB_PORTA` no `.env.example`.
3. **Resolver do nginx configurável por variável.**
   - **Problema hoje:** o `proxy_pass http://${API_UPSTREAM}/` resolve o nome da API **uma vez**, quando
     o nginx sobe. Se o contêiner da API for recriado com outro IP, o Portal responde 502 até alguém
     reiniciar o `web`. E se o nome não existir na subida, o nginx nem sobe.
   - **Correção:** `resolver` + upstream numa variável do nginx, para ele resolver o nome de novo a cada
     poucos segundos.
   - **O endereço do DNS muda conforme o ambiente**, por isso precisa vir de variável e não pode ficar fixo:

     | Ambiente | DNS |
     |---|---|
     | compose | `127.0.0.11`, o DNS embutido do Docker. Só existe em redes criadas pelo compose ou pelo usuário |
     | kind | DNS do cluster (ClusterIP do `kube-dns` em `kube-system`); `127.0.0.11` não existe lá |
     | `docker run` na rede padrão | não há DNS embutido; vale o do `/etc/resolv.conf` do contêiner |
   - **Proposta:** variável `API_RESOLVER`. Sem valor, ela usa o `nameserver` do `/etc/resolv.conf`, que já
     está certo nos três ambientes. Isso pode ser feito com um script em `/docker-entrypoint.d/`; a imagem
     oficial do nginx tem um mecanismo parecido (`NGINX_ENTRYPOINT_LOCAL_RESOLVERS`), a conferir na versão
     1.28. Atenção: o filtro `NGINX_ENVSUBST_FILTER=^API_` do Dockerfile precisa deixar a variável passar.
   - **Teste:** recriar o contêiner da API com o `web` no ar e conferir que `/api/saude` volta sem
     reiniciar o `web`.
4. **As capturas e o Lighthouse na stack real dependem do seed do bloco 3.**
   - `npm run capturas` e `npm run lighthouse` entram com a conta de demonstração `marcelo@devsolo.dev`
     (senha `Demo@2026`) e esperam contatos frios para o "Saindo de órbita".
   - Sem o seed, o login falha e a suíte de capturas para no primeiro teste.
   - Alternativa: `E2E_DEMO_EMAIL` e `E2E_DEMO_SENHA` apontando para uma conta com dados.
   - Os demais E2E criam as próprias empresas e não dependem de seed.
   - **Resolvido no bloco 12 (09/11/2026): o seed alimenta o "Saindo de órbita".**
     - O seed registra interações com `ocorrida_em` no passado, com os mesmos estágios e dias de
       `web/simulador/dados.js` (contrato 1.5: `ocorrida_em` retroativo é permitido; só o futuro é recusado).
     - DevSolo: João Servidor (412 dias), Ana Ribeiro (241) e Rafael Gomes (96) aparecem no "esfriando";
       Patrícia Lopes (20) não. TechConsult: 16 interações, de 2 a 400 dias.
     - Idempotente pela nota da interação do seed; respeita os 60 req/min do plano Individual (~20
       requisições por execução, e espera o `Retry-After` se vier 429).
   - **Limitação aceita: a API real não terá o contato frio "nunca contatado".**
     - A API grava `criado_em = agora`, e o seed passa pela API (sem SQL privilegiado). Então um contato sem
       interação fica recém-criado para o "esfriando" e só aparece depois de 90 dias.
     - No simulador, **Carlos Menezes** (DevSolo) tem 180 dias de cadastro e nenhuma interação: aparece no
       "Saindo de órbita" com o selo "nunca contatado". Na API real ele **não** aparece. O mesmo vale, na
       TechConsult, para Gabriela Nunes (120 dias), Jorge Almeida (95) e Úrsula Freitas (160).
     - **Efeito na Fase 6 (Portal ligado na API):** as capturas de `/contatos` vão divergir das tiradas
       contra o simulador. O "Saindo de órbita" da DevSolo terá 3 itens em vez de 4, e nenhum com o selo
       "nunca contatado" na lista.
       - Conferido em 09/11/2026: nenhum E2E de `web/e2e/` conta os itens nem procura o Carlos Menezes.
         O "nunca contatado" do `fluxo.spec.js` é o da página de um contato recém-criado, que a API real
         também mostra.
       - Quem escrever um E2E novo sobre o "Saindo de órbita" deve procurar "contém João Servidor, Ana
         Ribeiro e Rafael Gomes, nessa ordem", não uma quantidade fixa.
       - A regra do "nunca contatado frio" está provada na API pelo T-PROD-02 (`tests/interacoes.test.js`,
         que envelhece o `criado_em` direto no banco).
5. **Fila fora de verdade.** Hoje o E2E simula o 503 `FILA_INDISPONIVEL` no navegador (`page.route`).
   Isso prova que o Portal trata a resposta, não que a API a devolve. Na stack real, parar o Redis e
   repetir.
6. **Confirmar o que o bloco 5 fez.**
   - `trustProxy` com `TRUST_PROXY_SALTOS=1`. O nginx **acrescenta** o IP real no `X-Forwarded-For`, e só
     com 1 salto confiável um IP forjado pelo cliente é ignorado. Com `trustProxy: true`, o rate limit de
     login seria burlável.
   - Pelo nginx, o IP no log da API é o do cliente.
   - A porta 3000 da API está publicada só em `127.0.0.1`.
7. **Telas da conta (bloco 14).** Se a API real devolver 404 em `/conta/*`, o Portal mostra "Essa função
   ainda não está disponível.". Conferir quando o bloco 14 existir.
8. **kind** (se o bloco 6 existir):
   - Deployment e Service `web` no NodePort 30080; `api-contatos` vira ClusterIP.
   - Antes, listar o que usa a 30080 direto: seed, scripts de demo e testes.
   - `deploy-kind.ps1` passa a buildar e carregar a imagem do `web`.
   - Os scripts de demo passam a aceitar `-BaseUrl http://localhost:30080/api`.
9. **Repetir o Lighthouse** contra a stack real e registrar um novo ensaio em `docs/ensaios/`.

## 2. Para publicar na VM do LARCC (SETREM)

Só a lista. Nada disto foi implementado.

- **HTTPS:** pelo proxy do laboratório ou com certificado próprio. Com HTTPS, ligar o HSTS no
  `web/nginx/seguranca.conf`. Se houver um proxy do laboratório na frente, ajustar `TRUST_PROXY_SALTOS`
  para 2.
- **Scripts `.ps1`:** precisam de versão em bash ou rodar com `pwsh` no Linux.
- **Backup** do Postgres na VM (o ensaio de restauração do bloco 11 vale como procedimento).
- **Expor só a porta do `web`** e configurar o firewall da VM. API, Postgres e Redis ficam só na rede interna.
- **`PORTAL_URL`** com o endereço público (links dos e-mails de confirmação e de exportação).
- **Acesso à VM:** quem tem, com que chave, e como se revoga.

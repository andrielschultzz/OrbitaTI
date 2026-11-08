# Portal Web: pendências (bloco 13)

**Estado em 07/11/2026:** Fases 0 a 5 e 7 do bloco 13 feitas. O Portal está pronto, testado e
empacotado, mas **roda contra o simulador do contrato** (`web/simulador/`), não contra a API real,
porque os blocos 2, 4 e 12 ainda não existem. A **Fase 6 (integração com a API real) está pendente**.

O que já vale hoje, contra o simulador:

- 41 testes unitários;
- 33 E2E;
- 64 capturas revisadas;
- Lighthouse acima das metas ([ensaio](ensaios/portal-lighthouse-2026-11-07.md)).

## 1. Fase 6: integração com a API real

Fazer quando os blocos 2, 4 e 12 existirem. Detalhes em `prompts/bloco-13.md`, Fase 6.

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

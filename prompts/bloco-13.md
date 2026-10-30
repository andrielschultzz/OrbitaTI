# Bloco 13 — Portal Web

Objetivo: criar o Portal Web do OrbitaTI em web/ (Vite + React, JavaScript), servido por
Nginx, integrado à API.

Telas:
1. Cadastro (empresa, plano, nome, e-mail, senha) e Login.
2. Contatos: busca, lista, botão "novo contato" (só nome obrigatório — cadastro em menos de
   30 s é requisito do produto), e no topo um bloco "Saindo de órbita" com os 5 contatos
   mais frios (GET /contatos/esfriando).
3. Contato: dados editáveis, estágio, histórico de interações e formulário de nova
   interação.
4. Importar CSV: envio do arquivo, mensagens claras para 413/422/429/503, e progresso
   consultando GET /importacoes/:id a cada 2 s até concluir.

Requisitos:
- Layout responsivo, pensado primeiro para celular.
- Token guardado em sessionStorage; 401 em qualquer chamada leva ao login.
- O Portal NUNCA envia tenant_id.
- Container com Nginx servindo o build e fazendo proxy de /api/ para api-contatos:3000
  (removendo o prefixo /api). Serviço "web" no compose em http://localhost:8080.
- No kind: Deployment + Service "web" passa a usar o NodePort 30080; a api-contatos vira
  ClusterIP. Atualize os manifests, o deploy-kind.ps1 e os scripts de demo (-BaseUrl
  http://localhost:30080/api).

Pronto quando: consigo, no navegador do celular simulado (F12 -> modo dispositivo),
cadastrar, criar contato, registrar interação, importar um CSV e ver o progresso; e
npm test continua passando.

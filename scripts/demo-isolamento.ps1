<#
.SYNOPSIS
  Demonstração ao vivo do isolamento entre tenants (CQ-02), para a apresentação da Etapa 2.

.DESCRIPTION
  1. Entra como DevSolo Sistemas e como TechConsult Solutions (contas do npm run seed).
  2. Mostra quantos contatos cada empresa vê.
  3. Pega o id de um contato da TechConsult.
  4. A DevSolo tenta LER, ALTERAR e EXCLUIR esse contato pelo id. Esperado: 404 nas três.
  5. A TechConsult relê o contato: ele continua igual.
  Sai com código 0 se o isolamento se manteve e 1 se houve falha (o CI pode usar o código de saída).

.PARAMETER BaseUrl
  Endereço da API. Padrão http://127.0.0.1:3000 (compose, direto na API). Pelo Portal (o caminho do
  usuário, com o nginx no meio): http://127.0.0.1:8080/api no compose e http://127.0.0.1:30080/api no kind,
  onde a API não tem porta própria (ClusterIP desde a Fase 6 do bloco 13).

.PARAMETER SemPausa
  Pula as pausas entre os passos. Use para rodar de ponta a ponta sem interação (testes e CI).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\demo-isolamento.ps1 -SemPausa
#>
param(
  [string]$BaseUrl = 'http://127.0.0.1:3000',
  [switch]$SemPausa
)

$ErrorActionPreference = 'Stop'
# Saída em UTF-8: sem isto, os acentos quebram quando a saída é redirecionada (CI, Git Bash, arquivo).
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$BaseUrl = $BaseUrl.TrimEnd('/')
$Senha = 'Demo@2026'
$script:Falhas = 0

function Passo([string]$Titulo) {
  Write-Host ''
  Write-Host "=== $Titulo ===" -ForegroundColor Cyan
}

function Pausa {
  if (-not $SemPausa) { [void](Read-Host 'Enter para continuar') }
}

function Entrar([string]$Email) {
  $corpo = @{ email = $Email; senha = $Senha } | ConvertTo-Json
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" -ContentType 'application/json; charset=utf-8' -Body $corpo
  } catch {
    Write-Host "Não consegui entrar como $Email em $BaseUrl." -ForegroundColor Red
    Write-Host 'Confira se a stack está no ar e se o seed rodou: npm run seed' -ForegroundColor Red
    exit 1
  }
  return $r.token
}

function Cabecalho([string]$Token) { return @{ Authorization = "Bearer $Token" } }

# Faz a chamada e devolve só o status HTTP. No PowerShell 5.1 e no 7, um 4xx vira exceção com a resposta dentro.
function Status([string]$Metodo, [string]$Caminho, [string]$Token, $Corpo = $null) {
  $parametros = @{ Method = $Metodo; Uri = "$BaseUrl$Caminho"; Headers = (Cabecalho $Token); UseBasicParsing = $true }
  if ($null -ne $Corpo) {
    $parametros.ContentType = 'application/json; charset=utf-8'
    $parametros.Body = [Text.Encoding]::UTF8.GetBytes(($Corpo | ConvertTo-Json))
  }
  try {
    return [int](Invoke-WebRequest @parametros).StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

function Tentativa([string]$Descricao, [string]$Metodo, [string]$Caminho, [string]$Token, $Corpo = $null) {
  $status = Status $Metodo $Caminho $Token $Corpo
  Write-Host ("  {0,-34} {1,-6} {2}  ->  " -f $Descricao, $Metodo, $Caminho) -NoNewline
  if ($status -eq 404) {
    Write-Host '404 — isolamento OK' -ForegroundColor Green
  } else {
    Write-Host "$status — FALHA DE ISOLAMENTO" -ForegroundColor Red
    $script:Falhas++
  }
}

Write-Host "Demo de isolamento entre tenants (CQ-02) — API em $BaseUrl" -ForegroundColor Yellow

Passo '1. Login das duas empresas'
$devsolo = Entrar 'marcelo@devsolo.dev'
$techconsult = Entrar 'gestor@techconsult.com.br'
Write-Host '  DevSolo Sistemas (individual) ........ token recebido'
Write-Host '  TechConsult Solutions (equipe) ....... token recebido'
Write-Host '  O tenant_id está DENTRO do token assinado. Nenhuma requisição daqui em diante informa o tenant.'
Pausa

Passo '2. Quantos contatos cada empresa vê (GET /contatos)'
$listaDev = Invoke-RestMethod -Uri "$BaseUrl/contatos" -Headers (Cabecalho $devsolo)
$listaTech = Invoke-RestMethod -Uri "$BaseUrl/contatos" -Headers (Cabecalho $techconsult)
Write-Host ("  DevSolo vê {0} contatos; TechConsult vê {1}." -f $listaDev.itens.Count, $listaTech.itens.Count)
Write-Host '  Mesma tabela no banco, mesma consulta (sem WHERE tenant_id): quem filtra é o RLS do PostgreSQL.'
Pausa

Passo '3. Um contato da TechConsult'
if ($listaTech.itens.Count -eq 0) {
  Write-Host '  A TechConsult não tem contatos. Rode: npm run seed' -ForegroundColor Red
  exit 1
}
$alvo = $listaTech.itens[0]
Write-Host "  id:      $($alvo.id)"
Write-Host "  nome:    $($alvo.nome)"
Write-Host "  empresa: $($alvo.empresa)"
Write-Host '  Agora a DevSolo vai pedir este id diretamente, como faria alguém que descobriu ou chutou o id.'
Pausa

Passo '4. DevSolo tenta acessar o contato da TechConsult'
Tentativa 'Ler'                       'GET'    "/contatos/$($alvo.id)" $devsolo
Tentativa 'Alterar o nome'            'PATCH'  "/contatos/$($alvo.id)" $devsolo @{ nome = 'Alterado pela DevSolo' }
Tentativa 'Excluir'                   'DELETE' "/contatos/$($alvo.id)" $devsolo
Tentativa 'Comparação: id inexistente' 'GET'   "/contatos/$([guid]::NewGuid())" $devsolo
Write-Host '  Mesma resposta para "de outra empresa" e "não existe": a DevSolo não descobre nem que o id existe.'
Pausa

Passo '5. A TechConsult confere o próprio contato'
$depois = Invoke-RestMethod -Uri "$BaseUrl/contatos/$($alvo.id)" -Headers (Cabecalho $techconsult)
if ($depois.nome -eq $alvo.nome -and $depois.atualizado_em -eq $alvo.atualizado_em) {
  Write-Host "  '$($depois.nome)' continua lá, sem nenhuma alteração." -ForegroundColor Green
} else {
  Write-Host "  O contato mudou: '$($alvo.nome)' -> '$($depois.nome)' — FALHA DE ISOLAMENTO" -ForegroundColor Red
  $script:Falhas++
}

Write-Host ''
if ($script:Falhas -eq 0) {
  Write-Host 'RESULTADO: isolamento OK em todas as tentativas.' -ForegroundColor Green
  exit 0
}
Write-Host "RESULTADO: $($script:Falhas) FALHA(S) DE ISOLAMENTO." -ForegroundColor Red
exit 1

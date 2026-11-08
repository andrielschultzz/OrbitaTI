<#
.SYNOPSIS
  Ensaio T-IMP-14: o worker morre no meio de uma importação de 5.000 linhas e nada duplica.

.DESCRIPTION
  1. Cadastra um tenant Equipe NOVO (vazio, para a contagem ser exata) e envia 5.000 linhas (50 lotes).
  2. Depois de alguns lotes aplicados, mata o worker (docker compose kill importacao: SIGKILL, sem
     chance de terminar o job) e sobe de novo (docker compose up -d importacao).
  3. O BullMQ percebe o job travado quando o lock expira (~30 s) e o devolve à fila. O worker recomeça do
     lote 1: os lotes já aplicados voltam {aplicado:false} (orbita.lotes_aplicados) e os contatos são
     upsert por (tenant_id, email). Regra 8 do CLAUDE.md.
  4. Confere: concluida, exatamente 5.000 contatos, lotes_aplicados = 50.
  5. Apaga o tenant do ensaio.

  Com -Quedas 2, mata o worker DUAS vezes no mesmo job. O BullMQ só recupera um job travado uma vez
  (maxStalledCount = 1): na segunda, o job falha com "job stalled more than allowable limit", o worker
  chama /interno/.../falha e a importação termina como falhou (não fica presa em processando). Os
  contatos já gravados ficam, sem duplicar: contatos = lotes_aplicados × 100.

  Leva de 1 a 3 minutos (cada recuperação espera o lock de 30 s expirar).

.PARAMETER BaseUrl
  Endereço da API. Padrão http://localhost:3000. Só funciona contra a stack do compose.

.PARAMETER Quedas
  1 (padrão, o T-IMP-14) ou 2 (prova o limite de recuperação do BullMQ).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\ensaio-reprocessamento.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\ensaio-reprocessamento.ps1 -Quedas 2
#>
param(
  [string]$BaseUrl = 'http://localhost:3000',
  [ValidateSet(1, 2)][int]$Quedas = 1
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$BaseUrl = $BaseUrl.TrimEnd('/')
Set-Location (Split-Path -Parent $PSScriptRoot)

$Linhas = 5000
$TotalLotes = 50
$script:Falhas = 0

function Passo([string]$Titulo) { Write-Host ''; Write-Host "=== $Titulo ===" -ForegroundColor Cyan }

function Conferir([string]$Descricao, [bool]$Ok, [string]$Detalhe = '') {
  Write-Host ("  {0,-52} " -f $Descricao) -NoNewline
  if ($Ok) { Write-Host "OK $Detalhe" -ForegroundColor Green } else { Write-Host "FALHA $Detalhe" -ForegroundColor Red; $script:Falhas++ }
}

function Compose {
  $ErrorActionPreference = 'Continue'
  $saida = & docker compose @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') falhou: $saida" }
}

# psql como superusuário dentro do contêiner (ignora o RLS): só para conferir e limpar.
function Sql([string]$Comando) {
  $ErrorActionPreference = 'Continue'
  $saida = & docker compose exec -T postgres psql -U postgres -d orbitati -v ON_ERROR_STOP=1 -tAc $Comando 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql falhou: $saida" }
  return "$saida".Trim()
}

function Progresso([string]$Token, [string]$Id) {
  return Invoke-RestMethod -Uri "$BaseUrl/importacoes/$Id" -Headers @{ Authorization = "Bearer $Token" }
}

# Espera até `condicao` (scriptblock que recebe a importação) ou o tempo acabar. Mostra o andamento.
function EsperarAte([string]$Token, [string]$Id, [scriptblock]$Condicao, [int]$Segundos, [string]$Rotulo) {
  $limite = (Get-Date).AddSeconds($Segundos)
  $ultimo = ''
  while ((Get-Date) -lt $limite) {
    $p = Progresso $Token $Id
    $agora = "$($p.status) $($p.lotes_aplicados)/$($p.total_lotes)"
    if ($agora -ne $ultimo) { Write-Host ("  {0:HH:mm:ss}  {1}" -f (Get-Date), $agora); $ultimo = $agora }
    if (& $Condicao $p) { return $p }
    Start-Sleep -Milliseconds 500
  }
  throw "tempo esgotado esperando: $Rotulo (último estado: $ultimo)"
}

function Matar {
  Compose kill importacao
  Write-Host ("  {0:HH:mm:ss}  docker compose kill importacao" -f (Get-Date)) -ForegroundColor Yellow
  Start-Sleep -Seconds 2
  Compose up -d importacao
  Write-Host ("  {0:HH:mm:ss}  docker compose up -d importacao" -f (Get-Date)) -ForegroundColor Yellow
}

$tenantId = $null
try {
  Passo "Preparação: tenant Equipe novo e CSV de $Linhas linhas"
  $email = "ensaio-t-imp-14-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@teste.orbitati.dev"
  $corpo = @{ empresa = 'Ensaio T-IMP-14'; plano = 'equipe'; nome = 'Ensaio'; email = $email; senha = 'Ensaio@2026' } | ConvertTo-Json
  $token = (Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/cadastro" -ContentType 'application/json' -Body $corpo).token
  $parte = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
  $parte += '=' * ((4 - $parte.Length % 4) % 4)
  $tenantId = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parte)) | ConvertFrom-Json).tenant_id
  Write-Host "  tenant $tenantId"
  $csv = (@('nome,email') + (1..$Linhas | ForEach-Object { "C$_,c$_@ensaio.dev" })) -join "`n"

  Passo 'Importação enviada'
  $imp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/importacoes" -Headers @{ Authorization = "Bearer $token" } -ContentType 'text/csv' -Body ([Text.Encoding]::UTF8.GetBytes($csv))
  $id = $imp.importacao_id
  Write-Host "  importacao_id $id"

  Passo 'Queda 1: o worker morre no meio'
  [void](EsperarAte $token $id { param($p) $p.lotes_aplicados -ge 8 } 60 'lote 8')
  Matar
  $naQueda = (Progresso $token $id).lotes_aplicados

  if ($Quedas -eq 2) {
    Passo 'Queda 2: o worker morre de novo no MESMO job, depois de retomá-lo'
    # Retomou = aplicou lote novo depois da queda (os já aplicados passam direto, sem escrever).
    [void](EsperarAte $token $id { param($p) $p.lotes_aplicados -ge ($naQueda + 3) } 120 'retomada depois da queda 1')
    Matar
  }

  Passo 'Esperando o fim'
  $final = EsperarAte $token $id { param($p) $p.status -eq 'concluida' -or $p.status -eq 'falhou' } 180 'fim da importação'

  Passo 'Resultado'
  $contatos = [int](Sql "SELECT count(*) FROM orbita.contatos WHERE tenant_id = '$tenantId'")
  $distintos = [int](Sql "SELECT count(DISTINCT email) FROM orbita.contatos WHERE tenant_id = '$tenantId'")
  $lotes = [int](Sql "SELECT count(*) FROM orbita.lotes_aplicados WHERE importacao_id = '$id'")
  $execucoes = Sql "SELECT string_agg(tentativa || ':' || status, ', ' ORDER BY iniciado_em) FROM importacao.execucoes WHERE importacao_id = '$id'"
  Write-Host "  execuções do worker (tentativa:status): $execucoes"
  Conferir 'nenhum contato duplicado' ($contatos -eq $distintos) "$contatos contatos, $distintos e-mails distintos"
  Conferir 'lotes_aplicados = lotes registrados no banco' ($final.lotes_aplicados -eq $lotes) "$($final.lotes_aplicados) = $lotes"
  if ($Quedas -eq 1) {
    Conferir 'status concluida' ($final.status -eq 'concluida') $final.status
    Conferir "exatamente $Linhas contatos" ($contatos -eq $Linhas) "$contatos"
    Conferir "lotes_aplicados = $TotalLotes" ($final.lotes_aplicados -eq $TotalLotes) "$($final.lotes_aplicados)"
  } else {
    Conferir 'status falhou (não ficou presa em processando)' ($final.status -eq 'falhou') $final.status
    Conferir 'contatos = lotes aplicados × 100' ($contatos -eq $final.lotes_aplicados * 100) "$contatos"
    $log = (& docker compose logs importacao --no-color 2>$null) | Select-String $id | Select-String 'falhou de vez'
    Conferir 'o worker registrou a falha definitiva' ([bool]$log) "$(("$log" -replace '.*"err":"([^"]*)".*', '$1'))"
  }
} finally {
  if ($tenantId) {
    # Mesma limpeza do tests/apoio/api.js: o schema importacao não tem FK para orbita.
    Sql "DELETE FROM importacao.erros_linha WHERE tenant_id = '$tenantId'; DELETE FROM importacao.execucoes WHERE tenant_id = '$tenantId'; DELETE FROM orbita.tenants WHERE id = '$tenantId'" | Out-Null
    Write-Host "  tenant do ensaio apagado"
  }
}

Write-Host ''
if ($script:Falhas -eq 0) { Write-Host 'RESULTADO: OK' -ForegroundColor Green; exit 0 }
Write-Host "RESULTADO: $($script:Falhas) verificação(ões) falharam." -ForegroundColor Red
exit 1

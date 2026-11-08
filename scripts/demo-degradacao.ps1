<#
.SYNOPSIS
  Demonstração ao vivo da degradação controlada (bloco 5): quando um serviço cai, o resto do CRM segue.

.DESCRIPTION
  Ensaios T-RES-01 a T-RES-05 do plano de testes, com a conta TechConsult Solutions do npm run seed.

  Parte 1: o worker de importação cai
    1. Mostra o GET /saude e para o serviço importacao (docker compose stop importacao).
    2. Login, busca e cadastro/alteração/exclusão de contato seguem funcionando (T-RES-01).
    3. Envia uma importação: 202 e fica na_fila (T-RES-02).
    4. Sobe o serviço de novo: a importação conclui sozinha (T-RES-02).
  Parte 2: o Redis cai
    5. Para o Redis: POST /importacoes -> 503 em menos de 2 s, sem registro órfão (T-RES-03).
    6. Login, busca, CRUD de contato e /saude seguem respondendo; o rate limit é ignorado (T-RES-04).
    7. Sobe o Redis: a importação volta a funcionar SEM reiniciar a API (T-RES-05).

  No fim, apaga os contatos que a demo criou. Se o script parar no meio, religa o que tiver parado.
  Sai com código 0 se tudo saiu como esperado e 1 se houve falha.

.PARAMETER BaseUrl
  Endereço da API. Padrão http://localhost:3000 (compose). O script usa "docker compose", então só
  funciona contra a stack do compose.

.PARAMETER SemPausa
  Pula as pausas entre os passos. Use para rodar de ponta a ponta sem interação (testes e CI).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\demo-degradacao.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\demo-degradacao.ps1 -SemPausa
#>
param(
  [string]$BaseUrl = 'http://localhost:3000',
  [switch]$SemPausa
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$BaseUrl = $BaseUrl.TrimEnd('/')
# "docker compose" precisa rodar na pasta do docker-compose.yml.
Set-Location (Split-Path -Parent $PSScriptRoot)

$Email = 'gestor@techconsult.com.br'
$Senha = 'Demo@2026'
# E-mails fixos: rodar a demo de novo atualiza os mesmos contatos (upsert), não cria outros.
$MarcaImportacao = 'demo-degradacao'
$script:Falhas = 0
$script:Parados = @{}

function Passo([string]$Titulo) {
  Write-Host ''
  Write-Host "=== $Titulo ===" -ForegroundColor Cyan
}

function Pausa {
  if (-not $SemPausa) { [void](Read-Host 'Enter para continuar') }
}

function Conferir([string]$Descricao, [bool]$Ok, [string]$Detalhe = '') {
  Write-Host ("  {0,-58} " -f $Descricao) -NoNewline
  if ($Ok) {
    Write-Host "OK $Detalhe" -ForegroundColor Green
  } else {
    Write-Host "FALHA $Detalhe" -ForegroundColor Red
    $script:Falhas++
  }
}

# docker compose escreve o progresso no stderr. No PowerShell 5.1, com ErrorActionPreference = Stop,
# isso viraria exceção; aqui o stderr é só descartado e quem decide é o código de saída.
function Compose {
  $ErrorActionPreference = 'Continue'
  $saida = & docker compose @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') falhou: $saida" }
}

function Parar([string]$Servico) {
  Compose stop $Servico
  $script:Parados[$Servico] = $true
  Write-Host "  docker compose stop $Servico" -ForegroundColor Yellow
}

function Religar([string]$Servico) {
  Compose start $Servico
  $script:Parados.Remove($Servico)
  Write-Host "  docker compose start $Servico" -ForegroundColor Yellow
}

# Faz a chamada e devolve {Status, Corpo, Ms}, sem lançar exceção em 4xx/5xx (PowerShell 5.1 e 7).
function Chamar([string]$Metodo, [string]$Caminho, $Json = $null, [string]$Csv = $null, [string]$Token = $script:Token) {
  $parametros = @{ Method = $Metodo; Uri = "$BaseUrl$Caminho"; UseBasicParsing = $true; Headers = @{} }
  if ($Token) { $parametros.Headers.Authorization = "Bearer $Token" }
  if ($null -ne $Json) {
    $parametros.ContentType = 'application/json; charset=utf-8'
    $parametros.Body = [Text.Encoding]::UTF8.GetBytes(($Json | ConvertTo-Json -Compress))
  }
  if ($Csv) {
    $parametros.ContentType = 'text/csv; charset=utf-8'
    $parametros.Body = [Text.Encoding]::UTF8.GetBytes($Csv)
  }
  $relogio = [Diagnostics.Stopwatch]::StartNew()
  $status = 0
  $texto = ''
  try {
    $r = Invoke-WebRequest @parametros
    $status = [int]$r.StatusCode
    $texto = $r.Content
    if ($texto -is [byte[]]) { $texto = [Text.Encoding]::UTF8.GetString($texto) }
  } catch {
    if (-not $_.Exception.Response) { throw }
    $status = [int]$_.Exception.Response.StatusCode
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $texto = $_.ErrorDetails.Message
    } else {
      try { $texto = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
    }
  }
  $relogio.Stop()
  $corpo = $null
  if ($texto) { try { $corpo = $texto | ConvertFrom-Json } catch { $corpo = $texto } }
  return [pscustomobject]@{ Status = $status; Corpo = $corpo; Ms = [int]$relogio.ElapsedMilliseconds }
}

function Entrar {
  $r = Chamar POST '/auth/login' @{ email = $Email; senha = $Senha } -Token ''
  if ($r.Status -ne 200) {
    Write-Host "Não consegui entrar como $Email em $BaseUrl (HTTP $($r.Status))." -ForegroundColor Red
    Write-Host 'Confira se a stack está no ar e se o seed rodou: npm run seed' -ForegroundColor Red
    exit 1
  }
  $script:Token = $r.Corpo.token
  return $r
}

function MostrarSaude {
  $r = Chamar GET '/saude' -Token ''
  Write-Host ("  GET /saude -> HTTP {0} {1}" -f $r.Status, ($r.Corpo | ConvertTo-Json -Compress))
  return $r
}

# CRUD completo de um contato: prova que o CRM segue de pé sem o serviço que caiu.
function CrudContato([string]$Quando) {
  $login = Chamar POST '/auth/login' @{ email = $Email; senha = $Senha } -Token ''
  Conferir "login ($Quando)" ($login.Status -eq 200) "HTTP $($login.Status)"
  $busca = Chamar GET '/contatos?busca=a'
  Conferir "busca de contatos ($Quando)" ($busca.Status -eq 200) "HTTP $($busca.Status), $(@($busca.Corpo.itens).Count) contatos"
  $novo = Chamar POST '/contatos' @{ nome = "Contato da demo de degradação ($Quando)"; empresa = 'Demo' }
  Conferir "cadastro de contato ($Quando)" ($novo.Status -eq 201) "HTTP $($novo.Status)"
  if ($novo.Status -eq 201) {
    $alt = Chamar PATCH "/contatos/$($novo.Corpo.id)" @{ observacao = 'alterado durante a falha' }
    Conferir "alteração do contato ($Quando)" ($alt.Status -eq 200) "HTTP $($alt.Status)"
    $del = Chamar DELETE "/contatos/$($novo.Corpo.id)"
    Conferir "exclusão do contato ($Quando)" ($del.Status -eq 204) "HTTP $($del.Status)"
  }
}

# Importação pequena, com e-mails fixos.
$linhas = 1..20 | ForEach-Object { 'Contato importado {0:D2},{1}-{0:D2}@exemplo.com.br' -f $_, $MarcaImportacao }
$Csv = (@('nome,email') + $linhas) -join "`n"

function Importar {
  return Chamar POST '/importacoes' -Csv $Csv
}

function EsperarConclusao([string]$Id, [int]$Segundos = 90) {
  $limite = (Get-Date).AddSeconds($Segundos)
  $vistos = @()
  while ((Get-Date) -lt $limite) {
    $r = Chamar GET "/importacoes/$Id"
    $status = $r.Corpo.status
    if ($vistos.Count -eq 0 -or $vistos[-1] -ne $status) { $vistos += $status }
    if ($status -eq 'concluida' -or $status -eq 'falhou') { break }
    Start-Sleep -Seconds 1
  }
  Write-Host ("  status observados: {0}" -f ($vistos -join ' -> '))
  return $r.Corpo
}

function ImportacoesNoBanco {
  # psql como superusuário dentro do contêiner (ignora o RLS): conta o total de registros, de todos os
  # tenants. Só para provar que o 503 não deixou registro órfão para trás.
  $ErrorActionPreference = 'Continue'
  $n = & docker compose exec -T postgres psql -U postgres -d orbitati -tAc 'SELECT count(*) FROM orbita.importacoes' 2>$null
  return [int]("$n".Trim())
}

function PartidaDaApi {
  $ErrorActionPreference = 'Continue'
  $id = & docker compose ps -q api-contatos 2>$null
  return (& docker inspect -f '{{.State.StartedAt}}' $id 2>$null)
}

try {
  Passo 'Preparação: entrar como TechConsult Solutions (conta do seed, plano Equipe)'
  [void](Entrar)
  Write-Host "  ok, token de $Email"
  Pausa

  # ------------------------------------------------------------------------------------------------
  Passo '1. Tudo no ar: GET /saude'
  [void](MostrarSaude)
  Pausa

  Passo '2. O worker de importação cai'
  Parar importacao
  Pausa

  Passo '3. T-RES-01: o CRM continua funcionando sem o worker'
  CrudContato 'sem o worker'
  Pausa

  Passo '4. T-RES-02: importação enviada com o worker fora fica na fila'
  $imp = Importar
  Conferir 'POST /importacoes com o worker fora -> 202' ($imp.Status -eq 202) "HTTP $($imp.Status)"
  $idImportacao = $imp.Corpo.importacao_id
  Start-Sleep -Seconds 3
  $estado = (Chamar GET "/importacoes/$idImportacao").Corpo.status
  Conferir '3 s depois, a importação continua na_fila' ($estado -eq 'na_fila') "status: $estado"
  Pausa

  Passo '5. O worker volta e a importação conclui sozinha'
  Religar importacao
  $final = EsperarConclusao $idImportacao
  Conferir 'importação concluida' ($final.status -eq 'concluida') "status: $($final.status), $($final.lotes_aplicados)/$($final.total_lotes) lotes"
  Pausa

  # ------------------------------------------------------------------------------------------------
  Passo '6. T-RES-03: o Redis cai -> POST /importacoes responde 503 rápido'
  $antes = ImportacoesNoBanco
  Parar redis
  $imp = Importar
  Conferir 'POST /importacoes -> 503 FILA_INDISPONIVEL' ($imp.Status -eq 503 -and $imp.Corpo.codigo -eq 'FILA_INDISPONIVEL') "HTTP $($imp.Status) $($imp.Corpo.codigo)"
  Conferir 'resposta em menos de 2 s' ($imp.Ms -lt 2000) "$($imp.Ms) ms"
  Write-Host "  mensagem: $($imp.Corpo.erro)"
  $depois = ImportacoesNoBanco
  Conferir 'nenhum registro órfão em orbita.importacoes' ($depois -eq $antes) "antes $antes, depois $depois"
  Pausa

  Passo '7. T-RES-04: o resto continua respondendo sem o Redis'
  $saude = MostrarSaude
  Conferir '/saude -> HTTP 200 com fila "fora"' ($saude.Status -eq 200 -and $saude.Corpo.db -eq 'ok' -and $saude.Corpo.fila -eq 'fora') ''
  CrudContato 'sem o Redis'
  Pausa

  Passo '8. T-RES-05: o Redis volta e a importação funciona sem reiniciar a API'
  $partidaAntes = PartidaDaApi
  Religar redis
  # A API reconecta sozinha (espera crescente até 5 s). Espera o /saude mostrar a fila de volta.
  $limite = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 1
    $s = Chamar GET '/saude' -Token ''
  } while ($s.Corpo.fila -ne 'ok' -and (Get-Date) -lt $limite)
  Write-Host ("  GET /saude -> HTTP {0} {1}" -f $s.Status, ($s.Corpo | ConvertTo-Json -Compress))
  $imp = Importar
  Conferir 'POST /importacoes -> 202' ($imp.Status -eq 202) "HTTP $($imp.Status)"
  $partidaDepois = PartidaDaApi
  Conferir 'a API não foi reiniciada (mesmo horário de partida)' ($partidaAntes -eq $partidaDepois) "$partidaDepois"
  if ($imp.Status -eq 202) {
    $final = EsperarConclusao $imp.Corpo.importacao_id
    Conferir 'importação concluida' ($final.status -eq 'concluida') "status: $($final.status)"
  }
} finally {
  # Nunca deixa a stack pela metade, nem quando o script falha no meio.
  foreach ($servico in @($script:Parados.Keys)) {
    Write-Host "  religando $servico (o script parou no meio)" -ForegroundColor Yellow
    try { Compose start $servico } catch { Write-Host "  não consegui religar ${servico}: $_" -ForegroundColor Red }
  }
}

Passo 'Limpeza: apagando os contatos que a demo importou'
$apagados = 0
foreach ($c in @((Chamar GET "/contatos?busca=$MarcaImportacao").Corpo.itens)) {
  if ($c -and (Chamar DELETE "/contatos/$($c.id)").Status -eq 204) { $apagados++ }
}
Write-Host "  $apagados contatos apagados"

Write-Host ''
if ($script:Falhas -eq 0) {
  Write-Host 'RESULTADO: a falha de um serviço ficou contida. O CRM seguiu funcionando.' -ForegroundColor Green
  exit 0
}
Write-Host "RESULTADO: $($script:Falhas) verificação(ões) falharam." -ForegroundColor Red
exit 1

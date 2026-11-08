<#
.SYNOPSIS
  Sonda de disponibilidade do CQ-04 (bloco 11): chama /saude em intervalo fixo e mede a disponibilidade.

.DESCRIPTION
  Uma amostra a cada -IntervaloSegundos, durante -Minutos. Padrão: 60 min a cada 15 s = 240 amostras.
  Por que 240 (decisão 7 de prompts/decisoes-plano-de-testes.md): cada amostra pesa 1 ÷ 240 = 0,42%;
  para 1 falha pesar no máximo 0,5% são precisas 1 ÷ 0,005 = 200 amostras. 0 falhas = 100%; 1 falha =
  99,58% (aprova); 2 falhas = 99,17% (reprova). Critério do CQ-04: ≥ 99,5%.

  FALHA = status diferente de 200, ou sem resposta em 2 s (timeout), ou erro de conexão.

  Como mede:
  - As amostras seguem o relógio: a amostra i sai em início + i × intervalo, e não "15 s depois da
    anterior". Senão a latência se acumula e a hora acaba com menos de 240 amostras.
  - Cada amostra abre uma conexão nova (Connection: close). Com keep-alive, o kube-proxy prenderia todas
    as amostras na mesma réplica (ele balanceia por conexão) e a sonda mediria um pod só.
  - Impede o Windows de suspender enquanto roda (SetThreadExecutionState) e devolve o normal no fim.
    Se mesmo assim o PC parar (tampa fechada, hibernação), as amostras que não saíram contam como
    "perdidas": aparecem no resumo, não somem.
  - Cada amostra vai para o CSV na hora (Ctrl+C não perde o que já foi medido; o resumo sai no finally).

  CSV (separador ";"): amostra;horario;status;latencia_ms;resultado;erro
  resultado = ok | falha | perdida.

  O que a sonda NÃO prova: os 99,5% do mês (ver docs/ensaios/cq04-*.md). Ela prova o MÉTODO.

.PARAMETER Url
  Padrão: http://127.0.0.1:30080/saude (API no kind, 2 réplicas). Compose: http://127.0.0.1:3000/saude.
  127.0.0.1 e NÃO localhost: no Windows, "localhost" resolve primeiro para ::1 (IPv6); o kind e o compose
  publicam só em 127.0.0.1, e a tentativa em ::1 fica ~2 s pendurada antes de cair para o IPv4. Medido em
  08/11/2026: 2.051 ms com localhost, 26 ms com 127.0.0.1. Com o timeout de 2 s, TODA amostra daria falha.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\sonda.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\sonda.ps1 -Minutos 1 -IntervaloSegundos 5   # teste rápido
#>
param(
  [string]$Url = 'http://127.0.0.1:30080/saude',
  [double]$Minutos = 60,
  [int]$IntervaloSegundos = 15,
  [int]$TimeoutSegundos = 2,
  [string]$Saida = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
Set-Location (Split-Path -Parent $PSScriptRoot)
Add-Type -AssemblyName System.Net.Http
Add-Type -Namespace OrbitaTI -Name Energia -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = [uint32]'0x80000000'; $ES_SYSTEM_REQUIRED = [uint32]'0x00000001'
$Inv = [Globalization.CultureInfo]::InvariantCulture

if (([Uri]$Url).Host -eq 'localhost') {
  Write-Host 'ATENÇÃO: "localhost" passa primeiro por ::1 e soma ~2 s em cada amostra (ver -Url no Get-Help). Use 127.0.0.1.' -ForegroundColor Yellow
}
$Esperadas = [int][math]::Floor($Minutos * 60 / $IntervaloSegundos)
if (-not $Saida) { $Saida = "docs/ensaios/cq04-$(Get-Date -Format 'yyyy-MM-dd-HHmm')-amostras.csv" }
$SaidaAbs = if ([IO.Path]::IsPathRooted($Saida)) { $Saida } else { Join-Path (Get-Location) $Saida }
$Utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText($SaidaAbs, "amostra;horario;status;latencia_ms;resultado;erro`n", $Utf8)

$Cliente = New-Object Net.Http.HttpClient
$Cliente.Timeout = [TimeSpan]::FromSeconds($TimeoutSegundos)
$Cliente.DefaultRequestHeaders.ConnectionClose = $true

$Amostras = New-Object Collections.Generic.List[object]
$Inicio = Get-Date

function Registrar($n, $horario, $status, $ms, $resultado, $erro) {
  $erro = ($erro -replace '[;\r\n]', ' ').Trim()
  $msTxt = if ($null -eq $ms) { '' } else { $ms.ToString('0.0', $Inv) }
  $linha = "$n;$($horario.ToString('yyyy-MM-ddTHH:mm:ss.fffK'));$status;$msTxt;$resultado;$erro`n"
  [IO.File]::AppendAllText($SaidaAbs, $linha, $Utf8)
  $Amostras.Add([pscustomobject]@{ N = $n; Status = $status; Ms = $ms; Resultado = $resultado })
}

function Resumo {
  $realizadas = @($Amostras | Where-Object { $_.Resultado -ne 'perdida' })
  $falhas = @($realizadas | Where-Object { $_.Resultado -eq 'falha' })
  $perdidas = @($Amostras | Where-Object { $_.Resultado -eq 'perdida' }).Count
  $lat = @($realizadas | Where-Object { $null -ne $_.Ms } | ForEach-Object { $_.Ms } | Sort-Object)
  Write-Host ''
  Write-Host '=== Resumo da sonda (CQ-04) ===' -ForegroundColor Cyan
  Write-Host "  alvo:                $Url"
  Write-Host "  início / fim:        $($Inicio.ToString('dd/MM/yyyy HH:mm:ss')) / $((Get-Date).ToString('HH:mm:ss'))"
  Write-Host "  amostras:            $($realizadas.Count) realizadas de $Esperadas esperadas ($perdidas perdidas)"
  Write-Host "  falhas:              $($falhas.Count)"
  if ($falhas.Count -gt 0) { $falhas | ForEach-Object { Write-Host "                       amostra $($_.N): status $($_.Status)" } }
  if ($realizadas.Count -gt 0) {
    $disp = 100.0 * ($realizadas.Count - $falhas.Count) / $realizadas.Count
    Write-Host ("  disponibilidade:     {0:N2}%  (critério ≥ 99,50%)" -f $disp)
  }
  if ($lat.Count -gt 0) {
    $p = { param($q) $lat[[math]::Min($lat.Count - 1, [int][math]::Ceiling($q * $lat.Count) - 1)] }
    Write-Host ("  latência (ms):       mediana {0:N1} · p95 {1:N1} · pior {2:N1}" -f (& $p 0.5), (& $p 0.95), $lat[-1])
  }
  # Regra de três: só vale com 0 falhas (com falhas, a conta é outra e a taxa observada já diz mais).
  if ($realizadas.Count -gt 0 -and $falhas.Count -eq 0) {
    Write-Host ("  regra de três:       0 falhas em {0}: a taxa real de falha pode chegar a 3 ÷ {0} = {1:N2}% (95% de confiança)" -f $realizadas.Count, (300.0 / $realizadas.Count))
  }
  if ($realizadas.Count -lt 200) {
    Write-Host '  veredito:            INCONCLUSIVO (menos de 200 amostras: 1 falha pesaria mais que 0,5%)' -ForegroundColor Yellow
  } elseif ((100.0 * ($realizadas.Count - $falhas.Count) / $realizadas.Count) -ge 99.5) {
    Write-Host '  veredito:            APROVADO na rodada (prova o método, não o mês)' -ForegroundColor Green
  } else {
    Write-Host '  veredito:            REPROVADO na rodada' -ForegroundColor Red
  }
  Write-Host "  CSV:                 $Saida"
}

Write-Host "Sonda: $Url · $Esperadas amostras · 1 a cada $IntervaloSegundos s · timeout $TimeoutSegundos s · até $($Inicio.AddSeconds($Esperadas * $IntervaloSegundos).ToString('HH:mm:ss'))"
Write-Host 'Não feche esta janela. Ctrl+C encerra e imprime o resumo do que já foi medido.'
[OrbitaTI.Energia]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null

try {
  for ($i = 0; $i -lt $Esperadas; $i++) {
    $alvo = $Inicio.AddSeconds($i * $IntervaloSegundos)
    $espera = ($alvo - (Get-Date)).TotalMilliseconds
    if ($espera -gt 0) { Start-Sleep -Milliseconds ([int]$espera) }
    # Atrasada mais de um intervalo (PC parado): a amostra não saiu na hora; conta como perdida.
    if (((Get-Date) - $alvo).TotalSeconds -gt $IntervaloSegundos) {
      Registrar ($i + 1) $alvo '' $null 'perdida' 'não saiu na hora (PC suspenso ou travado)'
      continue
    }
    $agora = Get-Date
    $relogio = [Diagnostics.Stopwatch]::StartNew()
    try {
      $resp = $Cliente.GetAsync($Url).GetAwaiter().GetResult()
      $relogio.Stop()
      $status = [int]$resp.StatusCode
      $resp.Dispose()
      $resultado = if ($status -eq 200) { 'ok' } else { 'falha' }
      Registrar ($i + 1) $agora $status $relogio.Elapsed.TotalMilliseconds $resultado ''
    } catch {
      $relogio.Stop()
      $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
      $tipo = if ($e -is [Threading.Tasks.TaskCanceledException]) { "timeout de $TimeoutSegundos s" } else { $e.Message }
      Registrar ($i + 1) $agora 'sem_resposta' $null 'falha' $tipo
    }
    $u = $Amostras[-1]
    $cor = if ($u.Resultado -eq 'ok') { 'Gray' } else { 'Red' }
    $ms = if ($null -eq $u.Ms) { '-' } else { '{0:N1} ms' -f $u.Ms }
    Write-Host ("  [{0,3}/{1}] {2:HH:mm:ss}  {3,-12} {4,10}  {5}" -f $u.N, $Esperadas, $agora, $u.Status, $ms, $u.Resultado) -ForegroundColor $cor
  }
} finally {
  [OrbitaTI.Energia]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
  $Cliente.Dispose()
  Resumo
}

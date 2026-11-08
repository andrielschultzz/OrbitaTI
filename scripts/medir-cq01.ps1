<#
.SYNOPSIS
  Mede o CQ-01 (vizinho barulhento) com e sem a mitigação: T-CQ01-01 e T-CQ01-02 (bloco 9).

.DESCRIPTION
  Duas rodadas do tests/carga/cq01.js (k6, serviço "k6" do compose, profile "carga"):
    com  IMPORT_LOTE=100,  IMPORT_PAUSA_MS=500   (os padrões do ADR-003)  -> veredito do CQ-01
    sem  IMPORT_LOTE=5000, IMPORT_PAUSA_MS=0     (cada importação vira 1 lote) -> só registro
  Entre as rodadas, recria só o serviço importacao com os valores da rodada.

  Para cada rodada, salva em tests/carga/resultados/<data-hora>/<com|sem>/:
    k6.json          cada ponto medido, com horário (entrada do janelas.js; fora do git, ~MB)
    resumo-k6.json   resumo do k6 (--summary-export)
    k6-saida.txt     o que o k6 imprimiu (thresholds, linhas JANELA)
    janelas.txt      as linhas "JANELA <n> <inicio_ms> <fim_ms> <status>"
    veredito.txt     saída do tests/carga/janelas.js (na janela x geral, com n) e veredito.json
  E, na pasta da execução, maquina.txt (máquina, Docker e versões).

  NO FINAL, SEMPRE (finally, mesmo com erro ou Ctrl+C): recria o importacao com os valores padrão e
  confere dentro do contêiner que ficou IMPORT_LOTE=100 e IMPORT_PAUSA_MS=500. A stack nunca fica sem a
  mitigação depois do ensaio. Depois apaga os 11 tenants de cada rodada (a não ser com -ManterDados),
  inclusive importacao.execucoes e importacao.erros_linha, onde o cascade não chega (B1).
  Fechar a janela do terminal mata o processo sem rodar o finally: nesse caso, rode
  "docker compose up -d --force-recreate --wait importacao" à mão.

  Leva ~6 a 8 minutos. A stack precisa estar no ar (docker compose up -d --build --wait).

.PARAMETER ManterDados
  Não apaga os tenants criados (para olhar no banco depois).

.PARAMETER RecursosProducao
  Antes das rodadas, recria o postgres com o docker-compose.carga.yml: 1 vCPU e 2 GB, o tamanho da instância
  de produção do ADR-001. A API e o worker continuam sem limite. No fim (finally), recria o postgres SEM o
  override e confere que os limites saíram (NanoCpus = 0, Memory = 0) e que a API voltou a ver o banco.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\medir-cq01.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\medir-cq01.ps1 -RecursosProducao
#>
param([switch]$ManterDados, [switch]$RecursosProducao)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
Set-Location (Split-Path -Parent $PSScriptRoot)

$LotePadrao = '100'
$PausaPadrao = '500'
$Execucao = Get-Date -Format 'yyyy-MM-dd_HHmmss'
if ($RecursosProducao) { $Execucao += '_pg-producao' }
$Pasta = "tests/carga/resultados/$Execucao"
# Com -RecursosProducao, TODO comando do compose durante as rodadas leva o override. Sem isso, um
# "compose run" ou "up" só com o arquivo padrão poderia achar o postgres "diferente" e recriá-lo sem limite.
$ArquivosCompose = @()
if ($RecursosProducao) { $ArquivosCompose = @('-f', 'docker-compose.yml', '-f', 'docker-compose.carga.yml') }
$Utf8 = New-Object Text.UTF8Encoding $false
$Rodadas = @(
  @{ Nome = 'com'; Lote = '100'; Pausa = '500'; SemCriterio = $false; Teste = 'T-CQ01-01' },
  @{ Nome = 'sem'; Lote = '5000'; Pausa = '0'; SemCriterio = $true; Teste = 'T-CQ01-02' }
)

function Passo([string]$Titulo) { Write-Host ''; Write-Host "=== $Titulo ===" -ForegroundColor Cyan }
function Gravar([string]$Arquivo, $Linhas) { [IO.File]::WriteAllLines((Join-Path (Get-Location) $Arquivo), [string[]]@($Linhas), $Utf8) }

# Comando nativo: junta stdout e stderr como texto e devolve o código de saída (sem o NativeCommandError do PS 5).
function Nativo([string]$Exe, [string[]]$Argumentos) {
  $ErrorActionPreference = 'Continue'
  $saida = & $Exe @Argumentos 2>&1 | ForEach-Object { "$_" }
  return @{ Codigo = $LASTEXITCODE; Saida = @($saida) }
}

function Compose([string[]]$Argumentos, [switch]$SemOverride) {
  $arquivos = $ArquivosCompose
  if ($SemOverride) { $arquivos = @() }
  $r = Nativo 'docker' (@('compose') + $arquivos + $Argumentos)
  if ($r.Codigo -ne 0) { throw "docker compose $($Argumentos -join ' ') falhou: $($r.Saida -join "`n")" }
  return $r.Saida
}

# psql como superusuário dentro do contêiner (ignora o RLS): só para conferir e limpar o que o ensaio criou.
function Sql([string]$Comando) {
  $r = Nativo 'docker' @('compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'orbitati', '-v', 'ON_ERROR_STOP=1', '-tAc', $Comando)
  if ($r.Codigo -ne 0) { throw "psql falhou: $($r.Saida -join "`n")" }
  return ($r.Saida -join "`n").Trim()
}

# Recria SÓ o worker com o lote e a pausa dados. A variável do processo vence o .env no compose.
# $null = tira a variável do processo: vale o .env (ou o padrão do compose, 100 e 500).
function RecriarImportacao($Lote, $Pausa) {
  if ($null -eq $Lote) { Remove-Item Env:IMPORT_LOTE -ErrorAction SilentlyContinue } else { $env:IMPORT_LOTE = $Lote }
  if ($null -eq $Pausa) { Remove-Item Env:IMPORT_PAUSA_MS -ErrorAction SilentlyContinue } else { $env:IMPORT_PAUSA_MS = $Pausa }
  Compose @('up', '-d', '--no-deps', '--force-recreate', '--wait', 'importacao') | Out-Null
}

function ValoresNoWorker {
  $lote = (Compose @('exec', '-T', 'importacao', 'printenv', 'IMPORT_LOTE')) -join ''
  $pausa = (Compose @('exec', '-T', 'importacao', 'printenv', 'IMPORT_PAUSA_MS')) -join ''
  return @{ Lote = $lote.Trim(); Pausa = $pausa.Trim() }
}

# Limites efetivos do contêiner do postgres (0 = sem limite). NanoCpus: 1e9 = 1 CPU.
function LimitesPostgres {
  $id = (Compose @('ps', '-q', 'postgres') -SemOverride) -join ''
  $v = ((Nativo 'docker' @('inspect', '--format', '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}', $id.Trim())).Saida -join '').Trim() -split ' '
  return @{ Cpus = [double]$v[0] / 1e9; MemoriaGiB = [double]$v[1] / 1GB }
}

# Recria o postgres (com ou sem o override) e espera a API voltar a ver o banco (/saude db = ok).
function RecriarPostgres([switch]$SemOverride) {
  Compose @('up', '-d', '--no-deps', '--force-recreate', '--wait', 'postgres') -SemOverride:$SemOverride | Out-Null
  $limite = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 1
    try { $s = Invoke-RestMethod -Uri 'http://localhost:3000/saude' -TimeoutSec 5 } catch { $s = $null }
  } while ((-not $s -or $s.db -ne 'ok') -and (Get-Date) -lt $limite)
  if (-not $s -or $s.db -ne 'ok') { throw 'a API não voltou a ver o banco 60 s depois de recriar o postgres' }
}

function RegistrarMaquina {
  $cs = Get-CimInstance Win32_ComputerSystem
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $so = Get-CimInstance Win32_OperatingSystem
  $docker = (Nativo 'docker' @('info', '--format', 'CPUs={{.NCPU}} Memoria={{.MemTotal}} Engine={{.ServerVersion}} SO={{.OperatingSystem}} Kernel={{.KernelVersion}}')).Saida -join ' '
  $compose = (Nativo 'docker' @('compose', 'version', '--short')).Saida -join ''
  $commit = (Nativo 'git' @('rev-parse', '--short', 'HEAD')).Saida -join ''
  $pg = LimitesPostgres
  $pgTexto = 'sem limite (divide as CPUs e a memória da VM do Docker com o resto da stack)'
  if ($pg.Cpus -gt 0 -or $pg.MemoriaGiB -gt 0) { $pgTexto = ("{0} vCPU, {1:N1} GiB (docker-compose.carga.yml, instância de produção do ADR-001)" -f $pg.Cpus, $pg.MemoriaGiB) }
  Gravar "$Pasta/maquina.txt" @(
    "Execução: $Execucao (horário local; os horários do k6 são UTC)",
    "Máquina: $($cs.Manufacturer) $($cs.Model)",
    "Processador: $($cpu.Name.Trim()) ($($cpu.NumberOfCores) núcleos, $($cpu.NumberOfLogicalProcessors) lógicos)",
    ("RAM do Windows: {0:N1} GiB" -f ($cs.TotalPhysicalMemory / 1GB)),
    "Windows: $($so.Caption) $($so.Version)",
    "Docker (VM do Docker Desktop): $docker",
    "Docker Compose: $compose",
    "Postgres: $pgTexto",
    'API e worker: sem limite de CPU e memória',
    "k6: imagem grafana/k6:1.3.0 (docker-compose.yml), na rede interna do compose",
    "Commit: $commit",
    "Medida do lado do servidor: k6 -> api-contatos pela rede do compose, sem os 200 ms de 4G do orçamento do CQ-01."
  )
}

$resultados = @()
$restaurado = $false
try {
  Passo 'Pré-requisitos'
  $saude = Invoke-RestMethod -Uri 'http://localhost:3000/saude' -TimeoutSec 5
  if ($saude.db -ne 'ok' -or $saude.fila -ne 'ok') { throw "stack fora do ar: /saude = $($saude | ConvertTo-Json -Compress)" }
  New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
  if ($RecursosProducao) {
    Passo 'Postgres do tamanho de produção (ADR-001: 1 vCPU, 2 GB)'
    RecriarPostgres
    $pg = LimitesPostgres
    if ($pg.Cpus -ne 1 -or $pg.MemoriaGiB -ne 2) { throw "postgres ficou com $($pg.Cpus) CPU e $($pg.MemoriaGiB) GiB" }
    Write-Host "  postgres recriado: $($pg.Cpus) vCPU, $($pg.MemoriaGiB) GiB; API vê o banco"
  }
  RegistrarMaquina
  Get-Content "$Pasta/maquina.txt" -Encoding UTF8 | ForEach-Object { Write-Host "  $_" }

  foreach ($r in $Rodadas) {
    Passo "Rodada '$($r.Nome)' ($($r.Teste)): IMPORT_LOTE=$($r.Lote), IMPORT_PAUSA_MS=$($r.Pausa)"
    $dir = "$Pasta/$($r.Nome)"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    RecriarImportacao $r.Lote $r.Pausa
    $v = ValoresNoWorker
    if ($v.Lote -ne $r.Lote -or $v.Pausa -ne $r.Pausa) { throw "worker ficou com IMPORT_LOTE=$($v.Lote), IMPORT_PAUSA_MS=$($v.Pausa)" }
    Write-Host "  worker recriado: IMPORT_LOTE=$($v.Lote), IMPORT_PAUSA_MS=$($v.Pausa)"

    Write-Host '  k6 rodando (setup + 2 min de buscas)...'
    $k6 = Nativo 'docker' (@('compose') + $ArquivosCompose + @('--profile', 'carga', 'run', '--rm', '-e', "RODADA=$Execucao-$($r.Nome)", 'k6', 'run', '--quiet',
      '--out', "json=/resultados/$Execucao/$($r.Nome)/k6.json", '--summary-export', "/resultados/$Execucao/$($r.Nome)/resumo-k6.json", '/scripts/cq01.js'))
    Gravar "$dir/k6-saida.txt" $k6.Saida
    Gravar "$dir/janelas.txt" @($k6.Saida | Where-Object { $_ -match 'JANELA \d' } | ForEach-Object { ($_ -replace '.*msg="(JANELA [^"]*)".*', '$1') })
    # 0 = thresholds ok; 99 = algum threshold falhou (informação complementar); outro = o k6 não rodou direito.
    $thresholds = switch ($k6.Codigo) { 0 { 'ok' } 99 { 'falhou' } default { "erro do k6 (código $($k6.Codigo))" } }
    Write-Host "  thresholds do k6 (execução inteira): $thresholds"

    $args_ = @('tests/carga/janelas.js', "$dir/k6.json", '--saida', "$dir/veredito.json")
    if ($r.SemCriterio) { $args_ += '--sem-criterio' }
    $jan = Nativo 'node' $args_
    Gravar "$dir/veredito.txt" $jan.Saida
    $jan.Saida | ForEach-Object { Write-Host "  $_" }
    $resultados += @{ Nome = $r.Nome; Teste = $r.Teste; Thresholds = $thresholds; Janelas = $jan.Codigo; Veredito = ($jan.Saida | Where-Object { $_ -like 'VEREDITO*' }) }
  }
}
finally {
  Passo 'Restaurando a mitigação no worker (IMPORT_LOTE=100, IMPORT_PAUSA_MS=500)'
  try {
    RecriarImportacao $null $null
    $v = ValoresNoWorker
    $restaurado = ($v.Lote -eq $LotePadrao -and $v.Pausa -eq $PausaPadrao)
    if ($restaurado) { Write-Host "  OK: IMPORT_LOTE=$($v.Lote), IMPORT_PAUSA_MS=$($v.Pausa)" -ForegroundColor Green }
    else { Write-Host "  ATENÇÃO: o worker está com IMPORT_LOTE=$($v.Lote), IMPORT_PAUSA_MS=$($v.Pausa). Confira o .env e recrie o importacao." -ForegroundColor Red }
  }
  catch { Write-Host "  FALHA ao restaurar o worker: $_" -ForegroundColor Red; Write-Host '  Rode: docker compose up -d --force-recreate --wait importacao' -ForegroundColor Red }

  if (-not $ManterDados) {
    Passo 'Limpando os tenants do ensaio'
    try {
      $alvo = "SELECT DISTINCT tenant_id FROM orbita.usuarios WHERE email LIKE '%-$Execucao-%@carga.orbitati.dev'"
      # Espera as importações deles terminarem (até 2 min): apagar o tenant com job rodando deixaria linha órfã
      # em importacao.execucoes (I9 do docs/pendencias-bloco-7.md).
      $limite = (Get-Date).AddMinutes(2)
      while ([int](Sql "SELECT count(*) FROM orbita.importacoes WHERE status IN ('na_fila','processando') AND tenant_id IN ($alvo)") -gt 0 -and (Get-Date) -lt $limite) { Start-Sleep -Seconds 2 }
      $n = Sql "SELECT count(*) FROM ($alvo) t"
      # importacao.* primeiro: o ON DELETE CASCADE de orbita.tenants não chega lá (B1).
      Sql "BEGIN; CREATE TEMP TABLE alvo AS $alvo; DELETE FROM importacao.erros_linha WHERE tenant_id IN (SELECT tenant_id FROM alvo); DELETE FROM importacao.execucoes WHERE tenant_id IN (SELECT tenant_id FROM alvo); DELETE FROM orbita.tenants WHERE id IN (SELECT tenant_id FROM alvo); COMMIT;" | Out-Null
      Write-Host "  $n tenants apagados (com contatos, importações e o que ficou em importacao.*)"
    }
    catch { Write-Host "  FALHA na limpeza: $_" -ForegroundColor Red }
  }

  if ($RecursosProducao) {
    Passo 'Devolvendo o postgres ao normal (sem limite de CPU e memória)'
    try {
      RecriarPostgres -SemOverride
      $pg = LimitesPostgres
      if ($pg.Cpus -eq 0 -and $pg.MemoriaGiB -eq 0) { Write-Host '  OK: postgres sem limite e a API vê o banco' -ForegroundColor Green }
      else { $restaurado = $false; Write-Host "  ATENÇÃO: postgres ainda com $($pg.Cpus) CPU e $($pg.MemoriaGiB) GiB" -ForegroundColor Red }
    }
    catch {
      $restaurado = $false
      Write-Host "  FALHA ao devolver o postgres: $_" -ForegroundColor Red
      Write-Host '  Rode: docker compose up -d --no-deps --force-recreate --wait postgres' -ForegroundColor Red
    }
  }
}

Passo "Resumo ($Pasta)"
foreach ($x in $resultados) { Write-Host ("  {0} ({1}): {2} | thresholds do k6: {3}" -f $x.Nome, $x.Teste, $x.Veredito, $x.Thresholds) }
$com = $resultados | Where-Object { $_.Nome -eq 'com' }
if (-not $restaurado -or -not $com -or $com.Janelas -ne 0) { exit 1 }

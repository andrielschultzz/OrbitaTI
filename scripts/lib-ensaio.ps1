<#
  Funções comuns do bloco 11 (backup.ps1, ensaio-restauracao.ps1, restaurar-um-tenant.ps1).
  Carregado com ". $PSScriptRoot\lib-ensaio.ps1"; não é para rodar sozinho.

  Três cuidados valem para todos os scripts que usam isto:
  1. Arquivo binário (o dump) e CSV NUNCA passam pelo pipeline do PowerShell ("> arquivo"): o PS 5.1
     regrava a saída de programa como texto UTF-16 e corrompe o arquivo. Tudo é gravado DENTRO do
     contêiner e trazido com "docker cp".
  2. Toda consulta de verificação roda como superusuário (postgres). Qualquer outro papel está sujeito
     ao RLS e veria 0 linhas.
  3. SQL vai em arquivo (scripts/sql/), copiado para o contêiner. Passar SQL com aspas duplas como
     argumento de programa no PS 5.1 quebra a citação.
#>

$Utf8SemBom = New-Object Text.UTF8Encoding $false
$NomeEnsaio = 'postgres-ensaio'
$ImagemEnsaio = 'postgres:16-alpine'   # a mesma do docker-compose.yml

function Passo([string]$Titulo) { Write-Host ''; Write-Host "=== $Titulo ===" -ForegroundColor Cyan }

# Comando nativo: junta stdout e stderr como texto e devolve o código de saída (sem o NativeCommandError do PS 5).
function Nativo([string]$Exe, [string[]]$Argumentos) {
  $ErrorActionPreference = 'Continue'
  # Linha de stderr vem como ErrorRecord; uma linha vazia viraria o texto "RemoteException".
  $saida = & $Exe @Argumentos 2>&1 | ForEach-Object {
    if ($_ -is [Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
  } | Where-Object { $_ -ne '' }
  return @{ Codigo = $LASTEXITCODE; Saida = @($saida) }
}

function ExecDocker([string[]]$Argumentos) {
  $r = Nativo 'docker' $Argumentos
  if ($r.Codigo -ne 0) { throw "docker $($Argumentos -join ' ') falhou: $($r.Saida -join "`n")" }
  return $r.Saida
}

# Id do contêiner do postgres do compose (a ORIGEM).
function ContainerOrigem {
  $id = ((ExecDocker @('compose', 'ps', '-q', 'postgres')) -join '').Trim()
  if (-not $id) { throw 'o postgres do compose não está no ar (docker compose up -d --wait postgres)' }
  return $id
}

# Roda um arquivo .sql como postgres no contêiner dado. $Variaveis vira "-v nome=valor" (o psql cita com
# :'nome' dentro do SQL, sem colar texto no comando).
function SqlArquivo([string]$Container, [string]$Arquivo, [hashtable]$Variaveis = @{}) {
  ExecDocker @('cp', $Arquivo, "${Container}:/tmp/orbitati-script.sql") | Out-Null
  $argumentos = @('exec', $Container, 'psql', '-U', 'postgres', '-d', 'orbitati', '-v', 'ON_ERROR_STOP=1', '-At')
  foreach ($k in $Variaveis.Keys) { $argumentos += @('-v', "$k=$($Variaveis[$k])") }
  $argumentos += @('-f', '/tmp/orbitati-script.sql')
  return ExecDocker $argumentos
}

# Foto do banco (scripts/sql/estado-banco.sql). Recusa se não rodou como superusuário.
function FotoDoBanco([string]$Container) {
  $linhas = @(SqlArquivo $Container (Join-Path $PSScriptRoot 'sql/estado-banco.sql') | Where-Object { $_ -ne '' })
  if ($linhas[0] -ne 'superusuario|postgres|true') {
    throw "a foto do banco não rodou como superusuário ($($linhas[0])): com RLS as contagens dariam 0"
  }
  return $linhas
}

function Sha256([string]$Arquivo) { return (Get-FileHash -Algorithm SHA256 -Path $Arquivo).Hash.ToLower() }

function SenhaAleatoria { return ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) }

# Sobe o postgres-ensaio: contêiner separado, SEM porta publicada e FORA da rede do compose (nada da
# stack alcança a cópia). Os papéis são criados pelo MESMO db/init/01-papeis.sh da produção, com senhas
# aleatórias de descarte. Por que não pg_dumpall --globals-only: ele traria os hashes das senhas reais para
# o ensaio; e usar o script do repositório prova que ele basta para reconstruir o banco do zero.
function SubirEnsaio {
  RemoverEnsaio
  $init = (Resolve-Path (Join-Path $PSScriptRoot '..\db\init')).Path
  ExecDocker @('run', '-d', '--name', $NomeEnsaio,
    '-e', 'POSTGRES_DB=orbitati',
    '-e', "POSTGRES_PASSWORD=$(SenhaAleatoria)",
    '-e', "DB_SENHA_MIGRADOR=$(SenhaAleatoria)",
    '-e', "DB_SENHA_API=$(SenhaAleatoria)",
    '-e', "DB_SENHA_IMPORTACAO=$(SenhaAleatoria)",
    '-v', "${init}:/docker-entrypoint-initdb.d:ro",
    $ImagemEnsaio) | Out-Null
  # -h 127.0.0.1, como no healthcheck do compose: durante o init o servidor só aceita socket local, então
  # o TCP responder quer dizer que o db/init já rodou e o servidor reiniciou para valer.
  $limite = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    $r = Nativo 'docker' @('exec', $NomeEnsaio, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'orbitati')
  } while ($r.Codigo -ne 0 -and (Get-Date) -lt $limite)
  if ($r.Codigo -ne 0) {
    $log = (Nativo 'docker' @('logs', '--tail', '30', $NomeEnsaio)).Saida -join "`n"
    throw "o postgres-ensaio não ficou pronto em 90 s:`n$log"
  }
  $log = (Nativo 'docker' @('logs', $NomeEnsaio)).Saida -join "`n"
  if ($log -notmatch 'OrbitaTI: pap') { throw 'o db/init/01-papeis.sh não rodou no postgres-ensaio' }
}

# Restaura o dump na cópia: --exit-on-error + --single-transaction = ou volta tudo, ou nada (um OWNER TO
# para papel inexistente pararia aqui, em vez de deixar a cópia pela metade).
function RestaurarNoEnsaio([string]$Dump) {
  ExecDocker @('cp', $Dump, "${NomeEnsaio}:/tmp/orbitati.dump") | Out-Null
  ExecDocker @('exec', $NomeEnsaio, 'pg_restore', '-U', 'postgres', '-d', 'orbitati',
    '--exit-on-error', '--single-transaction', '/tmp/orbitati.dump') | Out-Null
  ExecDocker @('exec', $NomeEnsaio, 'rm', '-f', '/tmp/orbitati.dump') | Out-Null
}

function RemoverEnsaio {
  # -v: apaga também o volume anônimo do PGDATA. A cópia tem dado pessoal; não pode sobrar no disco.
  Nativo 'docker' @('rm', '-f', '-v', $NomeEnsaio) | Out-Null
}

# Último backup completo de backups/ (o dump e a foto da origem tirada junto com ele).
function UltimoBackup([string]$Pasta) {
  $dump = Get-ChildItem -Path $Pasta -Filter 'orbitati-*.dump' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $dump) { throw "nenhum backup em $Pasta (rode scripts/backup.ps1)" }
  $base = $dump.FullName -replace '\.dump$', ''
  foreach ($f in @("$base.estado.txt", "$base.sha256")) {
    if (-not (Test-Path $f)) { throw "backup incompleto: falta $f" }
  }
  return @{ Dump = $dump.FullName; Estado = "$base.estado.txt"; Sha = "$base.sha256"; Nome = $dump.Name }
}

<#
.SYNOPSIS
  Backup do banco orbitati (CQ-05, bloco 11): pg_dump em formato custom em backups/.

.DESCRIPTION
  Gera, em backups/ (fora do git: tem dado pessoal dos contatos):
    orbitati-AAAAMMDD-HHMMSS.dump        pg_dump -Fc do banco inteiro (dados, schemas, RLS, GRANT)
    orbitati-AAAAMMDD-HHMMSS.estado.txt  foto da origem (scripts/sql/estado-banco.sql): linhas por tabela,
                                         RLS, políticas, papéis, donos, GRANT. O ensaio compara a cópia com ela
    orbitati-AAAAMMDD-HHMMSS.sha256      hash do dump: o ensaio recusa um arquivo corrompido

  O pg_dump roda como postgres (superusuário). Com papel sujeito ao RLS ele aborta: o pg_dump liga
  row_security=off e, sem poder ignorar o RLS, recusa em vez de gerar uma cópia sem as linhas de tenant.

  Por que a foto é tirada ANTES e DEPOIS do dump: o pg_dump lê de um snapshot, mas a contagem é outra
  consulta. Se alguém gravar no meio, a foto não descreveria o dump. Antes = depois prova que nada mudou;
  se mudou, o script apaga o par e pede para rodar de novo, sem tráfego de escrita.

  O pg_dump não leva os papéis (são globais do servidor). Quem os recria na cópia é o db/init/01-papeis.sh.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
#>
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\lib-ensaio.ps1"

$Pasta = Join-Path (Get-Location) 'backups'
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
$Nome = "orbitati-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$Dump = Join-Path $Pasta "$Nome.dump"
$Estado = Join-Path $Pasta "$Nome.estado.txt"
$Sha = Join-Path $Pasta "$Nome.sha256"
$Origem = ContainerOrigem
$relogio = [Diagnostics.Stopwatch]::StartNew()

try {
  Passo 'Foto da origem (antes)'
  $antes = FotoDoBanco $Origem
  $antes | Where-Object { $_ -like 'contagem|*' } | ForEach-Object { Write-Host "  $_" }

  Passo 'pg_dump -Fc (como postgres, gravado dentro do contêiner)'
  ExecDocker @('exec', $Origem, 'pg_dump', '-U', 'postgres', '-d', 'orbitati', '-Fc', '-f', '/tmp/orbitati-backup.dump') | Out-Null
  ExecDocker @('cp', "${Origem}:/tmp/orbitati-backup.dump", $Dump) | Out-Null
  ExecDocker @('exec', $Origem, 'rm', '-f', '/tmp/orbitati-backup.dump') | Out-Null

  Passo 'Foto da origem (depois)'
  $depois = FotoDoBanco $Origem
  if (($antes -join "`n") -ne ($depois -join "`n")) {
    $dif = Compare-Object $antes $depois | ForEach-Object { "  $($_.SideIndicator) $($_.InputObject)" }
    throw "a origem mudou durante o backup; rode de novo sem tráfego de escrita:`n$($dif -join "`n")"
  }
  [IO.File]::WriteAllLines($Estado, [string[]]$antes, $Utf8SemBom)
  [IO.File]::WriteAllText($Sha, "$(Sha256 $Dump)  $Nome.dump`n", $Utf8SemBom)
} catch {
  Remove-Item -Force -ErrorAction SilentlyContinue $Dump, $Estado, $Sha
  throw
}

$relogio.Stop()
$tamanho = (Get-Item $Dump).Length
Passo 'Backup pronto'
Write-Host ("  {0}  ({1:N1} KB)" -f $Dump, ($tamanho / 1KB))
Write-Host "  $Estado"
Write-Host "  sha256 $((Get-Content $Sha).Split(' ')[0])"
Write-Host ("  duração: {0:N1} s" -f $relogio.Elapsed.TotalSeconds)

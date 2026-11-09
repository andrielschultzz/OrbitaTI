<#
.SYNOPSIS
  Ensaio de restauração do CQ-05 (bloco 11): restaura o último backup num Postgres separado, confere a
  integridade e cronometra cada etapa para comparar com o RTO de 4 h.

.DESCRIPTION
  Etapas (cada uma cronometrada):
    1. conferir o backup     sha256 do dump igual ao gravado pelo backup.ps1
    2. subir o ensaio        postgres:16-alpine "postgres-ensaio", sem porta, fora da rede do compose,
                             com os papéis criados pelo db/init/01-papeis.sh (senhas aleatórias)
    3. restaurar             pg_restore --exit-on-error --single-transaction
    4. verificar             foto da cópia (scripts/sql/estado-banco.sql, como postgres) x foto da origem
                             tirada no backup, item por item, e as regras absolutas:
                             - linhas por tabela iguais às da origem
                             - mesmas políticas (texto das expressões) e ENABLE + FORCE em todas as tabelas
                             - toda tabela com tenant_id com RLS e política
                             - migrador, api_contatos, importacao_svc: sem BYPASSRLS e sem SUPERUSER
                             - orbita_auth: BYPASSRLS e NOLOGIN (é a decisão, regra 6)
                             - buscar_credencial com dono orbita_auth e sem EXECUTE para PUBLIC
                             - mesmos donos e GRANT; importacao_svc sem nenhum GRANT em orbita
    5. remover o ensaio      docker rm -f -v (a cópia tem dado pessoal; o volume vai junto)
  A etapa 5 roda SEMPRE (finally), mesmo com erro ou Ctrl+C.

  O que o ensaio NÃO mede: o RPO (precisa de arquivamento contínuo de WAL, recurso do banco gerenciado),
  nem provisionar a máquina e reapontar a API para o banco novo (ver docs/ensaios/cq05-*.md).

  Termina com código 1 se qualquer verificação falhar.

.PARAMETER SemPapeis
  Prova do cuidado com os papéis: sobe a cópia SEM o db/init. O restore TEM de falhar (OWNER TO e GRANT
  para papéis que não existem). Se passar, o ensaio está errado.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\ensaio-restauracao.ps1
#>
param([switch]$SemPapeis)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\lib-ensaio.ps1"

$Tempos = [ordered]@{}
$Falhas = New-Object Collections.Generic.List[string]
function Cronometrar([string]$Etapa, [scriptblock]$Bloco) {
  Passo $Etapa
  $r = [Diagnostics.Stopwatch]::StartNew()
  try { & $Bloco } finally { $r.Stop(); $Tempos[$Etapa] = $r.Elapsed.TotalSeconds }
  Write-Host ("  {0:N1} s" -f $Tempos[$Etapa])
}
function Conferir([string]$Item, [bool]$Ok, [string]$Detalhe = '') {
  if ($Ok) { Write-Host "  OK     $Item" -ForegroundColor Green }
  else { Write-Host "  FALHA  $Item $Detalhe" -ForegroundColor Red; $Falhas.Add("$Item $Detalhe") }
}

$Backup = UltimoBackup (Join-Path (Get-Location) 'backups')
Write-Host "Backup: $($Backup.Nome)"
$inicio = Get-Date

try {
  Cronometrar '1. conferir o backup' {
    $esperado = ((Get-Content $Backup.Sha -Raw).Trim() -split '\s+')[0]
    $atual = Sha256 $Backup.Dump
    if ($atual -ne $esperado) { throw "sha256 do dump não confere ($atual x $esperado): arquivo corrompido" }
    Write-Host "  sha256 confere ($atual)"
  }

  Cronometrar '2. subir o postgres-ensaio' {
    if ($SemPapeis) {
      RemoverEnsaio
      ExecDocker @('run', '-d', '--name', $NomeEnsaio, '-e', 'POSTGRES_DB=orbitati',
        '-e', "POSTGRES_PASSWORD=$(SenhaAleatoria)", $ImagemEnsaio) | Out-Null
      $limite = (Get-Date).AddSeconds(90)
      do {
        Start-Sleep -Milliseconds 500
        $r = Nativo 'docker' @('exec', $NomeEnsaio, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'orbitati')
      } while ($r.Codigo -ne 0 -and (Get-Date) -lt $limite)
      Write-Host '  SEM os papéis (-SemPapeis): o restore tem de falhar'
    } else {
      SubirEnsaio
      Write-Host '  papéis criados pelo db/init/01-papeis.sh'
    }
  }

  if ($SemPapeis) {
    Passo '3. restaurar (sem os papéis)'
    $r = Nativo 'docker' @('cp', $Backup.Dump, "${NomeEnsaio}:/tmp/orbitati.dump")
    $r = Nativo 'docker' @('exec', $NomeEnsaio, 'pg_restore', '-U', 'postgres', '-d', 'orbitati',
      '--exit-on-error', '--single-transaction', '/tmp/orbitati.dump')
    $r.Saida | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" }
    Conferir 'restore sem os papéis falha (cuidado 1)' ($r.Codigo -ne 0) '(o restore passou: o ensaio não detectaria papéis faltando)'
    $n = (Nativo 'docker' @('exec', $NomeEnsaio, 'psql', '-U', 'postgres', '-d', 'orbitati', '-At', '-c',
        "SELECT count(*) FROM pg_namespace WHERE nspname = 'orbita'")).Saida -join ''
    Conferir 'single-transaction: nada ficou pela metade (schema orbita ausente)' ($n.Trim() -eq '0') "(schemas orbita: $n)"
  } else {

  Cronometrar '3. restaurar (pg_restore)' { RestaurarNoEnsaio $Backup.Dump }

  Cronometrar '4. verificar a integridade' {
    $origem = @(Get-Content $Backup.Estado -Encoding UTF8 | Where-Object { $_ -ne '' })
    $copia = @(FotoDoBanco $NomeEnsaio)
    Conferir 'foto da cópia tirada como superusuário (contagens não são 0 por causa do RLS)' $true

    # Comparação item a item com a origem, por seção.
    foreach ($secao in @('contagem', 'rls', 'tabela_tenant', 'politica', 'papel', 'dono', 'funcao_login', 'grant')) {
      $o = @($origem | Where-Object { $_ -like "$secao|*" })
      $c = @($copia | Where-Object { $_ -like "$secao|*" })
      $dif = @(Compare-Object $o $c | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" })
      Conferir ("{0,-13} igual à origem ({1} itens)" -f $secao, $o.Count) (($dif.Count -eq 0) -and ($o.Count -gt 0)) ("`n    " + ($dif -join "`n    "))
    }
    $copia | Where-Object { $_ -like 'contagem|*' } | ForEach-Object {
      $p = $_ -split '\|'; Write-Host ("         {0,-28} {1,6} linhas" -f $p[1], $p[2])
    }
    $totalTenant = ($copia | Where-Object { $_ -like 'contagem|orbita.*' } | ForEach-Object { [int](($_ -split '\|')[2]) } | Measure-Object -Sum).Sum
    Conferir "há linhas de tenant para comparar ($totalTenant em orbita)" ($totalTenant -gt 0) '(origem vazia: a comparação não prova nada)'

    # Regras absolutas (valem mesmo se a origem estivesse errada).
    $semForce = @($copia | Where-Object { $_ -like 'rls|*' -and $_ -notlike '*|enable=true,force=true' })
    Conferir 'ENABLE + FORCE em todas as tabelas de orbita e importacao' ($semForce.Count -eq 0) ($semForce -join '; ')
    $semPolitica = @($copia | Where-Object { $_ -like 'tabela_tenant|*' -and $_ -notlike '*|ok' })
    Conferir 'toda tabela com tenant_id tem RLS e política' ($semPolitica.Count -eq 0) ($semPolitica -join '; ')
    foreach ($papel in @('migrador', 'api_contatos', 'importacao_svc')) {
      $l = $copia | Where-Object { $_ -like "papel|$papel|*" }
      Conferir "$papel sem BYPASSRLS e sem SUPERUSER" ($l -like '*bypassrls=false,superuser=false') "($l)"
    }
    $l = $copia | Where-Object { $_ -like 'papel|orbita_auth|*' }
    Conferir 'orbita_auth com BYPASSRLS e NOLOGIN (decisão da regra 6)' ($l -eq 'papel|orbita_auth|login=false,bypassrls=true,superuser=false') "($l)"
    $f = $copia | Where-Object { $_ -like 'funcao_login|*' }
    # No ACL do Postgres, PUBLIC aparece como grantee vazio: "{=X/dono,...}" ou ",=X/dono".
    Conferir 'buscar_credencial: dono orbita_auth, sem EXECUTE para PUBLIC' (($f -like '*dono=orbita_auth,*') -and ($f -notmatch '[{,]=X/')) "($f)"
    $grantOrbita = @($copia | Where-Object { $_ -like 'grant|orbita.*.importacao_svc|*' })
    Conferir 'importacao_svc sem nenhum GRANT em orbita' ($grantOrbita.Count -eq 0) ($grantOrbita -join '; ')
  }
  }
} finally {
  if (-not $SemPapeis) {
    Cronometrar '5. remover o postgres-ensaio' { RemoverEnsaio }
  } else { RemoverEnsaio }
  $sobrou = (Nativo 'docker' @('ps', '-a', '-q', '--filter', "name=^$NomeEnsaio$")).Saida -join ''
  if ($sobrou.Trim()) { Write-Host "ATENÇÃO: o contêiner $NomeEnsaio não foi removido (docker rm -f -v $NomeEnsaio)" -ForegroundColor Red }
}

Passo 'Resultado'
if (-not $SemPapeis) {
  $total = ((Get-Date) - $inicio).TotalSeconds
  foreach ($k in $Tempos.Keys) { Write-Host ("  {0,-30} {1,8:N1} s" -f $k, $Tempos[$k]) }
  Write-Host ("  {0,-30} {1,8:N1} s  (RTO do CQ-05: 4 h = 14.400 s)" -f 'total', $total)
}
if ($Falhas.Count -gt 0) {
  Write-Host "REPROVADO: $($Falhas.Count) verificação(ões) falharam" -ForegroundColor Red
  exit 1
}
if ($SemPapeis) { Write-Host 'APROVADO (prova negativa): sem os papéis o restore falha e não deixa nada pela metade' -ForegroundColor Green }
else { Write-Host 'APROVADO: todas as verificações passaram' -ForegroundColor Green }

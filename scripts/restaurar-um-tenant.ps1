<#
.SYNOPSIS
  Restaura UM tenant a partir do último backup (bloco 11): o procedimento que o ADR-001 prometeu documentar.

.DESCRIPTION
  No modelo pool (ADR-001) não dá para "devolver o banco de um cliente": todos estão nas mesmas tabelas.
  O caminho é: restaurar o backup inteiro numa cópia separada, extrair só as linhas daquele tenant e o
  próprio tenant reimportar pelo Portal, pelo fluxo normal (RLS, validação, upsert sem duplicar).

  Passos:
    1. confere o sha256 do último backup e sobe o postgres-ensaio com ele restaurado (lib-ensaio.ps1)
    2. acha o tenant pelo e-mail (tem de ser admin) na CÓPIA, nunca na produção
    3. extrai como api_contatos com app.tenant_id (o RLS filtra) E com WHERE tenant_id (scripts/sql/extrair-tenant.sql)
    4. remove o contêiner (finally) e grava em backups/tenant-<id>-<data-hora>/:
         contatos-reimportar-parte-NN.csv   modelo de importação: nome;email;telefone;empresa;observacao,
                                            separador ";", UTF-8 com BOM. Dividido pelo limite do plano
                                            (linhas por importação e 1 MB, lidos do planos.js)
         contatos-sem-email.csv             não voltam pela importação (o e-mail é a chave): recadastro manual
         importacoes.csv                    histórico de importações (só consulta; não se reimporta)

  Limites desse caminho (docs/ensaios/cq05-*.md):
    - contato sem e-mail não volta pela importação;
    - Individual aceita 100 linhas por importação (por isso as partes), Equipe 5.000;
    - a API conta LINHAS FÍSICAS não vazias (contrato, seção 7): observação com quebra de linha conta 2;
    - criado_em, ultima_interacao_em e o id do contato não voltam (a importação cria ou atualiza);
    - se o contato ainda existe, a reimportação ATUALIZA o nome e preenche o que estiver vazio, mas célula
      vazia não apaga telefone, empresa ou observação que já existam.

  backups/ está no .gitignore: estes CSVs têm dado pessoal dos contatos (o OrbitaTI é OPERADOR, lgpd.md).
  Entregue ao cliente por canal seguro e apague depois.

.PARAMETER Email
  E-mail de um usuário ADMIN do tenant (é quem pede a restauração).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\restaurar-um-tenant.ps1 -Email marcelo@devsolo.dev
#>
param([Parameter(Mandatory = $true)][string]$Email)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\lib-ensaio.ps1"

# O e-mail vai como variável do psql (citado com :'email'); ainda assim, só aceita formato de e-mail.
$Email = $Email.Trim().ToLower()
if ($Email -notmatch '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$') { throw "e-mail inválido: $Email" }

# Limites do plano lidos da ÚNICA fonte (services/api-contatos/src/planos.js), sem copiar números.
$planosJs = (Resolve-Path 'services/api-contatos/src/planos.js').Path
$url = ([Uri]$planosJs).AbsoluteUri
$r = Nativo 'node' @('--input-type=module', '-e', "import('$url').then(m => console.log(JSON.stringify(m.PLANOS)))")
if ($r.Codigo -ne 0) { throw "não consegui ler o planos.js: $($r.Saida -join ' ')" }
$Planos = ($r.Saida -join '') | ConvertFrom-Json

$Backup = UltimoBackup (Join-Path (Get-Location) 'backups')
$relogio = [Diagnostics.Stopwatch]::StartNew()
$Temp = Join-Path ([IO.Path]::GetTempPath()) "orbitati-extracao-$([guid]::NewGuid().ToString('N'))"

try {
  Passo "Cópia restaurada de $($Backup.Nome)"
  $esperado = ((Get-Content $Backup.Sha -Raw).Trim() -split '\s+')[0]
  if ((Sha256 $Backup.Dump) -ne $esperado) { throw 'sha256 do dump não confere: arquivo corrompido' }
  SubirEnsaio
  RestaurarNoEnsaio $Backup.Dump
  Write-Host '  restaurado no postgres-ensaio (sem porta, fora da rede do compose)'

  Passo 'Tenant'
  $achado = @(SqlArquivo $NomeEnsaio 'scripts/sql/buscar-tenant.sql' @{ email = $Email } | Where-Object { $_ -ne '' })
  if ($achado.Count -ne 1) { throw "nenhum usuário com o e-mail $Email no backup" }
  $TenantId, $Plano, $Papel = $achado[0] -split '\|'
  if ($Papel -ne 'admin') { throw "$Email é $Papel, não admin: só o admin do tenant pede a restauração" }
  $Limites = $Planos.$Plano.limites
  Write-Host "  tenant $TenantId, plano $Plano ($($Limites.linhas_por_importacao) linhas e $($Limites.tamanho_maximo_csv_bytes) bytes por importação)"

  Passo 'Extração (api_contatos + app.tenant_id: o RLS filtra; e WHERE tenant_id)'
  ExecDocker @('exec', $NomeEnsaio, 'mkdir', '-p', '/tmp/extracao') | Out-Null
  $saida = @(SqlArquivo $NomeEnsaio 'scripts/sql/extrair-tenant.sql' @{ tenant = $TenantId } | Where-Object { $_ -match '^\w+\|\d+$' })
  $n = @{}; foreach ($l in $saida) { $k, $v = $l -split '\|'; $n[$k] = [int]$v }
  if ($n['visiveis_de_outros_tenants'] -ne 0) { throw "o RLS deixou ver $($n['visiveis_de_outros_tenants']) contatos de outros tenants: extração abortada" }
  Write-Host "  com e-mail: $($n['contatos_com_email'])  sem e-mail: $($n['contatos_sem_email'])  importações: $($n['importacoes'])"
  Write-Host '  contatos de outros tenants visíveis na sessão de extração: 0 (o RLS segurou)'
  New-Item -ItemType Directory -Force -Path $Temp | Out-Null
  ExecDocker @('cp', "${NomeEnsaio}:/tmp/extracao/.", $Temp) | Out-Null
} finally {
  RemoverEnsaio
}

# ---- Grava os CSVs: UTF-8 com BOM (o Excel em português abre com acento) e o reimportar em partes ----
$Bom = [byte[]](0xEF, 0xBB, 0xBF)
$Destino = Join-Path (Get-Location) "backups/tenant-$TenantId-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
function GravarComBom([string]$Arquivo, [string]$Texto) {
  $bytes = $Utf8SemBom.GetBytes($Texto)
  [IO.File]::WriteAllBytes($Arquivo, [byte[]]($Bom + $bytes))
}

foreach ($f in @('contatos-sem-email.csv', 'importacoes.csv')) {
  GravarComBom (Join-Path $Destino $f) ([IO.File]::ReadAllText((Join-Path $Temp $f), $Utf8SemBom))
}

# Registros do CSV: um registro termina no fim de linha quando o número de aspas acumulado é par (aspas
# dentro de campo vêm dobradas, ""). Assim uma observação com quebra de linha nunca é cortada ao meio.
$texto = [IO.File]::ReadAllText((Join-Path $Temp 'contatos-reimportar.csv'), $Utf8SemBom)
$linhas = $texto.TrimEnd("`n") -split "`n"
$cabecalho = $linhas[0]
$registros = New-Object Collections.Generic.List[object]
$atual = ''; $fisicas = 0
foreach ($l in ($linhas | Select-Object -Skip 1)) {
  $atual = if ($fisicas -eq 0) { $l } else { "$atual`n$l" }
  $fisicas++
  if ((($atual.ToCharArray() | Where-Object { $_ -eq '"' }) | Measure-Object).Count % 2 -eq 0) {
    $registros.Add(@{ Texto = $atual; Linhas = $fisicas; Bytes = $Utf8SemBom.GetByteCount($atual) + 1 })
    $atual = ''; $fisicas = 0
  }
}
if ($fisicas -ne 0) { throw 'CSV extraído terminou no meio de um campo entre aspas' }
if ($registros.Count -ne $n['contatos_com_email']) { throw "o CSV tem $($registros.Count) registros, o banco $($n['contatos_com_email'])" }

# Partes: no máximo linhas_por_importacao LINHAS FÍSICAS (é o que a API conta) e tamanho_maximo_csv_bytes.
$maxLinhas = [int]$Limites.linhas_por_importacao
$maxBytes = [int]$Limites.tamanho_maximo_csv_bytes - 3 - ($Utf8SemBom.GetByteCount($cabecalho) + 1)
$partes = New-Object Collections.Generic.List[object]
$parte = New-Object Collections.Generic.List[string]; $pl = 0; $pb = 0
foreach ($reg in $registros) {
  if ($reg.Linhas -gt $maxLinhas) { throw 'um único contato passa do limite de linhas do plano' }
  if ($parte.Count -gt 0 -and (($pl + $reg.Linhas) -gt $maxLinhas -or ($pb + $reg.Bytes) -gt $maxBytes)) {
    $partes.Add($parte); $parte = New-Object Collections.Generic.List[string]; $pl = 0; $pb = 0
  }
  $parte.Add($reg.Texto); $pl += $reg.Linhas; $pb += $reg.Bytes
}
if ($parte.Count -gt 0) { $partes.Add($parte) }
for ($i = 0; $i -lt $partes.Count; $i++) {
  $arquivo = Join-Path $Destino ('contatos-reimportar-parte-{0:D2}.csv' -f ($i + 1))
  GravarComBom $arquivo (($cabecalho + "`n" + ($partes[$i] -join "`n")) + "`n")
}
Remove-Item -Recurse -Force $Temp

$relogio.Stop()
Passo 'Pronto'
Get-ChildItem $Destino | ForEach-Object { Write-Host ("  {0,-36} {1,8:N1} KB" -f $_.Name, ($_.Length / 1KB)) }
Write-Host "  pasta: $Destino"
Write-Host ("  duração: {0:N1} s" -f $relogio.Elapsed.TotalSeconds)
Write-Host ''
Write-Host "Reimportação: o admin entra no Portal e importa as $($partes.Count) parte(s), uma por vez (o plano $Plano aceita"
Write-Host "$($Limites.importacoes_simultaneas) importações simultâneas). O upsert por e-mail não duplica quem já existe."
if ($n['contatos_sem_email'] -gt 0) {
  Write-Host "ATENÇÃO: $($n['contatos_sem_email']) contato(s) sem e-mail NÃO voltam pela importação (contatos-sem-email.csv): recadastro manual." -ForegroundColor Yellow
}
Write-Host 'Dado pessoal (LGPD): entregue por canal seguro e apague a pasta depois.' -ForegroundColor Yellow

<#
.SYNOPSIS
  Publica o OrbitaTI no cluster kind "saas" (bloco 6): build, kind load, apply, migração, rollout, seed.

.DESCRIPTION
  1. Confere kind, kubectl, docker, o .env e o cluster "saas"; usa o contexto kind-saas.
  2. Build das imagens com tag fixa 0.1.0 (pelo docker compose, que já tem os parâmetros de build).
  3. kind load docker-image das 4 imagens nossas. Postgres, Redis e Mailpit o nó baixa sozinho.
  4. Cria o namespace orbitati e, SÓ SE NÃO EXISTIR, o Secret orbitati-segredos a partir do .env.
     Nenhum valor do Secret é impresso.
  5. Gera o ConfigMap postgres-init de db/init/01-papeis.sh, aplica postgres e redis e espera os dois.
  6. Recria o Job de migração e espera terminar (se falhar, mostra o log e para).
  7. Aplica api-contatos, importacao, mailpit e notificacoes (bloco 10) e faz rollout restart: com tag
     fixa e IfNotPresent, o pod não troca de imagem sozinho depois de um rebuild; o restart cria pods
     novos com a imagem recém-carregada.
  8. Roda o seed contra http://localhost:30080 e mostra /saude e os pods.

  Este script NUNCA apaga namespace nem PVC. Reset total (APAGA o banco, equivale ao
  `docker compose down -v`): kubectl delete namespace orbitati

.PARAMETER SemBuild
  Pula o build e o kind load (útil quando só os manifests mudaram).

.PARAMETER SemSeed
  Pula o seed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\deploy-kind.ps1
#>
param(
  [switch]$SemBuild,
  [switch]$SemSeed
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$Raiz = Split-Path -Parent $PSScriptRoot
$K8s = Join-Path $Raiz 'deploy\k8s'
$Cluster = 'saas'
$Contexto = "kind-$Cluster"
$Ns = 'orbitati'
$Url = 'http://localhost:30080'
# Só as NOSSAS imagens passam pelo kind load. As de terceiros (postgres, redis e, no bloco 10, o Mailpit
# v1.32.0) o nó baixa sozinho do Docker Hub: o kind load de imagem multiplataforma vinda do Docker Desktop
# falha ("ctr: content digest ... not found", testado com o Mailpit em 08/11/2026).
$Imagens = @('orbitati/migrate:0.1.0', 'orbitati/api-contatos:0.1.0', 'orbitati/importacao:0.1.0', 'orbitati/notificacoes:0.1.0')

function Passo([string]$Titulo) {
  Write-Host ''
  Write-Host "=== $Titulo ===" -ForegroundColor Cyan
}

# Roda um comando externo e para o script se ele falhar (o $ErrorActionPreference não vale para .exe).
# Função simples, sem param(): numa função avançada o PowerShell trataria "-o" ou "-n" do kubectl como
# parâmetros dele mesmo (-OutVariable...). Aqui tudo vai para o $args sem interpretação.
function Rodar {
  $exe, $resto = $args
  & $exe @resto
  if ($LASTEXITCODE -ne 0) { throw "Falhou ($LASTEXITCODE): $exe $($resto -join ' ')" }
}

function Kube { Rodar kubectl --context $Contexto -n $Ns @args }

Push-Location $Raiz
try {
  Passo '1. Ambiente'
  foreach ($exe in 'kind', 'kubectl', 'docker') {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { throw "$exe não encontrado no PATH." }
  }
  if (-not (Test-Path (Join-Path $Raiz '.env'))) { throw 'Falta o .env na raiz. Rode: npm run env' }
  $clusters = & kind get clusters
  if ($clusters -notcontains $Cluster) { throw "Cluster kind '$Cluster' não existe." }
  Write-Host "Cluster $Cluster ok; contexto $Contexto."

  if (-not $SemBuild) {
    Passo '2. Build das imagens (tag 0.1.0)'
    Rodar docker compose build migrate api-contatos importacao notificacoes

    Passo '3. kind load'
    foreach ($img in $Imagens) { Rodar kind load docker-image $img --name $Cluster }
  }

  Passo '4. Namespace e Secret'
  Rodar kubectl --context $Contexto apply -f (Join-Path $K8s '00-namespace.yaml')
  # -o name: só o nome do objeto, nunca o conteúdo do Secret.
  $secret = & kubectl --context $Contexto -n $Ns get secret orbitati-segredos --ignore-not-found -o name
  if ($secret) {
    Write-Host 'Secret orbitati-segredos já existe (mantido). Mudou o .env? Apague o Secret e rode de novo.'
  } else {
    Kube create secret generic orbitati-segredos --from-env-file=.env
  }

  Passo '5. Postgres e Redis'
  # Recria o ConfigMap a partir do arquivo do repositório (sem cópia versionada). Só tem efeito no
  # primeiro boot do Postgres, com o volume vazio.
  Kube delete configmap postgres-init --ignore-not-found
  Kube create configmap postgres-init --from-file=db/init/01-papeis.sh
  Kube apply -f (Join-Path $K8s '10-postgres.yaml') -f (Join-Path $K8s '20-redis.yaml')
  Kube rollout status statefulset/postgres --timeout=180s
  Kube rollout status deployment/redis --timeout=120s

  Passo '6. Migrações'
  # Job concluído não roda de novo e não aceita spec alterado: apaga e cria de novo (migrate.js é idempotente).
  Kube delete job migrate --ignore-not-found
  Kube apply -f (Join-Path $K8s '30-migrate-job.yaml')
  & kubectl --context $Contexto -n $Ns wait --for=condition=complete job/migrate --timeout=180s
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Migração não terminou. Log do Job:' -ForegroundColor Red
    & kubectl --context $Contexto -n $Ns logs job/migrate --tail=50
    Write-Host 'Senha recusada? As senhas dos papéis só valem no PRIMEIRO boot do Postgres. Reset total (APAGA o banco):' -ForegroundColor Yellow
    Write-Host '  kubectl delete namespace orbitati' -ForegroundColor Yellow
    throw 'Job de migração falhou.'
  }
  Kube logs job/migrate --tail=20

  Passo '7. API, workers e Mailpit'
  Kube apply -f (Join-Path $K8s '40-api-contatos.yaml') -f (Join-Path $K8s '50-importacao.yaml') `
    -f (Join-Path $K8s '55-mailpit.yaml') -f (Join-Path $K8s '60-notificacoes.yaml')
  # Tag fixa + IfNotPresent: sem o restart, pods antigos continuariam com a imagem anterior.
  # (O Mailpit tem versão fixa de terceiros: não precisa de restart.)
  Kube rollout restart deployment/api-contatos deployment/importacao deployment/notificacoes
  Kube rollout status deployment/mailpit --timeout=120s
  Kube rollout status deployment/api-contatos --timeout=180s
  Kube rollout status deployment/importacao --timeout=180s
  Kube rollout status deployment/notificacoes --timeout=180s

  if (-not $SemSeed) {
    Passo "8. Seed ($Url)"
    $env:SEED_URL = $Url
    try { Rodar npm run seed } finally { Remove-Item Env:SEED_URL -ErrorAction SilentlyContinue }
  }

  Passo 'Resultado'
  Kube get pods -o wide
  Write-Host ''
  Write-Host "GET $Url/saude"
  & curl.exe -s "$Url/saude"
  Write-Host ''
} finally {
  Pop-Location
}

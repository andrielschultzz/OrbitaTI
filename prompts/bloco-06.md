# Bloco 6 — Deploy no kind

Objetivo: publicar o OrbitaTI no cluster kind "saas" (Docker Desktop no Windows),
como no Lab 04: alterar -> aplicar -> verificar.

Faça em deploy/k8s/ (namespace orbitati):
1. postgres: StatefulSet com PVC de 1Gi, init script vindo de um ConfigMap gerado de
   db/init/01-papeis.sh, Service "postgres".
2. redis: Deployment + Service "redis".
3. migrate: Job que roda db/migrate.js (crie uma imagem orbitati/migrate a partir da raiz,
   ou inclua db/ na imagem da API — escolha a mais simples e explique).
4. api-contatos: Deployment com 2 réplicas, readiness e liveness em /saude,
   requests/limits pequenos (como no Lab 04), Service NodePort 30080.
5. importacao: Deployment com 1 réplica.
6. Segredos: NÃO versionar valores. Gere o Secret a partir do .env com
   kubectl create secret generic orbitati-segredos --from-env-file=.env -n orbitati
   e versione só um segredos.exemplo.yaml com valores falsos.
7. Imagens locais com tag fixa (0.1.0), imagePullPolicy: IfNotPresent, carregadas com
   kind load docker-image --name saas.
8. scripts/deploy-kind.ps1: build das imagens, kind load, cria namespace e secret se não
   existirem, kubectl apply, espera o Job de migração e os rollouts, roda o seed
   apontando para http://localhost:30080 e imprime o resultado de /saude.
9. scripts/demo-isolamento.ps1 deve funcionar com -BaseUrl http://localhost:30080.

Pronto quando (saída real):
- kubectl get pods -n orbitati  com tudo Running / Completed
- curl.exe -s http://localhost:30080/saude  ->  db ok, fila ok
- .\scripts\demo-isolamento.ps1 -BaseUrl http://localhost:30080 roda até o fim

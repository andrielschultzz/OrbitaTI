// npm run dev:sim — sobe o simulador (porta 3001) e o Vite apontando o /api para ele.
// Script em Node puro para funcionar igual no PowerShell e no bash, sem dependência nova.
//
// Os dois processos são o próprio node (process.execPath), SEM shell: no Windows, com shell,
// o kill() mataria só o cmd.exe intermediário e deixaria simulador e Vite órfãos nas portas.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const opcoes = { cwd: raiz, stdio: 'inherit' };

const sim = spawn(process.execPath, ['simulador/servidor.js'], { ...opcoes, env: process.env });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
  ...opcoes,
  env: { ...process.env, API_ALVO: 'http://127.0.0.1:3001' },
});

let encerrando = false;
function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  sim.kill();
  vite.kill();
  process.exitCode = codigo;
}
sim.on('exit', (c) => encerrar(c ?? 0));
vite.on('exit', (c) => encerrar(c ?? 0));
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinal, () => encerrar(0));

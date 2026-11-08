// Gera o .env local a partir do .env.example, trocando senhas e segredos por valores aleatórios.
// Uso: npm run env
//
// NUNCA sobrescreve um .env existente. As senhas dos papéis do Postgres são gravadas só no primeiro
// boot (db/init/01-papeis.sh); um .env novo com senhas novas quebraria o login dos papéis até recriar
// o volume. Para trocar de propósito, veja o README.
//
// Não imprime nenhum valor gerado.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DESTINO = '.env';
if (existsSync(DESTINO)) {
  console.log('.env já existe: nada foi alterado.');
  process.exit(0);
}

// Hex: só [0-9a-f], então a senha entra na URL de conexão sem precisar de escape.
const aleatorio = (bytes) => randomBytes(bytes).toString('hex');
const novos = {
  POSTGRES_PASSWORD: aleatorio(24),
  DB_SENHA_MIGRADOR: aleatorio(24),
  DB_SENHA_API: aleatorio(24),
  DB_SENHA_IMPORTACAO: aleatorio(24),
  JWT_SEGREDO: aleatorio(32),
  JWT_SERVICO_SEGREDO: aleatorio(32),
};
const url = (usuario, senha) => `postgres://${usuario}:${senha}@postgres:5432/orbitati`;
novos.DATABASE_URL_MIGRADOR = url('migrador', novos.DB_SENHA_MIGRADOR);
novos.DATABASE_URL_API = url('api_contatos', novos.DB_SENHA_API);
novos.DATABASE_URL_IMPORTACAO = url('importacao_svc', novos.DB_SENHA_IMPORTACAO);

const modelo = readFileSync('.env.example', 'utf8');
const trocadas = new Set();
const saida = modelo.replace(/^([A-Z_]+)=.*$/gm, (linha, nome) => {
  if (!(nome in novos)) return linha;
  trocadas.add(nome);
  return `${nome}=${novos[nome]}`;
});
const faltando = Object.keys(novos).filter((n) => !trocadas.has(n));
if (faltando.length) throw new Error(`variáveis ausentes no .env.example: ${faltando.join(', ')}`);

writeFileSync(DESTINO, saida, { flag: 'wx' }); // wx: falha se o arquivo surgir entre a checagem e a escrita
console.log(`.env criado com ${trocadas.size} valores aleatórios (nenhum valor foi impresso).`);

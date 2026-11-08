// Gera ou completa o .env local a partir do .env.example. Uso: npm run env
//
// Sem .env: cria um, trocando senhas e segredos por valores aleatórios.
// Com .env: só ACRESCENTA no fim as chaves que existem no .env.example e faltam no .env (ex.: PORTAL_URL,
// que chegou no bloco 10). Nunca altera nem apaga uma chave existente. Por isso, depois de um git pull, rode
// `npm run env`: sem as chaves novas, o compose recusa subir ("defina X no .env").
//
// Por que nunca sobrescrever: as senhas dos papéis do Postgres são gravadas só no primeiro boot
// (db/init/01-papeis.sh); trocar uma no .env quebraria o login do papel até recriar o volume (ver o README).
//
// Não imprime nenhum valor, só os NOMES das chaves acrescentadas.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const DESTINO = '.env';
const MODELO = '.env.example';

// Hex: só [0-9a-f], então a senha entra na URL de conexão sem precisar de escape.
const aleatorio = (bytes) => randomBytes(bytes).toString('hex');

// Segredos: nunca copiados do .env.example (lá os valores são falsos e públicos no git).
const SEGREDOS = {
  POSTGRES_PASSWORD: () => aleatorio(24),
  DB_SENHA_MIGRADOR: () => aleatorio(24),
  DB_SENHA_API: () => aleatorio(24),
  DB_SENHA_IMPORTACAO: () => aleatorio(24),
  JWT_SEGREDO: () => aleatorio(32),
  JWT_SERVICO_SEGREDO: () => aleatorio(32),
};
// URLs que embutem uma senha: montadas com a senha do PRÓPRIO .env, para continuarem batendo com o banco.
const URLS = {
  DATABASE_URL_MIGRADOR: ['migrador', 'DB_SENHA_MIGRADOR'],
  DATABASE_URL_API: ['api_contatos', 'DB_SENHA_API'],
  DATABASE_URL_IMPORTACAO: ['importacao_svc', 'DB_SENHA_IMPORTACAO'],
};
const url = (usuario, senha) => `postgres://${usuario}:${senha}@postgres:5432/orbitati`;

const LINHA = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

/** Mapa nome -> valor das linhas "NOME=valor" (comentários e linhas vazias ficam de fora). */
function lerChaves(texto) {
  const chaves = new Map();
  for (const linha of texto.split(/\r?\n/)) {
    const m = linha.match(LINHA);
    if (m) chaves.set(m[1], m[2]);
  }
  return chaves;
}

/**
 * Valor de cada chave pedida: segredo novo, URL montada com a senha de `valores`, ou o valor do modelo.
 * `valores` recebe também o que for gerado (uma URL pode depender de uma senha gerada agora).
 */
function preencher(nomes, modelo, valores) {
  const saida = new Map();
  for (const nome of nomes) if (SEGREDOS[nome]) saida.set(nome, SEGREDOS[nome]());
  for (const [nome, v] of saida) valores.set(nome, v);
  for (const nome of nomes) {
    if (saida.has(nome)) continue;
    if (URLS[nome]) {
      const [usuario, chaveSenha] = URLS[nome];
      saida.set(nome, url(usuario, valores.get(chaveSenha)));
    } else {
      saida.set(nome, modelo.get(nome));
    }
  }
  return saida;
}

const textoModelo = readFileSync(MODELO, 'utf8');
const modelo = lerChaves(textoModelo);

if (!existsSync(DESTINO)) {
  // Criação: o .env é o .env.example linha a linha, com os segredos e as URLs trocados.
  const novos = preencher([...Object.keys(SEGREDOS), ...Object.keys(URLS)], modelo, new Map());
  const trocadas = new Set();
  const saida = textoModelo.replace(/^([A-Z_][A-Z0-9_]*)=.*$/gm, (linha, nome) => {
    if (!novos.has(nome)) return linha;
    trocadas.add(nome);
    return `${nome}=${novos.get(nome)}`;
  });
  const faltando = [...novos.keys()].filter((n) => !trocadas.has(n));
  if (faltando.length) throw new Error(`variáveis ausentes no .env.example: ${faltando.join(', ')}`);
  writeFileSync(DESTINO, saida, { flag: 'wx' }); // wx: falha se o arquivo surgir entre a checagem e a escrita
  console.log(`.env criado com ${trocadas.size} valores aleatórios (nenhum valor foi impresso).`);
  process.exit(0);
}

// Complemento: só o que falta, no fim do arquivo, na ordem do .env.example.
const textoAtual = readFileSync(DESTINO, 'utf8');
const atuais = lerChaves(textoAtual);
const faltam = [...modelo.keys()].filter((nome) => !atuais.has(nome));
if (faltam.length === 0) {
  console.log('.env já tem todas as chaves do .env.example: nada foi alterado.');
  process.exit(0);
}

const novos = preencher(faltam, modelo, new Map(atuais));
const nl = textoAtual.includes('\r\n') ? '\r\n' : '\n';
const data = new Date().toISOString().slice(0, 10);
const bloco = [
  ...(textoAtual === '' || textoAtual.endsWith('\n') ? [] : ['']), // fecha a última linha, se faltar o \n
  '',
  `# Acrescentadas pelo npm run env em ${data}. Explicação de cada uma no .env.example.`,
  ...faltam.map((nome) => `${nome}=${novos.get(nome)}`),
  '',
].join(nl);
appendFileSync(DESTINO, bloco);

console.log(`.env completado com ${faltam.length} chave(s) do .env.example (valores não impressos): ${faltam.join(', ')}`);
const senhasNovas = faltam.filter((n) => n.startsWith('DB_SENHA_') || n === 'POSTGRES_PASSWORD');
if (senhasNovas.length) {
  console.log(
    `ATENÇÃO: ${senhasNovas.join(', ')} ganhou senha nova, mas o Postgres só grava senhas no primeiro boot. ` +
      'Se o volume já existe, veja no README "O .env e as senhas do banco".',
  );
}

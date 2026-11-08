// Funções de apoio dos E2E. Nada aqui manda tenant_id: a empresa vem sempre do token.
import { expect } from '@playwright/test';

const CHAVE_TOKEN = 'orbitati.token'; // a mesma do src/api/sessao.js

let sequencia = 0;
/** E-mail único por execução (como os testes da raiz): rodar duas vezes nunca dá EMAIL_JA_CADASTRADO. */
export function emailUnico(prefixo = 'e2e') {
  sequencia += 1;
  return `${prefixo}-${Date.now()}-${process.pid}-${sequencia}@exemplo.com.br`;
}

/** Cria uma empresa nova pela API (POST /auth/cadastro) e devolve o token. */
export async function cadastrarPelaApi(request, { plano = 'individual', empresa = 'Empresa E2E' } = {}) {
  const resposta = await request.post('/api/auth/cadastro', {
    data: { empresa, plano, nome: 'Pessoa E2E', email: emailUnico(), senha: 'Senha@2026' },
  });
  expect(resposta.status(), await resposta.text()).toBe(201);
  return (await resposta.json()).token;
}

export async function entrarPelaApi(request, email, senha) {
  const resposta = await request.post('/api/auth/login', { data: { email, senha } });
  expect(resposta.status(), await resposta.text()).toBe(200);
  return (await resposta.json()).token;
}

export const autorizacao = (token) => ({ authorization: `Bearer ${token}` });

/** Abre o Portal já com sessão: grava o token no sessionStorage da aba, como o login faz. */
export async function abrirComToken(page, token, caminho = '/contatos') {
  await page.goto('/entrar');
  await page.evaluate(([chave, valor]) => sessionStorage.setItem(chave, valor), [CHAVE_TOKEN, token]);
  await page.goto(caminho);
}

export const tokenNaAba = (page) => page.evaluate((chave) => sessionStorage.getItem(chave), CHAVE_TOKEN);

// --- JWT: só para montar tokens adulterados/vencidos (o Portal nunca assina nada) ---
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
export const lerPayload = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
/** Troca o payload e mantém a assinatura antiga: o formato é válido, a assinatura não. */
export function trocarPayload(token, mudar) {
  const [cabecalho, , assinatura] = token.split('.');
  return `${cabecalho}.${b64url(mudar(lerPayload(token)))}.${assinatura}`;
}

/** CSV no formato do modelo (separador ;). `validas` linhas boas + `invalidas` ruins (sem e-mail / sem nome). */
export function csvContatos({ validas, invalidas = 0, prefixo = 'importado' }) {
  const marca = `${Date.now()}${sequencia++}`;
  const linhas = ['nome;email;telefone;empresa;observacao'];
  for (let i = 1; i <= validas; i++) {
    linhas.push(`Importado ${i};${prefixo}${i}-${marca}@exemplo.com.br;(54) 99999-${String(i).padStart(4, '0')};Cliente ${i};`);
  }
  for (let i = 1; i <= invalidas; i++) {
    linhas.push(i % 2 ? `Sem e-mail ${i};;;;` : `;sem-nome-${i}-${marca}@exemplo.com.br;;;`);
  }
  return Buffer.from(linhas.join('\r\n') + '\r\n', 'utf8');
}

/** Falha se a página rolar na horizontal (o erro de layout mais comum no celular). */
export async function semRolagemHorizontal(page) {
  const { largura, visivel } = await page.evaluate(() => ({
    largura: document.documentElement.scrollWidth,
    visivel: document.documentElement.clientWidth,
  }));
  expect(largura, `rolagem horizontal: conteúdo de ${largura}px numa tela de ${visivel}px`).toBeLessThanOrEqual(visivel);
}

/**
 * Junta erros de JavaScript e de console (inclui violação de CSP: "Refused to ...").
 * Ignora "Failed to load resource", que o Chrome registra para todo 4xx esperado (404 de outro tenant, 401...).
 */
export function vigiarConsole(page) {
  const erros = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) erros.push(m.text());
  });
  return erros;
}

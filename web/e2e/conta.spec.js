// Conta (bloco 14, LGPD): exportar os dados e cancelar a conta, pelo Portal.
// Roda contra o simulador (job web do CI) e contra a API real (job api do CI), pelo mesmo E2E_URL.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { abrirComToken, emailUnico } from './apoio.js';

const SENHA = 'Senha@2026';

async function cadastrar(request) {
  const email = emailUnico('conta');
  const r = await request.post('/api/auth/cadastro', {
    data: { empresa: 'Empresa Conta E2E', plano: 'individual', nome: 'Pessoa Conta', email, senha: SENHA },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { email, token: (await r.json()).token };
}

test.describe('conta', () => {
  test('exportar baixa um JSON com os dados da própria empresa, sem senha', async ({ page, request }) => {
    const { email, token } = await cadastrar(request);
    await abrirComToken(page, token, '/conta');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar meus dados' }).click();
    const arquivo = await download;
    expect(arquivo.suggestedFilename()).toMatch(/^orbitati-exportacao-\d{4}-\d{2}-\d{2}\.json$/);

    const dados = JSON.parse(await readFile(await arquivo.path(), 'utf8'));
    expect(Object.keys(dados).sort()).toEqual(['contatos', 'importacoes', 'interacoes', 'tenant', 'usuarios']);
    expect(dados.usuarios.map((u) => u.email)).toEqual([email]);
    expect(JSON.stringify(dados)).not.toMatch(/senha/i);
  });

  test('cancelar: confirma com CANCELAR, sai da conta, e o login passa a ser recusado', async ({ page, request }) => {
    const { email, token } = await cadastrar(request);
    await abrirComToken(page, token, '/conta');

    await page.getByRole('button', { name: 'Cancelar conta' }).click();
    const dialogo = page.getByRole('dialog');
    const confirmar = dialogo.getByRole('button', { name: 'Cancelar conta' });
    await expect(confirmar).toBeDisabled(); // só libera depois de digitar a palavra
    await dialogo.getByLabel('Para confirmar, digite CANCELAR').fill('cancelar');

    const cancelamentos = [];
    page.on('request', (r) => r.url().endsWith('/api/conta/cancelamento') && cancelamentos.push(r.method()));
    await confirmar.click();

    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByText('O link da exportação foi enviado por e-mail e vale 30 dias.')).toBeVisible();
    expect(cancelamentos).toEqual(['POST']); // um pedido só

    const login = await request.post('/api/auth/login', { data: { email, senha: SENHA } });
    expect(login.status()).toBe(401);
    expect((await login.json()).codigo).toBe('CREDENCIAIS_INVALIDAS');
  });
});

// Sessão: token adulterado ou vencido leva de volta ao /entrar com o aviso, e o token sai da aba.
import { expect, test } from '@playwright/test';
import { abrirComToken, cadastrarPelaApi, tokenNaAba, trocarPayload } from './apoio.js';

test.describe('sessão', () => {
  test('token adulterado: a API responde 401 e o Portal volta para /entrar com o aviso', async ({ page, request }) => {
    const token = await cadastrarPelaApi(request);
    // Muda o plano no payload e mantém a assinatura: o Portal lê o token normalmente, a API recusa.
    const adulterado = trocarPayload(token, (p) => ({ ...p, plano: p.plano === 'equipe' ? 'individual' : 'equipe' }));

    const respostas401 = [];
    page.on('response', (r) => r.url().includes('/api/') && r.status() === 401 && respostas401.push(r.url()));
    await abrirComToken(page, adulterado, '/contatos');

    await expect(page).toHaveURL(/\/entrar\?.*sessao=expirada/);
    await expect(page.getByText('Sua sessão expirou. Entre de novo.')).toBeVisible();
    expect(respostas401.length).toBeGreaterThan(0);
    expect(await tokenNaAba(page)).toBeNull();
  });

  test('token vencido: nem chega a chamar a API, vai direto para /entrar com o aviso', async ({ page, request }) => {
    const token = await cadastrarPelaApi(request);
    const agora = Math.floor(Date.now() / 1000);
    const vencido = trocarPayload(token, (p) => ({ ...p, iat: agora - 1000, exp: agora - 60 }));

    const comToken = [];
    page.on('request', (r) => r.headers().authorization && comToken.push(r.url()));
    await abrirComToken(page, vencido, '/contatos');

    await expect(page).toHaveURL(/\/entrar\?.*sessao=expirada/);
    await expect(page.getByText('Sua sessão expirou. Entre de novo.')).toBeVisible();
    expect(comToken).toEqual([]);
    expect(await tokenNaAba(page)).toBeNull();
  });

  test('guarda a tela onde estava em ?voltar= para voltar depois do login', async ({ page, request }) => {
    const token = await cadastrarPelaApi(request);
    const agora = Math.floor(Date.now() / 1000);
    await abrirComToken(page, trocarPayload(token, (p) => ({ ...p, exp: agora - 60 })), '/importar');
    await expect(page).toHaveURL(/voltar=%2Fimportar/);
  });

  test('rota protegida sem sessão vai para /entrar sem o aviso de expiração', async ({ page }) => {
    await page.goto('/contatos');
    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await expect(page.getByText('Sua sessão expirou. Entre de novo.')).toHaveCount(0);
  });
});

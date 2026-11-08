// Fluxo principal do Marcelo, no celular (375 px), e o T-WEB-01 automatizado.
import { expect, test } from '@playwright/test';
import { csvContatos, emailUnico, semRolagemHorizontal, vigiarConsole } from './apoio.js';

test('cadastrar → contato só com nome → interação → importar 50 linhas (2 inválidas), sem nunca enviar "tenant"', async ({ page }) => {
  // T-WEB-01: olha TODA requisição que sai do navegador (URL, query e corpo).
  // O token vai no cabeçalho Authorization e carrega o tenant como claim assinada (ADR-002): isso é o
  // certo, por isso o cabeçalho fica de fora da checagem.
  const requisicoes = [];
  page.on('request', (r) => requisicoes.push({ url: r.url(), corpo: r.postData() ?? '' }));
  const erros = vigiarConsole(page);
  const campo = (nome) => page.getByRole('textbox', { name: nome, exact: true });

  await test.step('cadastro de uma empresa nova', async () => {
    await page.goto('/cadastro');
    await expect(page.getByText(/R\$\s?\d/).first()).toBeVisible(); // preço veio de GET /planos
    await semRolagemHorizontal(page);
    await campo('Empresa').fill('Consultoria E2E');
    await campo('Seu nome').fill('Pessoa E2E');
    await campo('E-mail').fill(emailUnico('fluxo'));
    await campo('Senha').fill('Senha@2026');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page).toHaveURL(/\/contatos$/);
    await expect(page.getByText('Cadastre seu primeiro contato')).toBeVisible();
  });

  await test.step('contato só com o nome, salvo com Enter (cadastro em 30 s)', async () => {
    const inicio = Date.now();
    await page.getByRole('button', { name: 'Novo contato' }).first().click();
    await expect(campo('Nome')).toBeFocused();
    await page.keyboard.type('Cliente Rápido');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: /Cliente Rápido/ })).toBeVisible();
    expect(Date.now() - inicio).toBeLessThan(30_000);
    await expect(page).not.toHaveURL(/novo=1/);
  });

  await test.step('registrar interação', async () => {
    await page.getByRole('link', { name: /Cliente Rápido/ }).click();
    await expect(page.getByRole('heading', { name: 'Cliente Rápido' })).toBeVisible();
    await expect(page.getByText(/nunca contatado/).first()).toBeVisible();
    await page.getByRole('textbox', { name: 'Nota' }).fill('Pediu orçamento até sexta');
    await page.getByRole('button', { name: 'Registrar interação' }).click();
    await expect(page.getByText('Pediu orçamento até sexta')).toBeVisible();
    await expect(page.getByText('Último contato hoje')).toBeVisible(); // veio da resposta da API
    await semRolagemHorizontal(page);
  });

  await test.step('importar CSV de 50 linhas com 2 inválidas', async () => {
    await page.getByRole('link', { name: 'Importar', exact: true }).click();
    await expect(page.getByText(/até \d+ linhas/)).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({
      name: 'contatos.csv',
      mimeType: 'text/csv',
      buffer: csvContatos({ validas: 48, invalidas: 2 }),
    });
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(page).toHaveURL(/\/importar\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Importação concluída')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/48 contatos importados,\s*2 linhas com erro/)).toBeVisible();
  });

  await test.step('T-WEB-01: nenhuma URL, query ou corpo contém "tenant"', async () => {
    const daApi = requisicoes.filter((r) => new URL(r.url).pathname.startsWith('/api/'));
    expect(daApi.length).toBeGreaterThan(5);
    const comTenant = requisicoes.filter((r) => /tenant/i.test(decodeURIComponent(r.url)) || /tenant/i.test(r.corpo));
    expect(comTenant).toEqual([]);
  });

  expect(erros, 'erros no console (inclui violação de CSP)').toEqual([]);
});

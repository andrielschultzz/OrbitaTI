// Isolamento visto pela tela (CQ-02 do ponto de vista do usuário): a empresa B abre a URL de um
// recurso da empresa A e vê "não encontramos", igual a um id que não existe. Nunca "sem permissão".
import { expect, test } from '@playwright/test';
import { abrirComToken, autorizacao, cadastrarPelaApi, csvContatos } from './apoio.js';

test.describe('isolamento visto pela tela', () => {
  let contatoDeA;
  let importacaoDeA;

  test.beforeAll(async ({ request }) => {
    const tokenA = await cadastrarPelaApi(request, { empresa: 'Empresa A' });
    const contato = await request.post('/api/contatos', {
      headers: autorizacao(tokenA),
      data: { nome: 'Segredo da Empresa A' },
    });
    expect(contato.status()).toBe(201);
    contatoDeA = (await contato.json()).id;

    const importacao = await request.post('/api/importacoes', {
      headers: { ...autorizacao(tokenA), 'content-type': 'text/csv' },
      data: csvContatos({ validas: 3 }),
    });
    expect(importacao.status()).toBe(202);
    importacaoDeA = (await importacao.json()).importacao_id;
  });

  test('B abre /contatos/<id de A> e vê "Não encontramos esse contato."', async ({ page, request }) => {
    const tokenB = await cadastrarPelaApi(request, { empresa: 'Empresa B' });
    const respostas = [];
    page.on('response', (r) => r.url().endsWith(`/api/contatos/${contatoDeA}`) && respostas.push(r.status()));

    await abrirComToken(page, tokenB, `/contatos/${contatoDeA}`);
    await expect(page.getByRole('heading', { name: 'Não encontramos esse contato.' })).toBeVisible();
    await expect(page.getByText('Segredo da Empresa A')).toHaveCount(0);
    expect(respostas).toContain(404); // 404, nunca 403 (regra 5)
  });

  test('B abre /importar/<id de A> e vê "Não encontramos essa importação."', async ({ page, request }) => {
    const tokenB = await cadastrarPelaApi(request, { empresa: 'Empresa B' });
    await abrirComToken(page, tokenB, `/importar/${importacaoDeA}`);
    await expect(page.getByRole('heading', { name: 'Não encontramos essa importação.' })).toBeVisible();
  });

  test('a lista de B não mostra contatos de A', async ({ page, request }) => {
    const tokenB = await cadastrarPelaApi(request, { empresa: 'Empresa B' });
    await abrirComToken(page, tokenB, '/contatos');
    await expect(page.getByText('Cadastre seu primeiro contato')).toBeVisible();
    await expect(page.getByText('Segredo da Empresa A')).toHaveCount(0);
  });
});

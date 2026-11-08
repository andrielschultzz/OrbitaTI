// Erros de importação: cada um mostra a mensagem da tabela da Fase 3 (bloco 13), decidida pelo `codigo`.
import { expect, test } from '@playwright/test';
import { abrirComToken, autorizacao, cadastrarPelaApi, csvContatos } from './apoio.js';

const UM_MB = 1024 * 1024;

test.describe('erros de importação', () => {
  let token;
  test.beforeEach(async ({ page, request }) => {
    token = await cadastrarPelaApi(request);
    await abrirComToken(page, token, '/importar');
    await expect(page.getByText(/até \d+ linhas/)).toBeVisible();
  });

  const alerta = (page) => page.getByRole('alert');
  const escolher = (page, nome, buffer) =>
    page.locator('input[type=file]').setInputFiles({ name: nome, mimeType: 'text/csv', buffer });

  test('arquivo maior que 1 MB: avisa antes de enviar', async ({ page }) => {
    const enviadas = [];
    page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/importacoes') && enviadas.push(r.url()));
    const grande = Buffer.concat([Buffer.from('nome;email\r\n'), Buffer.alloc(UM_MB + 10, 'a')]);
    await escolher(page, 'grande.csv', grande);
    await expect(alerta(page)).toContainText('O arquivo passa de 1 MB. Divida a planilha em partes menores.');
    await expect(alerta(page)).toBeFocused(); // leitor de tela anuncia o erro na hora
    expect(enviadas).toEqual([]); // poupou o upload
  });

  test('arquivo maior que 1 MB pela API: o nginx deixa passar e a API responde 413 ARQUIVO_GRANDE em JSON', async ({ request }) => {
    // Garante o client_max_body_size 2m: com o padrão de 1m o 413 viria do nginx, em HTML, sem `codigo`.
    const resposta = await request.post('/api/importacoes', {
      headers: { ...autorizacao(token), 'content-type': 'text/csv' },
      data: Buffer.concat([Buffer.from('nome;email\r\n'), Buffer.alloc(Math.round(1.5 * UM_MB), 'a')]),
    });
    expect(resposta.status()).toBe(413);
    expect((await resposta.json()).codigo).toBe('ARQUIVO_GRANDE');
  });

  test('CSV sem a coluna email: mensagem com link para o modelo', async ({ page }) => {
    await escolher(page, 'sem-email.csv', Buffer.from('nome;telefone\r\nAna;54 99999-0000\r\n'));
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(alerta(page)).toContainText('A primeira linha precisa ter as colunas nome e email. Baixe o modelo.');
    await expect(alerta(page).getByRole('link', { name: /modelo/i })).toBeVisible();
  });

  test('fila fora (503 FILA_INDISPONIVEL): mostra o texto da API e o resto do Portal segue funcionando', async ({ page }) => {
    // Simula o Redis fora só para esta aba: a resposta segue o contrato (seção 2, tabela de erros).
    await page.route('**/api/importacoes', (rota) =>
      rota.request().method() === 'POST'
        ? rota.fulfill({
            status: 503,
            contentType: 'application/json',
            headers: { 'x-request-id': 'e2e-fila-fora' },
            body: JSON.stringify({
              erro: 'Importação indisponível no momento. O restante do sistema segue funcionando.',
              codigo: 'FILA_INDISPONIVEL',
            }),
          })
        : rota.continue(),
    );
    await escolher(page, 'ok.csv', csvContatos({ validas: 2 }));
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(alerta(page)).toContainText('Importação indisponível no momento. O restante do sistema segue funcionando.');
    await expect(page).toHaveURL(/\/importar$/);

    // "O restante segue funcionando": Contatos abre normal.
    await page.getByRole('link', { name: 'Contatos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Contatos', exact: true })).toBeVisible();
  });
});

// Acessibilidade no celular (375 px): alvos de toque e foco não encoberto pela barra fixa.
// As duas regras pegaram defeitos reais na Fase 5 (logo com 38 px de altura; foco atrás da barra
// inferior e do botão "+"). Ficam aqui para não voltarem.
import { expect, test } from '@playwright/test';
import { abrirComToken, autorizacao, cadastrarPelaApi } from './apoio.js';

let token;
let contatoId;
test.beforeAll(async ({ request }) => {
  token = await cadastrarPelaApi(request);
  // Contatos suficientes para a lista passar da altura da tela (o caso em que a barra encobre).
  for (let i = 1; i <= 12; i++) {
    const r = await request.post('/api/contatos', {
      headers: autorizacao(token),
      data: { nome: `Contato ${String(i).padStart(2, '0')}`, empresa: 'Empresa de teste', telefone: '(54) 99999-0000' },
    });
    contatoId ??= (await r.json()).id;
  }
});

const TELAS = [
  ['entrar', '/entrar', true],
  ['cadastro', '/cadastro', true],
  ['contatos', '/contatos'],
  ['contato', () => `/contatos/${contatoId}`],
  ['novo contato', '/contatos?novo=1'],
  ['importar', '/importar'],
  ['conta', '/conta'],
];

for (const [nome, caminho, publica] of TELAS) {
  test(`alvos de toque >= 44 px: ${nome}`, async ({ page }) => {
    const url = typeof caminho === 'function' ? caminho() : caminho;
    if (publica) await page.goto(url);
    else await abrirComToken(page, token, url);
    await page.waitForLoadState('networkidle');
    const pequenos = await page.evaluate(() => {
      const sel = 'a[href],button,input:not([type=radio]):not([type=hidden]),select,textarea,label:has(> input[type=radio]),summary';
      const dialogo = document.querySelector('dialog[open]');
      return [...document.querySelectorAll(sel)]
        .filter((el) => !el.classList.contains('sr-only') && (!dialogo || dialogo.contains(el)))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
        .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    expect(pequenos).toEqual([]);
  });
}

for (const [nome, caminho] of [['contatos', '/contatos'], ['contato', () => `/contatos/${contatoId}`], ['conta', '/conta']]) {
  test(`Tab nunca deixa o foco atrás da barra inferior ou do botão "+": ${nome}`, async ({ page }) => {
    await abrirComToken(page, token, typeof caminho === 'function' ? caminho() : caminho);
    await page.waitForLoadState('networkidle');
    const encobertos = new Set();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const re = el.getBoundingClientRect();
        const fixos = [...document.querySelectorAll('nav, a[aria-label="Novo contato"]')].filter(
          (f) => getComputedStyle(f).position === 'fixed' && !f.contains(el),
        );
        const tapa = fixos.some((f) => {
          const rf = f.getBoundingClientRect();
          return re.bottom > rf.top + 1 && re.top < rf.bottom && re.right > rf.left && re.left < rf.right;
        });
        return tapa ? (el.getAttribute('aria-label') || el.textContent || el.name || el.tagName).trim().slice(0, 30) : '';
      });
      if (r === null) break;
      if (r) encobertos.add(r);
    }
    expect([...encobertos]).toEqual([]);
  });
}

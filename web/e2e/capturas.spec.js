// Capturas de todas as telas em 4 larguras × 2 temas, em web/e2e/capturas/ (fora do git).
// Além de salvar a imagem, cada captura FALHA se houver rolagem horizontal ou texto saindo do
// próprio elemento: o olho humano revisa o resto (contraste, hierarquia, sobreposição).
//
// Dados: a conta de demonstração (padrão: Marcelo, DevSolo) tem contatos frios para o "Saindo de
// órbita". Na stack real (Fase 6), use as contas do seed ou troque por E2E_DEMO_EMAIL/E2E_DEMO_SENHA.
// A tela de progresso usa uma empresa nova, para não sujar a conta de demonstração com importados.
import { expect, test } from '@playwright/test';
import { abrirComToken, autorizacao, cadastrarPelaApi, csvContatos, entrarPelaApi, semRolagemHorizontal } from './apoio.js';

const LARGURAS = [375, 768, 1024, 1440];
const TEMAS = ['escuro', 'claro'];
const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? 'marcelo@devsolo.dev';
const DEMO_SENHA = process.env.E2E_DEMO_SENHA ?? 'Demo@2026';

/** Elementos de texto cujo conteúdo passa da própria caixa sem ser corte intencional (truncate/line-clamp). */
async function textoVazando(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('h1,h2,h3,p,a,button,label,span,li,dd,dt,legend')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"],svg,.sr-only')) return false;
        if (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') return false;
        return el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.display !== 'inline';
      })
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}"`),
  );
}

test.describe.configure({ mode: 'serial' });

let tokenDemo;
let contatoDemo;
let importacaoNova;
let tokenNova;

test.beforeAll(async ({ request }) => {
  tokenDemo = await entrarPelaApi(request, DEMO_EMAIL, DEMO_SENHA);
  // O contato com mais histórico, para a tela de detalhe mostrar a linha do tempo.
  const { itens } = await (await request.get('/api/contatos', { headers: autorizacao(tokenDemo) })).json();
  contatoDemo = itens.find((c) => c.ultima_interacao_em) ?? itens[0];

  tokenNova = await cadastrarPelaApi(request, { empresa: 'Capturas' });
  const r = await request.post('/api/importacoes', {
    headers: { ...autorizacao(tokenNova), 'content-type': 'text/csv' },
    data: csvContatos({ validas: 48, invalidas: 2 }),
  });
  importacaoNova = (await r.json()).importacao_id;
});

const TELAS = [
  { nome: 'entrar', caminho: '/entrar', publica: true, pronto: (p) => p.getByRole('button', { name: 'Entrar' }) },
  { nome: 'cadastro', caminho: '/cadastro', publica: true, pronto: (p) => p.getByText(/R\$\s?\d/).first() },
  { nome: 'contatos', caminho: '/contatos', pronto: (p) => p.getByRole('heading', { name: 'Saindo de órbita' }) },
  { nome: 'contato', caminho: () => `/contatos/${contatoDemo.id}`, pronto: () => null, titulo: () => contatoDemo.nome },
  { nome: 'novo-contato', caminho: '/contatos?novo=1', pronto: (p) => p.getByRole('dialog') },
  { nome: 'importar', caminho: '/importar', pronto: (p) => p.getByText(/até \d+ linhas/) },
  { nome: 'importacao', caminho: () => `/importar/${importacaoNova}`, nova: true, pronto: (p) => p.getByText('Importação concluída') },
  { nome: 'conta', caminho: '/conta', pronto: (p) => p.getByRole('button', { name: 'Exportar meus dados' }) },
];

for (const tela of TELAS) {
  test(`captura: ${tela.nome}`, async ({ page }) => {
    const caminho = typeof tela.caminho === 'function' ? tela.caminho() : tela.caminho;
    for (const tema of TEMAS) {
      await page.emulateMedia({ colorScheme: tema === 'claro' ? 'light' : 'dark' });
      for (const largura of LARGURAS) {
        await page.setViewportSize({ width: largura, height: largura < 768 ? 812 : 900 });
        if (tela.publica) await page.goto(caminho);
        else await abrirComToken(page, tela.nova ? tokenNova : tokenDemo, caminho);

        const pronto = tela.titulo ? page.getByRole('heading', { name: tela.titulo(), exact: true }) : tela.pronto(page);
        await expect(pronto).toBeVisible({ timeout: 30_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForLoadState('networkidle');

        const arquivo = `e2e/capturas/${tela.nome}-${largura}-${tema}.png`;
        await page.screenshot({ path: arquivo, fullPage: true });
        await test.step(`${largura}px ${tema}`, async () => {
          await semRolagemHorizontal(page);
          expect(await textoVazando(page), `texto vazando em ${arquivo}`).toEqual([]);
        });
      }
    }
  });
}

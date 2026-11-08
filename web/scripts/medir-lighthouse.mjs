// Lighthouse mobile do Portal em /entrar e /contatos, nos temas claro e escuro.
//
// Uso (Portal no ar em E2E_URL, padrão http://localhost:8080, com a conta de demonstração):
//   npm run lighthouse
// O npm script roda via `npx -p lighthouse@12.8.2 -p puppeteer-core@24.43.1`: os dois pacotes vêm
// do cache do npx, sem entrar no package.json. O Chromium é o do Playwright (já é dependência);
// CHROME_PATH troca por outro.
//
// Por que não o `npx lighthouse <url>` puro: /contatos exige login, e o token fica no sessionStorage,
// que é por ABA. O Lighthouse da linha de comando abre uma aba nova e perde a sessão. Aqui o login e
// a medição acontecem na MESMA aba (Lighthouse "user flow" sobre o puppeteer).
//
// Configuração: a padrão do Lighthouse mobile (Moto G Power emulado, CPU 4x mais lenta, 4G lento
// SIMULADO). O cache HTTP é limpo antes de cada medição: todas contam como primeira visita.
// Relatórios HTML em web/lighthouse/ (fora do git).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_URL ?? 'http://localhost:8080';
const EMAIL = process.env.E2E_DEMO_EMAIL ?? 'marcelo@devsolo.dev';
const SENHA = process.env.E2E_DEMO_SENHA ?? 'Demo@2026';
const SAIDA = 'lighthouse';

// Acha os pacotes que o `npx -p` instalou: a pasta node_modules/.bin dele está no PATH.
async function doNpx(pacote) {
  const bins = (process.env.PATH ?? '').split(path.delimiter).filter((p) => /node_modules[\\/]\.bin$/.test(p));
  for (const bin of bins) {
    try {
      const exigir = createRequire(path.join(bin, '..', 'ancora.js'));
      return await import(pathToFileURL(exigir.resolve(pacote)).href);
    } catch {
      /* tenta a próxima pasta */
    }
  }
  throw new Error(`"${pacote}" não encontrado. Rode com: npm run lighthouse`);
}

const { startFlow } = await doNpx('lighthouse');
const { default: puppeteer } = await doNpx('puppeteer-core');

const navegador = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
  headless: true,
  args: ['--lang=pt-BR'],
});
mkdirSync(SAIDA, { recursive: true });
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const resultados = [];

async function medir(nome, caminho, preparar) {
  const page = await navegador.newPage();
  // disableStorageReset: o Lighthouse não apaga o sessionStorage (sessão) nem o localStorage (tema).
  const flags = { locale: 'pt-BR', disableStorageReset: Boolean(preparar) };
  if (preparar) {
    await preparar(page);
    await (await page.createCDPSession()).send('Network.clearBrowserCache');
  }
  const flow = await startFlow(page, { name: nome, flags });
  await flow.navigate(BASE + caminho, { flags });
  const { lhr } = (await flow.createFlowResult()).steps[0];
  writeFileSync(path.join(SAIDA, `${nome}.html`), await flow.generateReport());

  const nota = (id) => Math.round(lhr.categories[id].score * 100);
  const js = lhr.audits['network-requests'].details.items.filter((i) => i.resourceType === 'Script');
  const tema = await page.evaluate(() => document.documentElement.dataset.tema ?? 'sistema');
  const r = {
    medicao: nome,
    url: lhr.finalDisplayedUrl,
    tema,
    desempenho: nota('performance'),
    acessibilidade: nota('accessibility'),
    boas_praticas: nota('best-practices'),
    seo: nota('seo'),
    FCP: lhr.audits['first-contentful-paint'].displayValue,
    LCP: lhr.audits['largest-contentful-paint'].displayValue,
    TBT: lhr.audits['total-blocking-time'].displayValue,
    CLS: lhr.audits['cumulative-layout-shift'].displayValue,
    js_gzip: kb(js.reduce((s, i) => s + i.transferSize, 0)),
  };
  resultados.push(r);
  await page.close();
}

async function prepararTema(page, tema, comLogin) {
  await page.goto(`${BASE}/entrar`);
  await page.evaluate(
    async ({ tema, comLogin, email, senha }) => {
      localStorage.setItem('orbitati.tema', tema);
      if (!comLogin) return;
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      if (!r.ok) throw new Error(`login da conta de demonstração falhou: ${r.status}`);
      sessionStorage.setItem('orbitati.token', (await r.json()).token);
    },
    { tema, comLogin, email: EMAIL, senha: SENHA },
  );
}

// 1. Primeira visita de verdade: aba nova, nada antes (o pior caso; tema do sistema = claro no headless).
await medir('entrar-aba-nova', '/entrar');
// 2. Cada tela em cada tema, com cache vazio.
for (const tema of ['claro', 'escuro']) {
  await medir(`entrar-${tema}`, '/entrar', (p) => prepararTema(p, tema, false));
  await medir(`contatos-${tema}`, '/contatos', (p) => prepararTema(p, tema, true));
}
await navegador.close();

console.table(resultados);
console.log(`Relatórios HTML em web/${SAIDA}/`);
const abaixo = resultados.filter((r) => r.desempenho < 90 || r.acessibilidade < 95 || r.boas_praticas < 95);
if (abaixo.length) {
  console.error('Abaixo da meta (desempenho >= 90, acessibilidade >= 95, boas práticas >= 95):', abaixo.map((r) => r.medicao));
  process.exitCode = 1;
}

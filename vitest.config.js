import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // web/ é o Portal: pacote independente, com Vitest e Playwright próprios. Sem este exclude, o
    // `npm test` da raiz pegaria os .spec.js do Playwright e quebraria.
    exclude: [...configDefaults.exclude, 'web/**'],
    // Os testes de integração usam o mesmo banco e a mesma stack: um arquivo por vez evita que um
    // teste atrapalhe o outro (ex.: contagem de linhas, rate limit). Dentro do arquivo, a ordem é a escrita.
    fileParallelism: false,
    testTimeout: 15_000,
    // O Vitest 5 só mostra console.log de teste que FALHOU ("passed-only"). O T-CQ03-01 (bloco 10)
    // imprime p50, p90 e máximo também quando passa: é o número que vai para o relatório.
    silent: false,
    hookTimeout: 30_000,
  },
});

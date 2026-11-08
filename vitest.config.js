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
    hookTimeout: 30_000,
  },
});

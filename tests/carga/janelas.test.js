// Unitário do veredito do CQ-01 (tests/carga/janelas.js). Não precisa da stack.
import { describe, expect, it } from 'vitest';
import { agrupar, avaliar, horarioEmMs, naJanela, percentil } from './janelas.js';

const T0 = Date.parse('2026-11-08T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** Ponto de busca de observador: o k6 grava o horário do FIM; a duração vem em ms. */
const busca = (inicioMs, duracao, falhou = false) => [
  { type: 'Point', metric: 'http_req_duration', data: { time: iso(inicioMs + duracao), value: duracao, tags: { cenario: 'observadores' } } },
  { type: 'Point', metric: 'http_req_failed', data: { time: iso(inicioMs + duracao), value: falhou ? 1 : 0, tags: { cenario: 'observadores' } } },
];
const janela = (importacao, inicio, fim, status = 'concluida') => [
  { type: 'Point', metric: 'janela_inicio_ms', data: { time: iso(inicio), value: inicio, tags: { importacao } } },
  { type: 'Point', metric: 'janela_fim_ms', data: { time: iso(fim), value: fim, tags: { importacao, status } } },
];

describe('janelas.js (veredito do CQ-01)', () => {
  it('lê o horário do k6 com 9 casas de fração e com fuso', () => {
    expect(horarioEmMs('2026-11-08T12:00:00.123456789Z')).toBeCloseTo(T0 + 123.456789, 5);
    expect(horarioEmMs('2026-11-08T09:00:00-03:00')).toBe(T0);
  });

  it('percentil por posição: o p95 de 400 valores é o 380º', () => {
    const valores = Array.from({ length: 400 }, (_, i) => i + 1);
    expect(percentil(valores, 0.95)).toBe(380);
    expect(percentil([7], 0.95)).toBe(7);
  });

  it('classifica pelo INÍCIO da busca (fim − duração), com os limites inclusive', () => {
    const js = [{ inicio: T0, fim: T0 + 1000 }];
    expect(naJanela(T0, js)).toBe(true);
    expect(naJanela(T0 + 1000, js)).toBe(true);
    expect(naJanela(T0 - 1, js)).toBe(false);
    // Começou 100 ms antes da janela e terminou dentro dela: NÃO conta.
    const { buscas } = agrupar(busca(T0 - 100, 300));
    expect(naJanela(buscas[0].inicio, js)).toBe(false);
  });

  it('aprova pelo grupo "na janela", mesmo com o geral pior', () => {
    const pontos = [
      ...janela('1', T0, T0 + 10_000),
      ...Array.from({ length: 120 }, (_, i) => busca(T0 + i * 50, 100)).flat(),
      // fora da janela e lenta: piora o geral, não o veredito
      ...busca(T0 + 20_000, 1500),
    ];
    const r = avaliar(agrupar(pontos));
    expect(r.na_janela.n).toBe(120);
    expect(r.geral.n).toBe(121);
    expect(r.geral.max).toBe(1500);
    expect(r.veredito).toBe('passou');
    expect(r.avisos).toEqual([]);
  });

  it('reprova com p95 ≥ 800, máx ≥ 2 s ou qualquer falha, e diz o motivo', () => {
    const lentas = [...janela('1', T0, T0 + 10_000), ...Array.from({ length: 100 }, (_, i) => busca(T0 + i * 50, 900)).flat()];
    expect(avaliar(agrupar(lentas)).motivos.join()).toMatch(/p95 na janela 900\.0 ms/);

    const pico = [...janela('1', T0, T0 + 10_000), ...Array.from({ length: 100 }, (_, i) => busca(T0 + i * 50, i === 0 ? 2000 : 100)).flat()];
    expect(avaliar(agrupar(pico)).motivos.join()).toMatch(/máximo na janela 2000\.0 ms/);

    // A falha fora da janela também reprova: o critério é 0 falhas no total.
    const falha = [...janela('1', T0, T0 + 10_000), ...Array.from({ length: 100 }, (_, i) => busca(T0 + i * 50, 100)).flat(), ...busca(T0 + 30_000, 50, true)];
    const r = avaliar(agrupar(falha));
    expect(r.veredito).toBe('falhou');
    expect(r.falhas).toEqual({ total: 1, na_janela: 0 });
  });

  it('sem busca na janela não passa; com --sem-criterio só registra e avisa do n pequeno', () => {
    const pontos = [...janela('1', T0, T0 + 1000), ...busca(T0 + 5000, 100)];
    expect(avaliar(agrupar(pontos)).veredito).toBe('falhou');
    const r = avaliar(agrupar(pontos), { semCriterio: true });
    expect(r.veredito).toBe('sem critério');
    expect(r.avisos[0]).toMatch(/n na janela = 0 < 20/);
  });

  it('ignora requisições que não são de observador (setup e barulhento)', () => {
    const outra = { type: 'Point', metric: 'http_req_duration', data: { time: iso(T0), value: 5000, tags: { cenario: 'barulhento' } } };
    const semTag = { type: 'Point', metric: 'http_req_duration', data: { time: iso(T0), value: 5000, tags: {} } };
    expect(agrupar([outra, semTag]).buscas).toEqual([]);
  });
});

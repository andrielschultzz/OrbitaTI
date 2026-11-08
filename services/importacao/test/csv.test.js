// Validação do CSV no worker (unitário, sem stack). Inclui dois testes de "contrato entre serviços":
//   - as cópias de normalizarColuna/detectarSeparador são iguais às da API (senão a API aceitaria um
//     cabeçalho que o worker não entende, ou contaria linhas de outro jeito);
//   - a regex de e-mail aceita exatamente o que a API aceita (senão um lote inteiro levaria 400).
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import * as daApi from '../../api-contatos/src/csv.js';
import { EMAIL_VALIDO, CsvInvalido, detectarSeparador, fatiar, normalizarColuna, validarCsv } from '../src/csv.js';

describe('cabeçalho: mesmas regras da API', () => {
  const nomes = ['nome', ' Nome ', 'E-mail', 'EMAIL', 'e mail', 'Observação', '"Telefone"', 'Empresa', 'Endereço Comercial'];
  it.each(nomes)('normalizarColuna(%j) igual nos dois serviços', (n) => {
    expect(normalizarColuna(n)).toBe(daApi.normalizarColuna(n));
  });
  it('exemplos do contrato: "E-mail" -> email, "Observação" -> observacao', () => {
    expect(normalizarColuna('E-mail')).toBe('email');
    expect(normalizarColuna('Observação')).toBe('observacao');
  });
  const cabecalhos = ['nome,email', 'nome;email', 'nome;email;empresa', 'nome,email;x', 'nome', 'a;b,c;d'];
  it.each(cabecalhos)('detectarSeparador(%j) igual nos dois serviços', (c) => {
    expect(detectarSeparador(c)).toBe(daApi.detectarSeparador(c));
  });
});

describe('e-mail: aceita exatamente o que a API aceita (format "email" do Fastify)', () => {
  const emails = [
    'ana@x.dev', 'a.b+c@sub.dominio.com.br', "o'neil@x.com", 'x@localhost', 'ana@x', 'ana..b@x.dev', '.ana@x.dev',
    'ana@-x.dev', 'ana@x-.dev', 'ana @x.dev', 'ana@x.dev ', 'ana@', '@x.dev', 'ana', 'ana@x..dev', 'josé@x.dev', 'ana@x_y.dev',
  ];
  it('mesmo veredito em todos os casos', async () => {
    const app = Fastify({ logger: false });
    app.post('/x', { schema: { body: { type: 'object', properties: { email: { type: 'string', format: 'email' } } } } }, async () => 'ok');
    await app.ready();
    const divergentes = [];
    for (const email of emails) {
      const api = (await app.inject({ method: 'POST', url: '/x', payload: { email } })).statusCode === 200;
      if (api !== EMAIL_VALIDO.test(email)) divergentes.push(`${email} (API ${api ? 'aceita' : 'recusa'})`);
    }
    await app.close();
    expect(divergentes).toEqual([]);
  });
});

describe('validarCsv', () => {
  it('T-IMP-03: CSV do Excel em português (";" e BOM) dá o mesmo resultado que com ","', () => {
    const virgula = 'nome,email,empresa\nAna,ana@x.dev,"Silva, Souza"\nBia,bia@x.dev,B';
    const excel = '﻿Nome;E-mail;Empresa\r\nAna;ana@x.dev;Silva, Souza\r\nBia;bia@x.dev;B\r\n';
    expect(validarCsv(excel)).toEqual(validarCsv(virgula));
    expect(validarCsv(excel).validos[0].empresa).toBe('Silva, Souza'); // a vírgula não quebrou a coluna
  });

  it('T-IMP-04: sem e-mail e e-mail inválido são erro de linha; maiúsculas viram minúsculas', () => {
    const { validos, erros } = validarCsv('nome,email\nSem Email,\nInvalido,nao-e-email\nFulano,Fulano@X.com');
    expect(erros).toEqual([
      { linha: 2, motivo: 'e-mail vazio' },
      { linha: 3, motivo: 'e-mail inválido' },
    ]);
    expect(validos).toEqual([{ nome: 'Fulano', email: 'fulano@x.com', telefone: null, empresa: null, observacao: null }]);
  });

  it('T-IMP-21: e-mail repetido no arquivo (mesmo com maiúsculas) é erro de linha que aponta a primeira', () => {
    const { validos, erros } = validarCsv('nome,email\nAna,ana@x.dev\nBia,bia@x.dev\nAna 2,ANA@x.dev');
    expect(validos.map((v) => v.nome)).toEqual(['Ana', 'Bia']);
    expect(erros).toEqual([{ linha: 4, motivo: 'e-mail repetido (já aparece na linha 2)' }]);
  });

  it('nome vazio, nome longo, linha só com separadores', () => {
    const { erros } = validarCsv(`nome;email\n;a@x.dev\n${'N'.repeat(121)};b@x.dev\n;;\nOk;c@x.dev`);
    expect(erros.map((e) => e.motivo)).toEqual(['nome vazio', 'nome com mais de 120 caracteres', 'nome vazio']);
  });

  it('linha em branco é ignorada (a API também não a conta); colunas extras e fora de ordem funcionam', () => {
    const { validos, erros } = validarCsv('Empresa,Cargo,Email,Nome\n\nACME,Dev,ana@x.dev,Ana\n\n');
    expect(erros).toEqual([]);
    expect(validos).toEqual([{ nome: 'Ana', email: 'ana@x.dev', telefone: null, empresa: 'ACME', observacao: null }]);
  });

  it('opcionais acima do limite são cortados (como no simulador); célula vazia vira null', () => {
    const { validos } = validarCsv(`nome,email,telefone,observacao\nAna,ana@x.dev,${'9'.repeat(40)},${'o'.repeat(600)}`);
    expect(validos[0].telefone).toHaveLength(30);
    expect(validos[0].observacao).toHaveLength(500);
  });

  it('a contagem do worker bate com a da API (válidas + inválidas = linhas não vazias)', () => {
    const csv = 'nome;email\nA;a@x.dev\n\n;;\nB;inval\nC;c@x.dev\r\n';
    const { validos, erros } = validarCsv(csv);
    expect(validos.length + erros.length).toBe(daApi.lerCabecalho(csv).linhas);
  });

  it('aspas abertas e nunca fechadas -> CsvInvalido (tentar de novo não resolve)', () => {
    expect(() => validarCsv('nome,email\n"Ana,ana@x.dev\n')).toThrow(CsvInvalido);
  });
});

describe('fatiar', () => {
  it('250 em lotes de 100 -> 100, 100, 50 (T-IMP-01: 3 lotes)', () => {
    expect(fatiar(Array.from({ length: 250 }, (_, i) => i), 100).map((l) => l.length)).toEqual([100, 100, 50]);
  });
  it('nada -> nenhum lote', () => {
    expect(fatiar([], 100)).toEqual([]);
  });
});

// Validação do CSV no worker: aqui, sim, linha por linha (a API só leu o cabeçalho e contou as linhas).
//
// Formato (contrato, seção 7): cabeçalho na primeira linha; colunas nome, email, telefone, empresa,
// observacao (nomes normalizados); separador "," ou ";"; BOM UTF-8 aceito.
//
// normalizarColuna e detectarSeparador são CÓPIAS das funções da API (services/api-contatos/src/csv.js).
// Repetidas de propósito: cada serviço é um pacote independente, com imagem própria. Se mudar uma, mude
// a outra; os testes unitários dos dois conferem os mesmos casos.
import { parse } from 'csv-parse/sync';

const BOM = '﻿';

// Mesmos limites do POST /contatos e da rota /interno/.../lotes da API.
const MAX = { nome: 120, email: 254, telefone: 30, empresa: 120, observacao: 500 };

// A MESMA regex que a API usa para validar e-mail (format "email" do ajv-formats no modo "full", que é o
// do Fastify). Se o worker aceitasse um e-mail que a API recusa, o lote inteiro levaria 400 e a
// importação falharia por causa de uma linha. O teste unitário compara esta regex com o Ajv de verdade.
export const EMAIL_VALIDO =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** CSV que não dá para ler (ex.: aspas abertas e nunca fechadas). Tentar de novo não resolve. */
export class CsvInvalido extends Error {}

export function normalizarColuna(nome) {
  return nome
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]/g, '');
}

export function detectarSeparador(linhaCabecalho) {
  const contar = (c) => linhaCabecalho.split(c).length - 1;
  return contar(';') > contar(',') ? ';' : ',';
}

/** Célula opcional: vazia vira null; acima do limite é cortada (como no simulador do Portal). */
const opcional = (valor, max) => (valor ? valor.slice(0, max) : null);

/**
 * @param {string} texto  o CSV inteiro (vem no payload do job)
 * @returns {{validos: object[], erros: {linha: number, motivo: string}[]}}
 *   linha = número da linha no arquivo (o cabeçalho é a linha 1), para a pessoa achar no Excel.
 * @throws {CsvInvalido}
 */
export function validarCsv(texto) {
  const semBom = texto.startsWith(BOM) ? texto.slice(1) : texto;
  const cabecalho = semBom.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';

  let registros;
  try {
    registros = parse(semBom, {
      delimiter: detectarSeparador(cabecalho), // UM separador para o arquivo inteiro
      columns: (nomes) => nomes.map(normalizarColuna),
      skip_empty_lines: true, // a API também não conta linha vazia
      relax_column_count: true, // linha com coluna a menos ou a mais não derruba o arquivo
      trim: true,
      info: true, // número da linha de cada registro
    });
  } catch (erro) {
    throw new CsvInvalido(`CSV ilegível: ${erro.code ?? erro.message}`);
  }

  const validos = [];
  const erros = [];
  const linhaDoEmail = new Map(); // e-mail -> linha onde apareceu primeiro
  for (const { record: r, info } of registros) {
    const linha = info.lines;
    const nome = r.nome ?? '';
    const email = (r.email ?? '').toLowerCase(); // regra 8: sempre minúsculo
    let motivo = null;
    if (!nome) motivo = 'nome vazio';
    else if (nome.length > MAX.nome) motivo = `nome com mais de ${MAX.nome} caracteres`;
    else if (!email) motivo = 'e-mail vazio'; // obrigatório na importação: é a chave do upsert (regra 9)
    else if (email.length > MAX.email || !EMAIL_VALIDO.test(email)) motivo = 'e-mail inválido';
    else if (linhaDoEmail.has(email)) motivo = `e-mail repetido (já aparece na linha ${linhaDoEmail.get(email)})`;

    if (motivo) {
      erros.push({ linha, motivo });
      continue;
    }
    linhaDoEmail.set(email, linha);
    validos.push({
      nome,
      email,
      telefone: opcional(r.telefone, MAX.telefone),
      empresa: opcional(r.empresa, MAX.empresa),
      observacao: opcional(r.observacao, MAX.observacao),
    });
  }
  return { validos, erros };
}

/** Divide em lotes de `tamanho` (IMPORT_LOTE). */
export function fatiar(itens, tamanho) {
  const lotes = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

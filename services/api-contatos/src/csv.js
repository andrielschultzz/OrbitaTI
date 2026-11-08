// Leitura RÁPIDA do CSV no POST /importacoes (contrato, seção 7): só o cabeçalho e a contagem de linhas.
// Validar cada linha é trabalho do worker, fora da requisição (ADR-003). Aqui a API só precisa saber,
// antes de enfileirar, se o arquivo tem as colunas obrigatórias e se cabe no plano: o erro chega na
// hora, não depois da fila.
//
// As regras de separador e de nome de coluna são as MESMAS do worker (services/importacao/src/csv.js).
// O código é repetido de propósito: cada serviço é um pacote independente, com imagem própria.
// Se mudar uma, mude a outra (os testes unitários dos dois conferem os mesmos casos).

const BOM = '﻿'; // o PowerShell 5 grava UTF-8 com BOM

/**
 * Nome de coluna normalizado: minúsculas, sem acento, sem espaço e sem hífen, sem aspas em volta.
 * "E-mail" -> "email"; "Observação" -> "observacao"; ' "Nome" ' -> "nome".
 */
export function normalizarColuna(nome) {
  return nome
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira os acentos que o NFD separou da letra
    .toLowerCase()
    .replace(/[\s-]/g, '');
}

/**
 * Separador do arquivo inteiro, decidido UMA vez pela linha do cabeçalho: o que aparecer mais.
 * Aceitar "," e ";" ao mesmo tempo quebraria o Excel em português: "Silva, João" num arquivo com ";"
 * viraria duas colunas.
 */
export function detectarSeparador(linhaCabecalho) {
  const contar = (c) => linhaCabecalho.split(c).length - 1;
  return contar(';') > contar(',') ? ';' : ',';
}

/**
 * @param {string} texto  corpo do POST (text/csv)
 * @returns {{colunas: string[] | null, separador: string, linhas: number}}
 *   colunas null = arquivo sem nenhuma linha (nem cabeçalho);
 *   linhas = linhas não vazias depois do cabeçalho (definição do contrato).
 */
export function lerCabecalho(texto) {
  const semBom = texto.startsWith(BOM) ? texto.slice(1) : texto; // BOM só vale no começo do arquivo
  const todas = semBom.split(/\r\n|\n|\r/);
  const naoVazia = (l) => l.trim() !== '';
  const indiceCabecalho = todas.findIndex(naoVazia);
  if (indiceCabecalho === -1) return { colunas: null, separador: ',', linhas: 0 };

  const cabecalho = todas[indiceCabecalho];
  const separador = detectarSeparador(cabecalho);
  const colunas = cabecalho.split(separador).map(normalizarColuna);
  const linhas = todas.slice(indiceCabecalho + 1).filter(naoVazia).length;
  return { colunas, separador, linhas };
}

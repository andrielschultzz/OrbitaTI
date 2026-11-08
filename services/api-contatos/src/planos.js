// Planos, preços e limites: a ÚNICA fonte desses números (CLAUDE.md, "Números do projeto").
// É a "feature flag por plano": quem precisa de um limite importa daqui, nunca escreve o número.
// Exposto pela rota pública GET /planos (contrato, seção 7), para o Portal não copiar valores.

/** 1 MB = 1.024 × 1.024 bytes. É o bodyLimit do POST /importacoes e o tamanho que o GET /planos informa. */
export const TAMANHO_MAXIMO_CSV_BYTES = 1_048_576;

/** 60 por minuto por usuário permitido no plano: um clique por segundo em rajada. */
const REQUISICOES_POR_USUARIO_POR_MINUTO = 60;

const definir = (plano, nome, precoCentavos, { usuarios, linhasPorImportacao, importacoesSimultaneas }) => ({
  plano,
  nome,
  // Centavos (inteiro): dinheiro em ponto flutuante acumula erro de arredondamento.
  preco_mensal_centavos: precoCentavos,
  limites: {
    usuarios,
    linhas_por_importacao: linhasPorImportacao,
    importacoes_simultaneas: importacoesSimultaneas,
    requisicoes_por_minuto: usuarios * REQUISICOES_POR_USUARIO_POR_MINUTO, // 1 × 60 = 60 · 10 × 60 = 600
    tamanho_maximo_csv_bytes: TAMANHO_MAXIMO_CSV_BYTES,
  },
});

// Object.freeze: nenhum código consegue alterar um limite em tempo de execução por engano.
export const PLANOS = Object.freeze({
  // 100 linhas: o Individual (DevSolo) acumula ~150 contatos por ano e nunca importa em massa (ADR-003).
  individual: definir('individual', 'Individual', 4900, { usuarios: 1, linhasPorImportacao: 100, importacoesSimultaneas: 2 }),
  // 5.000 linhas ≈ 1 MB ÷ ~200 bytes por linha: o CSV inteiro cabe no payload do job.
  equipe: definir('equipe', 'Equipe', 24900, { usuarios: 10, linhasPorImportacao: 5000, importacoesSimultaneas: 5 }),
});

/** Limites do plano do token. Plano desconhecido não acontece (o token é validado), mas falha alto se acontecer. */
export function limitesDo(plano) {
  const p = PLANOS[plano];
  if (!p) throw new Error(`plano desconhecido: ${plano}`);
  return p.limites;
}

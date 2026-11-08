// GET /planos (contrato, seção 7): PÚBLICA, sem token e sem rate limit.
// A tela de cadastro mostra os planos antes de existir token. Não tem dado de tenant: a resposta é a
// mesma para qualquer pessoa, e só lê memória (planos.js). Por isso está na lista fixa ROTAS_PUBLICAS
// do T-ISO-15 (tests/isolamento.test.js).
import { PLANOS } from '../planos.js';

const limites = {
  type: 'object',
  properties: {
    usuarios: { type: 'integer' },
    linhas_por_importacao: { type: 'integer' },
    importacoes_simultaneas: { type: 'integer' },
    requisicoes_por_minuto: { type: 'integer' },
    tamanho_maximo_csv_bytes: { type: 'integer' },
  },
};

// Calculada uma vez: os planos não mudam com a API no ar.
const RESPOSTA = { itens: Object.values(PLANOS) };

export default async function rotasPlanos(app) {
  app.get(
    '/planos',
    {
      config: { publica: true, rateLimit: false },
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              itens: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    plano: { type: 'string' },
                    nome: { type: 'string' },
                    preco_mensal_centavos: { type: 'integer' },
                    limites,
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => RESPOSTA,
  );
}

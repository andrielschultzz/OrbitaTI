// Formato único de erro da API: {erro, codigo, ...extras} (docs/contrato-api.md, seção 2).
// O Portal e os testes decidem pelo `codigo`; o `erro` é texto pronto para mostrar ao usuário.

export const MENSAGENS = {
  VALIDACAO: 'Confira os campos destacados.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre de novo.',
  CREDENCIAIS_INVALIDAS: 'E-mail ou senha incorretos.',
  SEM_PERMISSAO: 'Seu perfil não tem permissão para isso.',
  NAO_ENCONTRADO: 'Recurso não encontrado.',
  EMAIL_JA_CADASTRADO: 'Esse e-mail já tem conta.',
  EMAIL_DUPLICADO: 'Já existe um contato com esse e-mail.',
  ARQUIVO_GRANDE: 'O arquivo passa de 1 MB. Divida a planilha em partes menores.',
  TIPO_NAO_SUPORTADO: 'Formato não suportado. Envie um arquivo CSV.',
  CSV_VAZIO: 'O arquivo não tem nenhum contato.',
  CSV_SEM_COLUNAS: 'A primeira linha precisa ter as colunas nome e email.',
  IMPORTACOES_SIMULTANEAS: 'Você já tem importações em andamento. Aguarde uma terminar.',
  LIMITE_REQUISICOES: 'Muitas ações seguidas. Tente de novo em instantes.',
  FILA_INDISPONIVEL:'Importação indisponível no momento. O restante do sistema segue funcionando.',
  LINK_INVALIDO: 'Este link é inválido ou venceu.',
};

/** Erro que já sabe virar resposta do contrato. Lance-o em qualquer rota; o setErrorHandler responde. */
export class ErroContrato extends Error {
  constructor(status, codigo, { erro, extras } = {}) {
    super(codigo);
    this.status = status;
    this.corpo = { erro: erro ?? MENSAGENS[codigo], codigo, ...extras };
  }
}

export const naoEncontrado = (erro) => new ErroContrato(404, 'NAO_ENCONTRADO', { erro });

/** Mensagem por campo, a partir do erro do Ajv (validação do Fastify). Mesmas frases do simulador. */
function mensagemCampo(e) {
  switch (e.keyword) {
    case 'required':
      return 'Campo obrigatório.';
    case 'format':
      return e.params.format === 'email' ? 'E-mail inválido.' : 'Valor inválido.';
    case 'maxLength':
      return `No máximo ${e.params.limit} caracteres.`;
    case 'minLength':
      return e.params.limit <= 1 ? 'Campo obrigatório.' : `Pelo menos ${e.params.limit} caracteres.`;
    case 'minProperties':
      return 'Envie ao menos um campo.';
    default:
      return 'Valor inválido.';
  }
}

/** [{campo, erro}] sem repetir campo (com allErrors, um campo pode ter vários erros). */
export function camposDaValidacao(erros = []) {
  const vistos = new Map();
  for (const e of erros) {
    const campo = e.params?.missingProperty ?? e.instancePath.replace(/^\//, '').replace(/\//g, '.');
    if (!vistos.has(campo)) vistos.set(campo, { campo, erro: mensagemCampo(e) });
  }
  return [...vistos.values()];
}

/** Violação de UNIQUE do PostgreSQL numa constraint/índice específico. */
export const violouUnico = (erro, nome) => erro?.code === '23505' && erro.constraint === nome;

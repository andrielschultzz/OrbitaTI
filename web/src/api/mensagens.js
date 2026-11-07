// Mensagens na tela, decididas pelo `codigo` do contrato (bloco 13, tabela da Fase 3).
// Regra: usar o texto da API (`erro`), menos onde a tela tem um texto mais útil.
// As palavras "tenant", "JWT" e "payload" nunca aparecem para o usuário.

export const MENSAGEM_SERVIDOR = 'Não conseguimos falar com o servidor. Tente de novo.';

/**
 * @param {import('./cliente.js').ErroApi} erro
 * @param {'login'|'cadastro'|'contato'|'importar'|'conta'|'geral'} [tela]
 * @returns {string}
 */
export function mensagemDeErro(erro, tela = 'geral') {
  const { codigo, extras = {}, retryAfter } = erro ?? {};
  switch (codigo) {
    case 'CREDENCIAIS_INVALIDAS':
      return 'E-mail ou senha incorretos.';
    case 'NAO_AUTENTICADO':
      return 'Sua sessão expirou. Entre de novo.';
    case 'NAO_ENCONTRADO':
      if (tela === 'contato') return 'Não encontramos esse contato.';
      // /conta/* nunca devolve 404 pelo contrato: 404 ali é "o bloco 14 ainda não existe na API".
      if (tela === 'conta') return 'Essa função ainda não está disponível.';
      return erro.message;
    case 'EMAIL_DUPLICADO':
      return 'Já existe um contato com esse e-mail.';
    case 'EMAIL_JA_CADASTRADO':
      return 'Esse e-mail já tem conta. Quer entrar?';
    case 'ARQUIVO_GRANDE':
      return 'O arquivo passa de 1 MB. Divida a planilha em partes menores.';
    case 'CSV_SEM_COLUNAS':
      return 'A primeira linha precisa ter as colunas nome e email. Baixe o modelo.';
    case 'LINHAS_ACIMA_DO_PLANO':
      return `Seu plano permite até ${extras.limite} linhas; o arquivo tem ${extras.linhas}.`;
    case 'IMPORTACOES_SIMULTANEAS':
      return 'Você já tem importações em andamento. Aguarde uma terminar.';
    case 'LIMITE_REQUISICOES':
      if (tela === 'login') return 'Muitas tentativas. Aguarde um minuto.';
      return retryAfter
        ? `Muitas ações seguidas. Tente de novo em ${retryAfter} s.`
        : 'Muitas ações seguidas. Tente de novo em instantes.';
    case 'REDE':
    case 'ERRO_INTERNO':
      return MENSAGEM_SERVIDOR;
    default:
      return erro?.message || MENSAGEM_SERVIDOR;
  }
}

/** Erro inesperado: o toast mostra também o x-request-id ("código: ...") para achar no log. */
export const ehInesperado = (erro) => ['REDE', 'ERRO_INTERNO', 'DESCONHECIDO'].includes(erro?.codigo);

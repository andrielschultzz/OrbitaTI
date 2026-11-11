// Simulador do contrato HTTP (docs/contrato-api.md), em memória.
//
// Para que serve: o Portal (bloco 13) é construído e testado antes de a API real existir.
// O que ele NÃO é: um segundo backend. Sem banco, sem regra que não esteja no contrato.
// Nunca entra na imagem Docker nem roda em produção.
//
// Multi-tenant de verdade: o tenant vem SÓ do token (ADR-002) e tudo é filtrado por ele.
// Recurso de outro tenant responde 404, igual a recurso inexistente (regra 5 / CQ-02).
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { assinar, verificar } from './jwt.js';
import { estadoInicial, gerarHash, conferirSenha } from './dados.js';

const TOKEN_SEGUNDOS = 15 * 60; // contrato, seção 3
const TAMANHO_MAXIMO_CSV = 1024 * 1024; // 1 MB = 1.048.576 bytes
const LOTE = 100; // linhas por lote (ADR-003)
const PAUSA_LOTE_MS = 500; // pausa entre lotes (ADR-003)
const JANELA_MS = 60 * 1000;
const DIA = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cópia dos números do planos.js da API (CLAUDE.md, "Números do projeto").
const PLANOS = {
  individual: {
    nome: 'Individual',
    preco_mensal_centavos: 4900,
    limites: { usuarios: 1, linhas_por_importacao: 100, importacoes_simultaneas: 2, requisicoes_por_minuto: 60 },
  },
  equipe: {
    nome: 'Equipe',
    preco_mensal_centavos: 24900,
    limites: { usuarios: 10, linhas_por_importacao: 5000, importacoes_simultaneas: 5, requisicoes_por_minuto: 600 },
  },
};

const MENSAGENS = {
  VALIDACAO: 'Confira os campos destacados.',
  LINK_INVALIDO: 'Este link é inválido ou venceu.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre de novo.',
  CREDENCIAIS_INVALIDAS: 'E-mail ou senha incorretos.',
  SEM_PERMISSAO: 'Seu perfil não tem permissão para isso.',
  EMAIL_JA_CADASTRADO: 'Esse e-mail já tem conta.',
  EMAIL_DUPLICADO: 'Já existe um contato com esse e-mail.',
  ARQUIVO_GRANDE: 'O arquivo passa de 1 MB. Divida a planilha em partes menores.',
  TIPO_NAO_SUPORTADO: 'Formato não suportado. Envie um arquivo CSV.',
  CSV_VAZIO: 'O arquivo não tem nenhum contato.',
  CSV_SEM_COLUNAS: 'A primeira linha precisa ter as colunas nome e email.',
  LIMITE_REQUISICOES: 'Muitas ações seguidas. Tente de novo em instantes.',
  IMPORTACOES_SIMULTANEAS: 'Você já tem importações em andamento. Aguarde uma terminar.',
  FILA_INDISPONIVEL: 'Importação indisponível no momento. O restante do sistema segue funcionando.',
};

/** Erro no formato do contrato: {erro, codigo, ...extras no nível de cima}. */
class ErroContrato extends Error {
  constructor(status, codigo, { erro, extras, cabecalhos } = {}) {
    super(codigo);
    this.status = status;
    this.corpo = { erro: erro ?? MENSAGENS[codigo], codigo, ...extras };
    this.cabecalhos = cabecalhos;
  }
}
const naoEncontrado = (erro) => new ErroContrato(404, 'NAO_ENCONTRADO', { erro });
const CONTATO_NAO_ENCONTRADO = 'Contato não encontrado.';
const IMPORTACAO_NAO_ENCONTRADA = 'Importação não encontrada.';

// ---------- serialização: nenhuma resposta devolve tenant_id ----------
function contatoPublico(c) {
  const { tenant_id, ...resto } = c; // eslint-disable-line no-unused-vars
  return resto;
}
function interacaoPublica(i) {
  const { tenant_id, ...resto } = i; // eslint-disable-line no-unused-vars
  return resto;
}
function importacaoPublica(i) {
  return {
    id: i.id,
    status: i.status,
    total_linhas: i.total_linhas,
    linhas_invalidas: i.linhas_invalidas,
    total_lotes: i.total_lotes,
    lotes_aplicados: i.lotes_aplicados,
    criado_em: i.criado_em,
    concluida_em: i.concluida_em,
  };
}

// ---------- validação: ajv -> {campos: [{campo, erro}]} ----------
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
    case 'minimum':
    case 'maximum':
      return 'Valor fora do permitido.';
    default:
      return 'Valor inválido.';
  }
}
function camposDaValidacao(erros) {
  const vistos = new Map();
  for (const e of erros) {
    const campo = e.params?.missingProperty ?? e.instancePath.replace(/^\//, '').replace(/\//g, '.');
    if (!vistos.has(campo)) vistos.set(campo, { campo, erro: mensagemCampo(e) });
  }
  return [...vistos.values()];
}

// ---------- CSV (contrato, seção 7) ----------
const normalizarColuna = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]/g, '');

// Parser mínimo com aspas. Não aceita quebra de linha dentro de aspas (o worker real usa csv-parse).
function separarCampos(linha, sep) {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      campos.push(atual);
      atual = '';
    } else atual += ch;
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

function lerCsv(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (linhas.length === 0) return { colunas: null, dados: [] };
  const cabecalho = linhas[0];
  const sep = cabecalho.includes(';') ? ';' : ',';
  const colunas = separarCampos(cabecalho, sep).map(normalizarColuna);
  return { colunas, sep, dados: linhas.slice(1) };
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildSimulador({
  fila = process.env.SIM_FILA === 'fora' ? 'fora' : 'ok',
  limiteRpm = process.env.SIM_LIMITE_RPM ? Number(process.env.SIM_LIMITE_RPM) : null,
  limiteCadastroPorMin = Number(process.env.LIMITE_CADASTRO_POR_MIN ?? 60),
  portalUrl = process.env.SIM_PORTAL_URL ?? 'http://localhost:5173',
  logger = false,
  estado = estadoInicial(),
} = {}) {
  const app = Fastify({
    logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    bodyLimit: TAMANHO_MAXIMO_CSV,
    ajv: { customOptions: { allErrors: true, removeAdditional: true } },
  });

  // E-mails que a API mandaria (o simulador não tem fila): os testes leem o link daqui.
  app.decorate('emailsSimulados', []);

  const timers = new Set();
  const agendar = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  app.addHook('onClose', async () => timers.forEach(clearTimeout));

  const planoDe = (nome) => {
    const p = PLANOS[nome];
    const limites = { ...p.limites, tamanho_maximo_csv_bytes: TAMANHO_MAXIMO_CSV };
    if (limiteRpm) limites.requisicoes_por_minuto = limiteRpm; // SIM_LIMITE_RPM: estoura rápido
    return { plano: nome, nome: p.nome, preco_mensal_centavos: p.preco_mensal_centavos, limites };
  };

  // ---------- rate limit: janela fixa de 1 min, em memória ----------
  const janelas = new Map();
  function consumir(chave, maximo) {
    const agora = Date.now();
    let j = janelas.get(chave);
    if (!j || agora - j.inicio >= JANELA_MS) {
      j = { inicio: agora, contagem: 0 };
      janelas.set(chave, j);
    }
    j.contagem++;
    if (j.contagem > maximo) {
      const segundos = Math.max(1, Math.ceil((j.inicio + JANELA_MS - agora) / 1000));
      throw new ErroContrato(429, 'LIMITE_REQUISICOES', { cabecalhos: { 'retry-after': String(segundos) } });
    }
  }

  // ---------- x-request-id sempre devolvido ----------
  app.addHook('onSend', async (req, rep) => {
    rep.header('x-request-id', req.id);
  });

  // ---------- autenticação + rate limit por tenant (depois da autenticação) ----------
  // onRequest: roda antes de ler e validar o corpo, então sem token é 401 (nunca 400).
  app.addHook('onRequest', async (req) => {
    if (req.is404 || req.routeOptions.config?.publica) return;
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    const claims = tipo === 'Bearer' ? verificar(token) : null;
    if (!claims || claims.finalidade || !estado.tenants.has(claims.tenant_id)) {
      throw new ErroContrato(401, 'NAO_AUTENTICADO');
    }
    req.usuario = claims;
    consumir(`tenant:${claims.tenant_id}`, planoDe(claims.plano).limites.requisicoes_por_minuto);
  });

  // ---------- formato único de erro ----------
  app.setErrorHandler((erro, req, rep) => {
    if (erro instanceof ErroContrato) {
      if (erro.cabecalhos) rep.headers(erro.cabecalhos);
      return rep.status(erro.status).send(erro.corpo);
    }
    if (erro.validation) {
      return rep
        .status(400)
        .send({ erro: MENSAGENS.VALIDACAO, codigo: 'VALIDACAO', campos: camposDaValidacao(erro.validation) });
    }
    if (erro.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return rep.status(413).send({ erro: MENSAGENS.ARQUIVO_GRANDE, codigo: 'ARQUIVO_GRANDE' });
    }
    if (erro.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return rep.status(415).send({ erro: MENSAGENS.TIPO_NAO_SUPORTADO, codigo: 'TIPO_NAO_SUPORTADO' });
    }
    if (erro.statusCode === 400) {
      // JSON malformado, corpo vazio etc.
      return rep.status(400).send({ erro: MENSAGENS.VALIDACAO, codigo: 'VALIDACAO', campos: [] });
    }
    req.log.error(erro);
    return rep
      .status(500)
      .send({ erro: `Erro interno. Se continuar, informe o código ${req.id}.`, codigo: 'ERRO_INTERNO' });
  });

  app.setNotFoundHandler((req, rep) => {
    rep.status(404).send({ erro: 'Rota não encontrada.', codigo: 'NAO_ENCONTRADO' });
  });

  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (req, corpo, done) => done(null, corpo));

  const publica = { config: { publica: true } };
  const ipDe = (req) => req.ip;

  function emitirToken(usuario) {
    const tenant = estado.tenants.get(usuario.tenant_id);
    const iat = Math.floor(Date.now() / 1000);
    return assinar({
      sub: usuario.id,
      tenant_id: tenant.id,
      plano: tenant.plano,
      papel: usuario.papel,
      iat,
      exp: iat + TOKEN_SEGUNDOS,
    });
  }

  // =====================================================================
  // Rotas públicas (contrato, seção 4)
  // =====================================================================
  app.get('/saude', publica, async () => ({ db: 'ok', fila }));

  // Pública e sem rate limit (contrato, seção 7): só lê memória.
  app.get('/planos', publica, async () => ({ itens: Object.keys(PLANOS).map(planoDe) }));

  const texto = (max, min = 1) => ({ type: 'string', minLength: min, maxLength: max });

  app.post(
    '/auth/cadastro',
    {
      ...publica,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['empresa', 'plano', 'nome', 'email', 'senha'],
          properties: {
            empresa: texto(120),
            plano: { type: 'string', enum: ['individual', 'equipe'] },
            nome: texto(120),
            email: { type: 'string', format: 'email', maxLength: 254 },
            senha: texto(128, 8),
          },
        },
      },
    },
    async (req, rep) => {
      consumir(`cadastro:${ipDe(req)}`, limiteCadastroPorMin);
      const { empresa, plano, nome, senha } = req.body;
      const email = req.body.email.toLowerCase();
      if ([...estado.usuarios.values()].some((u) => u.email === email)) {
        throw new ErroContrato(409, 'EMAIL_JA_CADASTRADO');
      }
      const agora = new Date().toISOString();
      const tenant = { id: randomUUID(), nome: empresa, plano, criado_em: agora, cancelado_em: null };
      estado.tenants.set(tenant.id, tenant);
      const usuario = {
        id: randomUUID(),
        tenant_id: tenant.id,
        nome,
        email,
        senha_hash: gerarHash(senha),
        papel: 'admin',
        criado_em: agora,
        email_confirmado_em: null,
      };
      estado.usuarios.set(usuario.id, usuario);

      // "Envia" o e-mail de confirmação: no simulador, o link vai para o log (bloco 10 manda de verdade).
      const iat = Math.floor(Date.now() / 1000);
      const tokenConfirmacao = assinar({ sub: usuario.id, finalidade: 'confirmar', iat, exp: iat + 24 * 3600 });
      req.log.info(`[e-mail simulado] confirmar: ${portalUrl}/confirmar-email?token=${tokenConfirmacao}`);

      return rep.status(201).send({ token: emitirToken(usuario) });
    },
  );

  app.post(
    '/auth/login',
    {
      ...publica,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'senha'],
          // Igual à API (rotas/auth.js): e-mail malformado ou senha vazia dão 400 VALIDACAO com campos, não 401.
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            senha: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (req) => {
      const email = req.body.email.toLowerCase();
      consumir(`login:${ipDe(req)}:${email}`, 10);
      const usuario = [...estado.usuarios.values()].find((u) => u.email === email);
      const tenant = usuario && estado.tenants.get(usuario.tenant_id);
      // Mesmo corpo para e-mail inexistente, senha errada e tenant cancelado (T-AUTH-05).
      if (!usuario || tenant.cancelado_em || !conferirSenha(req.body.senha, usuario.senha_hash)) {
        throw new ErroContrato(401, 'CREDENCIAIS_INVALIDAS');
      }
      return { token: emitirToken(usuario) };
    },
  );

  app.get('/auth/confirmar', publica, async (req) => {
    const claims = verificar(req.query?.token);
    const usuario = claims?.finalidade === 'confirmar' && estado.usuarios.get(claims.sub);
    if (!usuario) throw new ErroContrato(400, 'LINK_INVALIDO');
    usuario.email_confirmado_em ??= new Date().toISOString();
    return { confirmado_em: usuario.email_confirmado_em };
  });

  // =====================================================================
  // Contatos (contrato, seção 5)
  // =====================================================================
  const propsContato = {
    nome: texto(120),
    email: { type: ['string', 'null'], format: 'email', maxLength: 254 },
    telefone: { type: ['string', 'null'], maxLength: 30 },
    empresa: { type: ['string', 'null'], maxLength: 120 },
    observacao: { type: ['string', 'null'], maxLength: 500 },
    estagio: { type: 'string', enum: ['lead', 'proposta', 'cliente', 'perdido'] },
  };

  const contatosDoTenant = (tenantId) => [...estado.contatos.values()].filter((c) => c.tenant_id === tenantId);

  function buscarContato(req) {
    const { id } = req.params;
    const c = UUID.test(id) ? estado.contatos.get(id) : null;
    if (!c || c.tenant_id !== req.usuario.tenant_id) throw naoEncontrado(CONTATO_NAO_ENCONTRADO);
    return c;
  }

  function conferirEmailUnico(tenantId, email, ignorarId) {
    if (email && contatosDoTenant(tenantId).some((c) => c.email === email && c.id !== ignorarId)) {
      throw new ErroContrato(409, 'EMAIL_DUPLICADO');
    }
  }

  app.get(
    '/contatos',
    { schema: { querystring: { type: 'object', properties: { busca: { type: 'string', maxLength: 100 } } } } },
    async (req) => {
      const limite = 100;
      const termo = (req.query.busca ?? '').trim().toLowerCase();
      const itens = contatosDoTenant(req.usuario.tenant_id)
        .filter(
          (c) =>
            !termo ||
            [c.nome, c.email, c.empresa].some((v) => v && v.toLowerCase().includes(termo)), // ILIKE
        )
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .slice(0, limite)
        .map(contatoPublico);
      return { itens, limite };
    },
  );

  app.get(
    '/contatos/esfriando',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            dias: { type: 'integer', minimum: 1, maximum: 365, default: 90 },
            limite: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
          },
        },
      },
    },
    async (req) => {
      const { dias, limite } = req.query;
      const agora = Date.now();
      const itens = contatosDoTenant(req.usuario.tenant_id)
        .filter((c) => c.estagio !== 'perdido')
        .map((c) => ({ c, ref: Date.parse(c.ultima_interacao_em ?? c.criado_em) })) // COALESCE
        .filter(({ ref }) => agora - ref > dias * DIA)
        .sort((a, b) => a.ref - b.ref || (a.c.id < b.c.id ? -1 : 1)) // ORDER BY referência, id
        .slice(0, limite)
        .map(({ c, ref }) => ({
          ...contatoPublico(c),
          dias_sem_interacao: Math.floor((agora - ref) / DIA),
          nunca_contatado: c.ultima_interacao_em === null,
        }));
      return { itens, dias, limite };
    },
  );

  app.post(
    '/contatos',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['nome'], properties: propsContato } } },
    async (req, rep) => {
      const tenantId = req.usuario.tenant_id;
      const email = req.body.email ? req.body.email.toLowerCase() : null;
      conferirEmailUnico(tenantId, email);
      const agora = new Date().toISOString();
      const c = {
        id: randomUUID(),
        tenant_id: tenantId,
        nome: req.body.nome,
        email,
        telefone: req.body.telefone ?? null,
        empresa: req.body.empresa ?? null,
        observacao: req.body.observacao ?? null,
        estagio: req.body.estagio ?? 'lead',
        ultima_interacao_em: null,
        criado_em: agora,
        atualizado_em: agora,
      };
      estado.contatos.set(c.id, c);
      return rep.status(201).send(contatoPublico(c));
    },
  );

  app.get('/contatos/:id', async (req) => contatoPublico(buscarContato(req)));

  app.patch(
    '/contatos/:id',
    { schema: { body: { type: 'object', additionalProperties: false, properties: propsContato } } },
    async (req) => {
      const c = buscarContato(req);
      const mudancas = { ...req.body };
      if ('email' in mudancas) {
        mudancas.email = mudancas.email ? mudancas.email.toLowerCase() : null;
        conferirEmailUnico(c.tenant_id, mudancas.email, c.id);
      }
      Object.assign(c, mudancas, { atualizado_em: new Date().toISOString() });
      return contatoPublico(c);
    },
  );

  app.delete('/contatos/:id', async (req, rep) => {
    const c = buscarContato(req);
    estado.contatos.delete(c.id);
    for (const [id, i] of estado.interacoes) if (i.contato_id === c.id) estado.interacoes.delete(id); // CASCADE
    return rep.status(204).send();
  });

  // =====================================================================
  // Interações (contrato, seção 6)
  // =====================================================================
  app.get('/contatos/:id/interacoes', async (req) => {
    const c = buscarContato(req);
    const itens = [...estado.interacoes.values()]
      .filter((i) => i.contato_id === c.id)
      .sort((a, b) => Date.parse(b.ocorrida_em) - Date.parse(a.ocorrida_em) || (a.id < b.id ? 1 : -1)) // ocorrida_em DESC, id DESC
      .map(interacaoPublica);
    return { itens };
  });

  app.post(
    '/contatos/:id/interacoes',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tipo'],
          properties: {
            tipo: { type: 'string', enum: ['ligacao', 'whatsapp', 'email', 'reuniao', 'outro'] },
            nota: { type: ['string', 'null'], maxLength: 2000 },
            ocorrida_em: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (req, rep) => {
      const c = buscarContato(req);
      const agora = new Date();
      const ocorrida = req.body.ocorrida_em ? new Date(req.body.ocorrida_em) : agora;
      if (ocorrida.getTime() > agora.getTime() + 5 * 60 * 1000) {
        // 5 min de tolerância para o relógio adiantado do celular
        throw new ErroContrato(400, 'VALIDACAO', {
          extras: { campos: [{ campo: 'ocorrida_em', erro: 'A data não pode estar no futuro.' }] },
        });
      }
      const i = {
        id: randomUUID(),
        tenant_id: c.tenant_id,
        contato_id: c.id,
        usuario_id: req.usuario.sub,
        tipo: req.body.tipo,
        nota: req.body.nota?.trim() || null, // só espaços vira null, como na API
        ocorrida_em: ocorrida.toISOString(),
        criado_em: agora.toISOString(),
      };
      estado.interacoes.set(i.id, i);
      // GREATEST: lançar hoje uma ligação antiga não esfria o contato
      if (!c.ultima_interacao_em || Date.parse(c.ultima_interacao_em) < ocorrida.getTime()) {
        c.ultima_interacao_em = i.ocorrida_em;
      }
      c.atualizado_em = agora.toISOString();
      return rep.status(201).send({ interacao: interacaoPublica(i), contato: contatoPublico(c) });
    },
  );

  // =====================================================================
  // Importações (contrato, seção 7)
  // =====================================================================
  function processarImportacao(imp) {
    // Simula o worker: valida as linhas, informa o início e aplica um lote a cada 500 ms.
    agendar(() => {
      const { colunas, sep, dados } = imp.csv;
      const idx = (nome) => colunas.indexOf(nome);
      const validas = [];
      const emailsVistos = new Set(); // contrato 1.2: e-mail repetido no arquivo é erro de linha
      for (const linha of dados) {
        const campos = separarCampos(linha, sep);
        const valor = (nome) => (idx(nome) >= 0 ? campos[idx(nome)] || null : null);
        const nome = valor('nome');
        const email = valor('email')?.toLowerCase() ?? null;
        if (!nome || nome.length > 120 || !email || email.length > 254 || !EMAIL_VALIDO.test(email)) continue;
        if (emailsVistos.has(email)) continue; // conta em linhas_invalidas, como no worker
        emailsVistos.add(email);
        validas.push({
          nome,
          email,
          telefone: valor('telefone')?.slice(0, 30) ?? null,
          empresa: valor('empresa')?.slice(0, 120) ?? null,
          observacao: valor('observacao')?.slice(0, 500) ?? null,
        });
      }
      delete imp.csv;
      imp.linhas_invalidas = imp.total_linhas - validas.length;
      imp.total_lotes = Math.ceil(validas.length / LOTE);
      imp.status = 'processando';
      if (imp.total_lotes === 0) return concluir(imp);

      const aplicarLote = (numero) => {
        const agora = new Date().toISOString();
        for (const linha of validas.slice((numero - 1) * LOTE, numero * LOTE)) {
          // upsert ON CONFLICT (tenant_id, email). Contrato 1.2 (COALESCE): célula vazia não apaga o que existia.
          const existente = contatosDoTenant(imp.tenant_id).find((c) => c.email === linha.email);
          if (existente) {
            existente.nome = linha.nome;
            for (const campo of ['telefone', 'empresa', 'observacao']) existente[campo] = linha[campo] ?? existente[campo];
            existente.atualizado_em = agora;
          }
          else {
            const c = {
              id: randomUUID(),
              tenant_id: imp.tenant_id,
              ...linha,
              estagio: 'lead',
              ultima_interacao_em: null,
              criado_em: agora,
              atualizado_em: agora,
            };
            estado.contatos.set(c.id, c);
          }
        }
        imp.lotes_aplicados = numero;
        if (numero === imp.total_lotes) concluir(imp);
        else agendar(() => aplicarLote(numero + 1), PAUSA_LOTE_MS);
      };
      agendar(() => aplicarLote(1), PAUSA_LOTE_MS);
    }, PAUSA_LOTE_MS);
  }
  function concluir(imp) {
    imp.status = 'concluida';
    imp.concluida_em = new Date().toISOString();
  }

  app.post('/importacoes', async (req, rep) => {
    if (typeof req.body !== 'string') throw new ErroContrato(415, 'TIPO_NAO_SUPORTADO');
    const tenantId = req.usuario.tenant_id;
    const { limites } = planoDe(req.usuario.plano);

    // 1. só o cabeçalho e a contagem de linhas
    const csv = lerCsv(req.body);
    if (!csv.colunas) throw new ErroContrato(422, 'CSV_VAZIO');
    if (!csv.colunas.includes('nome') || !csv.colunas.includes('email')) {
      throw new ErroContrato(422, 'CSV_SEM_COLUNAS');
    }
    const linhas = csv.dados.length;
    if (linhas === 0) throw new ErroContrato(422, 'CSV_VAZIO');

    // 2. limite do plano e importações simultâneas (contadas no "banco")
    if (linhas > limites.linhas_por_importacao) {
      throw new ErroContrato(422, 'LINHAS_ACIMA_DO_PLANO', {
        erro: `Seu plano permite até ${limites.linhas_por_importacao} linhas por importação.`,
        extras: { limite: limites.linhas_por_importacao, linhas },
      });
    }
    const emAndamento = [...estado.importacoes.values()].filter(
      (i) => i.tenant_id === tenantId && (i.status === 'na_fila' || i.status === 'processando'),
    ).length;
    if (emAndamento >= limites.importacoes_simultaneas) {
      throw new ErroContrato(429, 'IMPORTACOES_SIMULTANEAS', { extras: { limite: limites.importacoes_simultaneas } });
    }

    // 4. enfileirar: com a fila fora, desfaz e responde 503 (aqui nem chega a gravar)
    if (fila === 'fora') throw new ErroContrato(503, 'FILA_INDISPONIVEL');

    // 3. registro na_fila, total_lotes e linhas_invalidas nulos (quem calcula é o worker)
    const imp = {
      id: randomUUID(),
      tenant_id: tenantId,
      status: 'na_fila',
      total_linhas: linhas,
      linhas_invalidas: null,
      total_lotes: null,
      lotes_aplicados: 0,
      criado_em: new Date().toISOString(),
      concluida_em: null,
      csv,
    };
    estado.importacoes.set(imp.id, imp);
    processarImportacao(imp);
    return rep.status(202).send({ importacao_id: imp.id });
  });

  app.get('/importacoes/:id', async (req) => {
    const { id } = req.params;
    const imp = UUID.test(id) ? estado.importacoes.get(id) : null;
    if (!imp || imp.tenant_id !== req.usuario.tenant_id) throw naoEncontrado(IMPORTACAO_NAO_ENCONTRADA);
    return importacaoPublica(imp);
  });

  // =====================================================================
  // Conta (contrato, seção 9) — só admin
  // =====================================================================
  function exigirAdmin(req) {
    if (req.usuario.papel !== 'admin') throw new ErroContrato(403, 'SEM_PERMISSAO');
  }

  function exportar(tenantId) {
    const t = estado.tenants.get(tenantId);
    const doTenant = (mapa) => [...mapa.values()].filter((x) => x.tenant_id === tenantId);
    return {
      tenant: { id: t.id, nome: t.nome, plano: t.plano, criado_em: t.criado_em, cancelado_em: t.cancelado_em },
      usuarios: doTenant(estado.usuarios).map(({ senha_hash, tenant_id, ...u }) => u), // eslint-disable-line no-unused-vars
      contatos: doTenant(estado.contatos).map(contatoPublico),
      interacoes: doTenant(estado.interacoes).map(interacaoPublica),
      importacoes: doTenant(estado.importacoes).map(importacaoPublica),
    };
  }
  function enviarExportacao(rep, tenantId) {
    const data = new Date().toISOString().slice(0, 10);
    rep.header('content-disposition', `attachment; filename="orbitati-exportacao-${data}.json"`);
    return exportar(tenantId);
  }

  app.get('/conta/exportacao', async (req, rep) => {
    exigirAdmin(req);
    return enviarExportacao(rep, req.usuario.tenant_id);
  });

  // Contrato 1.6: com a fila de e-mail fora (SIM_FILA=fora), 503 e NADA muda. O link é o único caminho até os
  // dados depois do cancelamento, então a API não cancela sem conseguir mandá-lo.
  app.post('/conta/cancelamento', async (req) => {
    exigirAdmin(req);
    if (fila === 'fora') {
      throw new ErroContrato(503, 'FILA_INDISPONIVEL', {
        erro: 'Não foi possível cancelar agora: o envio do link de exportação está fora do ar. Tente de novo em instantes.',
      });
    }
    const t = estado.tenants.get(req.usuario.tenant_id);
    t.cancelado_em ??= new Date().toISOString();
    const ate = new Date(Date.parse(t.cancelado_em) + 30 * DIA).toISOString();
    const iat = Math.floor(Date.now() / 1000);
    // Mesmo desenho da API: finalidade "exportar-conta" e validade até cancelado_em + 30 dias.
    const tokenExportacao = assinar({ sub: req.usuario.sub, tenant_id: t.id, finalidade: 'exportar-conta', iat, exp: Math.floor(Date.parse(ate) / 1000) });
    const link = `${portalUrl}/api/conta/exportacao/arquivo?token=${tokenExportacao}`;
    app.emailsSimulados.push({ tipo: 'exportacao-disponivel', tenant_id: t.id, link });
    req.log.info(`[e-mail simulado] exportação: ${link}`);
    return { cancelado_em: t.cancelado_em, exportacao_disponivel_ate: ate };
  });

  app.get('/conta/exportacao/arquivo', publica, async (req, rep) => {
    consumir(`exportacao:${ipDe(req)}`, 10); // 10/min por IP, como na API
    const claims = verificar(req.query?.token);
    if (claims?.finalidade !== 'exportar-conta' || !estado.tenants.has(claims.tenant_id)) {
      throw new ErroContrato(400, 'LINK_INVALIDO');
    }
    return enviarExportacao(rep, claims.tenant_id);
  });

  return app;
}

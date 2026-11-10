// npm run seed: cria os dois tenants de demonstração pelos endpoints públicos da API, como um usuário faria.
//
//   DevSolo Sistemas       individual  marcelo@devsolo.dev        5 contatos, 4 interações
//   TechConsult Solutions  equipe      gestor@techconsult.com.br  20 contatos, 16 interações
//   Senha das duas: Demo@2026
//
// Por que pela API e não por SQL: o seed passa pelas mesmas regras de produção (hash Argon2, RLS, DEFAULT do
// tenant_id) e não precisa de nenhum papel privilegiado do banco.
//
// Idempotente: se a conta já existe (409), só avisa, entra com login e cria apenas os contatos que faltam,
// comparando pelo NOME (alguns contatos não têm e-mail, que é opcional, então o e-mail não serve de chave).
// Assim uma execução interrompida no meio é completada pela próxima, sem duplicar nada.
//
// Interações (bloco 12): cada contato com "dias desde a última interação" ganha UMA interação com
// ocorrida_em no passado (a rota aceita data retroativa; o futuro é que é recusado). É isso que enche o
// "Saindo de órbita" na demo: alguns com mais de 90 dias, um com mais de 365 e alguns recentes.
// A chave de idempotência é a NOTA_SEED: contato que ainda não tem a interação do seed recebe o estágio e a
// interação; contato que já tem fica como está (o seed não desfaz o que alguém mudou na demo).
//
// Limitação aceita: a API grava criado_em = agora, então o seed não consegue criar um contato frio
// "nunca contatado" (no simulador, Carlos Menezes tem 180 dias de cadastro). Aqui ele fica sem interação e,
// portanto, fora do "Saindo de órbita" por 90 dias. Efeito na Fase 6: docs/portal-pendencias.md.
//
// Rate limit: a DevSolo é plano individual (60 req/min). Uma execução completa faz cerca de 20 requisições.
// Se mesmo assim vier 429 (ex.: duas execuções seguidas), o chamar() espera o Retry-After e tenta de novo.
//
// Os nomes, empresas, estágios e dias são os mesmos do simulador (web/simulador/dados.js): a demo e as
// capturas do Portal mostram os mesmos dados nos dois ambientes.
//
// Variável: SEED_URL (padrão http://localhost:3000). No kind: SEED_URL=http://localhost:30080 npm run seed
//
// --sem-mudancas (npm run seed -- --sem-mudancas): termina com código 1 se criar ou alterar QUALQUER coisa
// (conta, contato, estágio ou interação). O CI roda o seed duas vezes no banco vazio; a segunda, com esta
// flag, prova a idempotência.

const BASE = (process.env.SEED_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SENHA = 'Demo@2026';
const NOTA_SEED = 'Conversamos sobre o próximo passo.'; // mesma nota do simulador; é a chave de idempotência
const TIPOS = ['whatsapp', 'ligacao', 'email', 'reuniao']; // por posição, como no simulador
const DIA = 24 * 60 * 60 * 1000;
const diasAtras = (n) => new Date(Date.now() - n * DIA).toISOString();
const TENTATIVAS_429 = 3;
const SEM_MUDANCAS = process.argv.includes('--sem-mudancas');
let mudancas = 0; // tudo o que esta execução criou ou alterou (conta, contato, estágio, interação)

const TENANTS = [
  {
    empresa: 'DevSolo Sistemas',
    plano: 'individual',
    nome: 'Marcelo',
    email: 'marcelo@devsolo.dev',
    dominio: 'exemplo.com.br',
    // [nome, empresa, estagio, dias desde a última interação | null]
    contatos: [
      ['João Servidor', 'Mercado Bom Preço', 'proposta', 412],
      ['Ana Ribeiro', 'Clínica Vida', 'proposta', 241],
      ['Carlos Menezes', null, 'lead', null],
      ['Patrícia Lopes', 'Escritório Lopes & Filhos', 'cliente', 20],
      ['Rafael Gomes', 'Auto Peças Gomes', 'lead', 96],
    ],
  },
  {
    empresa: 'TechConsult Solutions',
    plano: 'equipe',
    nome: 'Gestor TechConsult',
    email: 'gestor@techconsult.com.br',
    dominio: 'cliente.com.br',
    contatos: [
      ['Beatriz Andrade', 'Construtora Andrade', 'cliente', 5],
      ['Diego Fernandes', 'Farmácia Popular Centro', 'proposta', 380],
      ['Eduarda Martins', 'Martins Advocacia', 'lead', 150],
      ['Fábio Costa', 'Costa Transportes', 'cliente', 30],
      ['Gabriela Nunes', 'Escola Pequeno Príncipe', 'lead', null],
      ['Henrique Silva', 'Silva & Silva Contabilidade', 'proposta', 210],
      ['Isabela Rocha', 'Rocha Imóveis', 'perdido', 400],
      ['Jorge Almeida', 'Padaria Pão Quente', 'lead', null],
      ['Karina Duarte', 'Duarte Odontologia', 'cliente', 60],
      ['Leonardo Pires', 'Pires Engenharia', 'proposta', 99],
      ['Mariana Teixeira', 'Hotel Serra Verde', 'lead', 10],
      ['Nicolas Barbosa', 'Barbosa Agro', 'cliente', 365],
      ['Olívia Cardoso', 'Cardoso Eventos', 'lead', null],
      ['Paulo Ribeiro', 'Supermercado Ribeiro', 'proposta', 120],
      ['Quésia Moura', 'Moura Têxtil', 'perdido', 200],
      ['Renato Lima', 'Lima Distribuidora', 'cliente', 2],
      ['Sabrina Gomes', 'Gomes Pet Shop', 'lead', 70],
      ['Tiago Mendes', 'Mendes Logística', 'proposta', 185],
      ['Úrsula Freitas', 'Freitas Arquitetura', 'lead', null],
      ['Vinícius Araújo', 'Araújo Seguros', 'cliente', 15],
    ],
  },
];

/** "João Servidor" -> "joao.servidor@dominio" (sem acento). */
const emailDe = (nome, dominio) =>
  `${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.')}@${dominio}`;

/** Mesmo padrão do simulador: um em cada 4 sem e-mail, um em cada 3 sem telefone, metade com observação. */
const contatoFicticio = ([nome, empresa, estagio], i, dominio) => ({
  nome,
  empresa,
  estagio,
  email: i % 4 === 3 ? null : emailDe(nome, dominio),
  telefone: i % 3 === 2 ? null : `(54) 99${100 + i}-${1000 + i * 37}`,
  observacao: i % 2 === 0 ? 'Conheci numa visita técnica; quer revisar a rede.' : null,
});

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function chamar(metodo, caminho, { token, corpo } = {}, tentativa = 1) {
  let resposta;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: {
        ...(corpo ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new Error(`API fora do ar em ${BASE}. Suba a stack: docker compose up -d --build --wait`);
  }
  const texto = await resposta.text();
  if (resposta.status === 429 && tentativa < TENTATIVAS_429) {
    // Rate limit do plano (60/min no individual). Espera o que a API mandou e tenta de novo.
    const segundos = Number(resposta.headers.get('retry-after')) || 60;
    console.log(`  (rate limit do plano: esperando ${segundos} s)`);
    await esperar(segundos * 1000);
    return chamar(metodo, caminho, { token, corpo }, tentativa + 1);
  }
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
}

const falhou = (o, r) => new Error(`${o} falhou: ${r.status} ${JSON.stringify(r.corpo)}`);

async function semear(t) {
  const cadastro = await chamar('POST', '/auth/cadastro', {
    corpo: { empresa: t.empresa, plano: t.plano, nome: t.nome, email: t.email, senha: SENHA },
  });
  let token;
  if (cadastro.status === 201) {
    token = cadastro.corpo.token;
    mudancas += 1;
    console.log(`+ ${t.empresa}: conta criada (${t.email}, plano ${t.plano})`);
  } else if (cadastro.status === 409) {
    const login = await chamar('POST', '/auth/login', { corpo: { email: t.email, senha: SENHA } });
    if (login.status !== 200) throw falhou(`login de ${t.email} (a conta existe, mas a senha não é ${SENHA}?)`, login);
    token = login.corpo.token;
    console.log(`= ${t.empresa}: a conta já existe (${t.email}); conferindo os contatos`);
  } else {
    throw falhou(`cadastro de ${t.email}`, cadastro);
  }

  const lista = await chamar('GET', '/contatos', { token });
  if (lista.status !== 200) throw falhou('listagem de contatos', lista);
  const existentes = new Map(lista.corpo.itens.map((c) => [c.nome, c]));

  let criados = 0;
  let interacoes = 0;
  for (const [i, dados] of t.contatos.entries()) {
    const [nome, , estagio, diasInteracao] = dados;
    let contato = existentes.get(nome);
    if (!contato) {
      const r = await chamar('POST', '/contatos', { token, corpo: contatoFicticio(dados, i, t.dominio) });
      if (r.status !== 201) throw falhou(`contato ${nome}`, r);
      contato = r.corpo;
      criados += 1;
      mudancas += 1;
    } else if (diasInteracao !== null) {
      // Contato que já existia (ex.: seed de antes do bloco 12). Só mexe se ainda não tem a interação do seed.
      // Contato SEM interação prevista nunca é mexido: não há marca para saber se o estágio dele foi mudado
      // de propósito na demo (e no seed todos eles são 'lead', o padrão).
      const hist = await chamar('GET', `/contatos/${contato.id}/interacoes`, { token });
      if (hist.status !== 200) throw falhou(`interações de ${nome}`, hist);
      if (hist.corpo.itens.some((x) => x.nota === NOTA_SEED)) continue;
      if (contato.estagio !== estagio) {
        const p = await chamar('PATCH', `/contatos/${contato.id}`, { token, corpo: { estagio } });
        if (p.status !== 200) throw falhou(`estágio de ${nome}`, p);
        mudancas += 1;
      }
    } else {
      continue; // já existe e não tem interação prevista
    }
    if (diasInteracao === null) continue;
    const r = await chamar('POST', `/contatos/${contato.id}/interacoes`, {
      token,
      corpo: { tipo: TIPOS[i % TIPOS.length], nota: NOTA_SEED, ocorrida_em: diasAtras(diasInteracao) },
    });
    if (r.status !== 201) throw falhou(`interação de ${nome}`, r);
    interacoes += 1;
    mudancas += 1;
  }
  console.log(
    criados === 0 && interacoes === 0
      ? `  ${t.contatos.length} contatos e interações já estavam lá; nada a fazer`
      : `  ${criados} contato(s) e ${interacoes} interação(ões) criados; total esperado ${t.contatos.length} contatos`,
  );
}

try {
  console.log(`Seed de demonstração em ${BASE}`);
  for (const t of TENANTS) await semear(t);
  if (SEM_MUDANCAS && mudancas > 0) {
    throw new Error(`--sem-mudancas: esta execução criou ou alterou ${mudancas} item(ns); o seed não é idempotente`);
  }
  console.log(`Pronto. Senha das duas contas: ${SENHA}`);
} catch (erro) {
  console.error(`ERRO: ${erro.message}`);
  process.exitCode = 1;
}

// npm run seed: cria os dois tenants de demonstração pelos endpoints públicos da API, como um usuário faria.
//
//   DevSolo Sistemas       individual  marcelo@devsolo.dev        5 contatos
//   TechConsult Solutions  equipe      gestor@techconsult.com.br  20 contatos
//   Senha das duas: Demo@2026
//
// Por que pela API e não por SQL: o seed passa pelas mesmas regras de produção (hash Argon2, RLS, DEFAULT do
// tenant_id) e não precisa de nenhum papel privilegiado do banco.
//
// Idempotente: se a conta já existe (409), só avisa, entra com login e cria apenas os contatos que faltam,
// comparando pelo NOME (alguns contatos não têm e-mail, que é opcional, então o e-mail não serve de chave).
// Assim uma execução interrompida no meio é completada pela próxima, sem duplicar nada.
//
// Os nomes e empresas são os mesmos do simulador (web/simulador/dados.js): a demo e as capturas do Portal
// mostram os mesmos dados nos dois ambientes. Estágio e interações entram no bloco 12.
//
// Variável: SEED_URL (padrão http://localhost:3000). No kind: SEED_URL=http://localhost:30080 npm run seed

const BASE = (process.env.SEED_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SENHA = 'Demo@2026';

const TENANTS = [
  {
    empresa: 'DevSolo Sistemas',
    plano: 'individual',
    nome: 'Marcelo',
    email: 'marcelo@devsolo.dev',
    dominio: 'exemplo.com.br',
    contatos: [
      ['João Servidor', 'Mercado Bom Preço'],
      ['Ana Ribeiro', 'Clínica Vida'],
      ['Carlos Menezes', null],
      ['Patrícia Lopes', 'Escritório Lopes & Filhos'],
      ['Rafael Gomes', 'Auto Peças Gomes'],
    ],
  },
  {
    empresa: 'TechConsult Solutions',
    plano: 'equipe',
    nome: 'Gestor TechConsult',
    email: 'gestor@techconsult.com.br',
    dominio: 'cliente.com.br',
    contatos: [
      ['Beatriz Andrade', 'Construtora Andrade'],
      ['Diego Fernandes', 'Farmácia Popular Centro'],
      ['Eduarda Martins', 'Martins Advocacia'],
      ['Fábio Costa', 'Costa Transportes'],
      ['Gabriela Nunes', 'Escola Pequeno Príncipe'],
      ['Henrique Silva', 'Silva & Silva Contabilidade'],
      ['Isabela Rocha', 'Rocha Imóveis'],
      ['Jorge Almeida', 'Padaria Pão Quente'],
      ['Karina Duarte', 'Duarte Odontologia'],
      ['Leonardo Pires', 'Pires Engenharia'],
      ['Mariana Teixeira', 'Hotel Serra Verde'],
      ['Nicolas Barbosa', 'Barbosa Agro'],
      ['Olívia Cardoso', 'Cardoso Eventos'],
      ['Paulo Ribeiro', 'Supermercado Ribeiro'],
      ['Quésia Moura', 'Moura Têxtil'],
      ['Renato Lima', 'Lima Distribuidora'],
      ['Sabrina Gomes', 'Gomes Pet Shop'],
      ['Tiago Mendes', 'Mendes Logística'],
      ['Úrsula Freitas', 'Freitas Arquitetura'],
      ['Vinícius Araújo', 'Araújo Seguros'],
    ],
  },
];

/** "João Servidor" -> "joao.servidor@dominio" (sem acento). */
const emailDe = (nome, dominio) =>
  `${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.')}@${dominio}`;

/** Mesmo padrão do simulador: um em cada 4 sem e-mail, um em cada 3 sem telefone, metade com observação. */
const contatoFicticio = ([nome, empresa], i, dominio) => ({
  nome,
  empresa,
  email: i % 4 === 3 ? null : emailDe(nome, dominio),
  telefone: i % 3 === 2 ? null : `(54) 99${100 + i}-${1000 + i * 37}`,
  observacao: i % 2 === 0 ? 'Conheci numa visita técnica; quer revisar a rede.' : null,
});

async function chamar(metodo, caminho, { token, corpo } = {}) {
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
  const existentes = new Set(lista.corpo.itens.map((c) => c.nome));

  let criados = 0;
  for (const [i, dados] of t.contatos.entries()) {
    if (existentes.has(dados[0])) continue;
    const r = await chamar('POST', '/contatos', { token, corpo: contatoFicticio(dados, i, t.dominio) });
    if (r.status !== 201) throw falhou(`contato ${dados[0]}`, r);
    criados += 1;
  }
  console.log(
    criados === 0
      ? `  ${t.contatos.length} contatos já estavam lá; nada a fazer`
      : `  ${criados} contato(s) criado(s); total esperado ${t.contatos.length}`,
  );
}

try {
  console.log(`Seed de demonstração em ${BASE}`);
  for (const t of TENANTS) await semear(t);
  console.log(`Pronto. Senha das duas contas: ${SENHA}`);
} catch (erro) {
  console.error(`ERRO: ${erro.message}`);
  process.exitCode = 1;
}

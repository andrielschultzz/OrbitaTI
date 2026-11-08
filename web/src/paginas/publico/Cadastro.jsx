import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { AlertTriangle, Check, RotateCcw, Rocket } from 'lucide-react';
import { api } from '../../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../../api/mensagens.js';
import { usePlanos } from '../../api/usePlanos.js';
import { useSessao } from '../../sessao/ProvedorSessao.jsx';
import { formatarPreco } from '../../util/formatos.js';
import Campo from '../../componentes/ui/Campo.jsx';
import Botao from '../../componentes/ui/Botao.jsx';
import LayoutPublico from './LayoutPublico.jsx';

const SENHA_MIN = 8; // contrato, seção 4 (NIST SP 800-63B)
const SENHA_MAX = 128;

// O que cada cartão mostra: só o que existe hoje (nada de propostas, webhooks ou histórico).
function itensDoPlano({ limites: l }) {
  return [
    l.usuarios === 1 ? '1 usuário' : `Até ${l.usuarios} usuários`,
    `Até ${l.linhas_por_importacao.toLocaleString('pt-BR')} linhas por importação`,
    `${l.importacoes_simultaneas} importações ao mesmo tempo`,
  ];
}

function CartoesPlano({ valor, aoMudar, erro }) {
  const { itens, erro: erroCarga, recarregar } = usePlanos();

  if (erroCarga) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-campo border border-borda-sutil p-4">
        <p className="text-texto-secundario">Não conseguimos carregar os planos.</p>
        <Botao variante="secundario" icone={RotateCcw} onClick={recarregar}>
          Tentar de novo
        </Botao>
      </div>
    );
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={erro ? 'erro-plano' : undefined}>
      <legend className="mb-1 text-sm font-medium text-texto-secundario">Plano</legend>
      <div className="grid gap-3 md:grid-cols-2" aria-busy={!itens}>
        {!itens &&
          [0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-cartao bg-superficie-ativa" />)}
        {itens?.map((p) => {
          const ativo = valor === p.plano;
          return (
            <label
              key={p.plano}
              className={`relative flex cursor-pointer flex-col gap-3 rounded-cartao border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foco ${
                ativo ? 'border-primario bg-superficie-ativa shadow-[var(--brilho-ativo)]' : 'border-borda-campo hover:border-texto-secundario'
              }`}
            >
              <input
                type="radio"
                name="plano"
                value={p.plano}
                checked={ativo}
                onChange={() => aoMudar(p.plano)}
                className="sr-only"
              />
              <span className="flex items-start justify-between gap-2">
                <span className="font-titulo text-lg font-bold">{p.nome}</span>
                <span
                  aria-hidden="true"
                  className={`grid size-6 shrink-0 place-items-center rounded-full border ${
                    ativo ? 'border-primario bg-primario text-sobre-primario' : 'border-borda-campo'
                  }`}
                >
                  {ativo && <Check className="size-4" />}
                </span>
              </span>
              <span>
                <span className="font-titulo text-2xl font-extrabold">{formatarPreco(p.preco_mensal_centavos)}</span>
                <span className="text-texto-secundario">/mês</span>
              </span>
              <ul className="flex flex-col gap-1 text-sm text-texto-secundario">
                {itensDoPlano(p).map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sucesso" />
                    {t}
                  </li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>
      {erro && (
        <p id="erro-plano" className="text-sm text-erro">
          {erro}
        </p>
      )}
    </fieldset>
  );
}

export default function Cadastro() {
  const { sessao, entrar } = useSessao();
  const navegar = useNavigate();
  const [dados, setDados] = useState({ empresa: '', nome: '', email: '', senha: '', plano: 'individual' });
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const refForm = useRef(null);

  if (sessao) return <Navigate to="/contatos" replace />;

  const mudar = (campo) => (e) => {
    setDados((d) => ({ ...d, [campo]: e.target.value }));
    if (erros[campo]) setErros((x) => ({ ...x, [campo]: undefined }));
  };

  function validar() {
    const e = {};
    if (!dados.empresa.trim()) e.empresa = 'Informe o nome da empresa.';
    if (!dados.nome.trim()) e.nome = 'Informe seu nome.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email.trim())) e.email = 'Informe um e-mail válido.';
    if (dados.senha.length < SENHA_MIN) e.senha = `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
    if (dados.senha.length > SENHA_MAX) e.senha = `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;
    return e;
  }

  // Leva o foco ao primeiro campo com erro: quem usa teclado ou leitor de tela vai direto ao problema.
  function focarPrimeiroErro() {
    requestAnimationFrame(() => refForm.current?.querySelector('[aria-invalid="true"]')?.focus());
  }

  async function enviar(ev) {
    ev.preventDefault();
    if (enviando) return;
    setErroGeral(null);
    const locais = validar();
    setErros(locais);
    if (Object.keys(locais).length) return focarPrimeiroErro();

    setEnviando(true);
    try {
      const { token } = await api('/auth/cadastro', {
        metodo: 'POST',
        autenticar: false,
        corpo: {
          empresa: dados.empresa.trim(),
          nome: dados.nome.trim(),
          email: dados.email.trim(),
          senha: dados.senha,
          plano: dados.plano,
        },
      });
      entrar(token);
      // Direto para Contatos: o estado vazio guia o primeiro cadastro (meta: 1º contato em < 5 min).
      navegar('/contatos', { replace: true });
    } catch (falha) {
      setEnviando(false);
      if (falha.codigo === 'EMAIL_JA_CADASTRADO') {
        setErros({ email: 'ja-cadastrado' });
        return focarPrimeiroErro();
      }
      if (falha.codigo === 'VALIDACAO' && falha.campos.length) {
        setErros(Object.fromEntries(falha.campos.map((c) => [c.campo, c.erro])));
        return focarPrimeiroErro();
      }
      setErroGeral({ texto: mensagemDeErro(falha, 'cadastro'), codigo: ehInesperado(falha) ? falha.requestId : null });
    }
  }

  const erroEmail =
    erros.email === 'ja-cadastrado' ? (
      <>
        Esse e-mail já tem conta.{' '}
        <Link to="/entrar" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
          Quer entrar?
        </Link>
      </>
    ) : (
      erros.email
    );

  return (
    <LayoutPublico
      titulo="Criar conta"
      subtitulo="Em 2 minutos você cadastra o primeiro contato."
      largura="max-w-xl"
    >
      {erroGeral && (
        <div role="alert" className="flex items-start gap-2 rounded-campo border border-erro p-3 text-sm">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-erro" />
          <div>
            <p>{erroGeral.texto}</p>
            {erroGeral.codigo && <p className="mt-1 font-mono text-texto-mudo">código: {erroGeral.codigo}</p>}
          </div>
        </div>
      )}
      <form ref={refForm} onSubmit={enviar} className="flex flex-col gap-5" noValidate>
        <Campo
          rotulo="Empresa"
          autoComplete="organization"
          value={dados.empresa}
          onChange={mudar('empresa')}
          erro={erros.empresa}
          maxLength={120}
          obrigatorio
        />
        <Campo
          rotulo="Seu nome"
          autoComplete="name"
          value={dados.nome}
          onChange={mudar('nome')}
          erro={erros.nome}
          maxLength={120}
          obrigatorio
        />
        <Campo
          rotulo="E-mail"
          tipo="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={dados.email}
          onChange={mudar('email')}
          erro={erroEmail}
          maxLength={254}
          obrigatorio
        />
        <Campo
          rotulo="Senha"
          tipo="password"
          autoComplete="new-password"
          value={dados.senha}
          onChange={mudar('senha')}
          erro={erros.senha}
          ajuda={`Pelo menos ${SENHA_MIN} caracteres.`}
          maxLength={SENHA_MAX}
          obrigatorio
        />
        <CartoesPlano
          valor={dados.plano}
          aoMudar={(plano) => setDados((d) => ({ ...d, plano }))}
          erro={erros.plano}
        />
        <Botao type="submit" icone={Rocket} carregando={enviando} textoCarregando="Criando sua conta…" className="w-full">
          Criar conta
        </Botao>
      </form>
      <p className="text-center text-texto-secundario">
        Já tem conta?{' '}
        <Link to="/entrar" className="inline-flex min-h-11 items-center font-semibold text-primario underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </LayoutPublico>
  );
}

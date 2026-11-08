import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, Clock, LogIn } from 'lucide-react';
import { api } from '../../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../../api/mensagens.js';
import { voltarSeguro } from '../../api/sessao.js';
import { useSessao } from '../../sessao/ProvedorSessao.jsx';
import Campo from '../../componentes/ui/Campo.jsx';
import Botao from '../../componentes/ui/Botao.jsx';
import LayoutPublico from './LayoutPublico.jsx';

export default function Entrar() {
  const [params] = useSearchParams();
  const { sessao, entrar } = useSessao();
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const refErro = useRef(null);

  const destino = voltarSeguro(params.get('voltar'));
  const expirou = params.get('sessao') === 'expirada';

  if (sessao) return <Navigate to={destino} replace />;

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const { token } = await api('/auth/login', {
        metodo: 'POST',
        corpo: { email: email.trim(), senha },
        autenticar: false,
      });
      entrar(token);
      navegar(destino, { replace: true });
    } catch (falha) {
      // Um só erro, sem dizer qual campo errou (a API também não diz).
      setErro({ texto: mensagemDeErro(falha, 'login'), codigo: ehInesperado(falha) ? falha.requestId : null });
      setEnviando(false);
      requestAnimationFrame(() => refErro.current?.focus());
    }
  }

  return (
    <LayoutPublico titulo="Entrar" subtitulo="Seus contatos em órbita, sem planilha perdida.">
      {expirou && !erro && (
        <p role="status" className="flex items-start gap-2 rounded-campo border border-borda-sutil p-3 text-sm">
          <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-aviso" />
          Sua sessão expirou. Entre de novo.
        </p>
      )}
      {erro && (
        <div
          ref={refErro}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-campo border border-erro p-3 text-sm outline-none"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-erro" />
          <div>
            <p>{erro.texto}</p>
            {erro.codigo && <p className="mt-1 font-mono text-texto-mudo">código: {erro.codigo}</p>}
          </div>
        </div>
      )}
      <form onSubmit={enviar} className="flex flex-col gap-5" noValidate>
        <Campo
          rotulo="E-mail"
          tipo="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          obrigatorio
        />
        <Campo
          rotulo="Senha"
          tipo="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          obrigatorio
        />
        <Botao type="submit" icone={LogIn} carregando={enviando} textoCarregando="Entrando…" className="w-full">
          Entrar
        </Botao>
      </form>
      <p className="text-center text-texto-secundario">
        Ainda não tem conta?{' '}
        <Link to="/cadastro" className="inline-flex min-h-11 items-center font-semibold text-primario underline-offset-4 hover:underline">
          Criar conta
        </Link>
      </p>
    </LayoutPublico>
  );
}

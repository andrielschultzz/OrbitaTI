import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api } from '../../api/cliente.js';
import { MENSAGEM_SERVIDOR } from '../../api/mensagens.js';
import { useSessao } from '../../sessao/ProvedorSessao.jsx';
import LayoutPublico from './LayoutPublico.jsx';

// Destino do link do e-mail de confirmação (bloco 10): ${PORTAL_URL}/confirmar-email?token=...
export default function ConfirmarEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { sessao } = useSessao();
  const [estado, setEstado] = useState(token ? 'carregando' : 'invalido');

  useEffect(() => {
    if (!token) return undefined;
    const controle = new AbortController();
    api('/auth/confirmar', { consulta: { token }, autenticar: false, sinal: controle.signal })
      .then(() => setEstado('ok'))
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setEstado(e.codigo === 'LINK_INVALIDO' || e.codigo === 'VALIDACAO' ? 'invalido' : 'falha');
      });
    return () => controle.abort();
  }, [token]);

  const destino = sessao ? '/contatos' : '/entrar';

  return (
    <LayoutPublico titulo="Confirmar e-mail">
      <div role="status" aria-live="polite" className="flex items-start gap-3">
        {estado === 'carregando' && (
          <>
            <Loader2 aria-hidden="true" className="size-6 shrink-0 animate-spin text-primario" />
            <p>Confirmando seu e-mail…</p>
          </>
        )}
        {estado === 'ok' && (
          <>
            <CheckCircle2 aria-hidden="true" className="size-6 shrink-0 text-sucesso" />
            <p>E-mail confirmado.</p>
          </>
        )}
        {estado === 'invalido' && (
          <>
            <XCircle aria-hidden="true" className="size-6 shrink-0 text-erro" />
            <p>Este link é inválido ou venceu.</p>
          </>
        )}
        {estado === 'falha' && (
          <>
            <XCircle aria-hidden="true" className="size-6 shrink-0 text-erro" />
            <p>{MENSAGEM_SERVIDOR}</p>
          </>
        )}
      </div>
      {estado !== 'carregando' && (
        <Link to={destino} className="botao botao-primario w-full">
          {sessao ? 'Ir para Contatos' : 'Entrar'}
        </Link>
      )}
    </LayoutPublico>
  );
}

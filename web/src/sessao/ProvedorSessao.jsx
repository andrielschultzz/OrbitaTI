import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { definirAoSessaoExpirar } from '../api/cliente.js';
import { limparSessao, salvarToken, sessaoAtual, tokenGuardado } from '../api/sessao.js';
import { useToast } from '../componentes/Toasts.jsx';

// Sessão: token de 15 min, sem refresh (decisão registrada). Quando vence, o usuário entra de novo
// e volta para onde estava (?voltar=, só caminho interno).
const ContextoSessao = createContext(null);
const AVISO_ANTES_MS = 60 * 1000;

export function ProvedorSessao({ children }) {
  // Lido uma vez, ao abrir: se havia token na aba e ele não vale mais (venceu com a aba fechada ou
  // está ilegível), a sessão EXPIROU; não é alguém que nunca entrou. Sem isso, reabrir a aba depois de
  // 15 min levava ao login sem o aviso (achado pelo E2E de sessão).
  const [inicio] = useState(() => {
    const havia = tokenGuardado() !== null;
    const atual = sessaoAtual(); // apaga o token vencido
    return { sessao: atual, motivo: havia && !atual ? 'expirada' : null };
  });
  const [sessao, setSessao] = useState(inicio.sessao);
  // Por que a sessão acabou: 'expirada' (token venceu ou API respondeu 401) ou null (saiu/nunca entrou).
  // Quem redireciona é SÓ a RotaProtegida, lendo este motivo. Antes havia dois redirecionamentos
  // (aqui e lá) e o segundo apagava o "?sessao=expirada" da URL, sumindo com o aviso.
  const [motivo, setMotivo] = useState(inicio.motivo);
  const navegar = useNavigate();
  const { mostrar } = useToast();

  const expirar = useCallback(() => {
    limparSessao();
    setMotivo('expirada');
    setSessao(null);
  }, []);

  useEffect(() => definirAoSessaoExpirar(expirar), [expirar]);

  // Aviso 1 min antes e saída no instante em que o token vence (sem esperar um 401).
  useEffect(() => {
    if (!sessao) return undefined;
    const restante = sessao.exp * 1000 - Date.now();
    const aviso = setTimeout(
      () => mostrar({ tipo: 'info', texto: 'Sua sessão vence em 1 minuto. Salve o que estiver fazendo.' }),
      Math.max(0, restante - AVISO_ANTES_MS),
    );
    const fim = setTimeout(expirar, Math.max(0, restante));
    return () => {
      clearTimeout(aviso);
      clearTimeout(fim);
    };
  }, [sessao, expirar, mostrar]);

  const entrar = useCallback((token) => {
    salvarToken(token);
    setMotivo(null);
    setSessao(sessaoAtual());
  }, []);

  const sair = useCallback(() => {
    limparSessao(); // sair é apagar o token
    setMotivo(null);
    setSessao(null);
    navegar('/entrar', { replace: true });
  }, [navegar]);

  const valor = useMemo(() => ({ sessao, motivo, entrar, sair }), [sessao, motivo, entrar, sair]);
  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>;
}

export function useSessao() {
  const ctx = useContext(ContextoSessao);
  if (!ctx) throw new Error('useSessao precisa estar dentro de <ProvedorSessao>');
  return ctx;
}

/** Só deixa passar com sessão válida; senão vai para o login guardando a rota na URL. */
export function RotaProtegida({ children }) {
  const { sessao, motivo } = useSessao();
  const local = useLocation();
  if (!sessao) {
    const params = new URLSearchParams();
    if (motivo === 'expirada') params.set('sessao', 'expirada');
    params.set('voltar', local.pathname + local.search);
    return <Navigate to={`/entrar?${params}`} replace />;
  }
  return children;
}

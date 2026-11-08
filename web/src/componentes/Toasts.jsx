import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

// Toasts: avisos curtos. Ícone + texto + cor (cor nunca é o único sinal).
// Ficam numa região aria-live que já existe na página desde o início: o leitor de tela só
// anuncia mudanças numa região que ele já conhece.
const ContextoToast = createContext(null);

const ICONES = { sucesso: CheckCircle2, erro: AlertTriangle, info: Info };
const CORES = { sucesso: 'text-sucesso', erro: 'text-erro', info: 'text-primario' };
const DURACAO = { sucesso: 4000, info: 5000, erro: 8000 }; // erro fica mais: pode ter "código"

let proximoId = 1;

export function ProvedorToasts({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const fechar = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((lista) => lista.filter((t) => t.id !== id));
  }, []);

  const mostrar = useCallback(
    ({ tipo = 'info', texto, codigo = null }) => {
      const id = proximoId++;
      setToasts((lista) => [...lista.slice(-2), { id, tipo, texto, codigo }]); // no máximo 3 na tela
      timers.current.set(
        id,
        setTimeout(() => fechar(id), DURACAO[tipo]),
      );
      return id;
    },
    [fechar],
  );

  const valor = useMemo(() => ({ mostrar, fechar }), [mostrar, fechar]);

  return (
    <ContextoToast.Provider value={valor}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6"
      >
        {toasts.map((t) => {
          const Icone = ICONES[t.tipo];
          return (
            <div
              key={t.id}
              role={t.tipo === 'erro' ? 'alert' : 'status'}
              className="cartao pointer-events-auto flex w-full max-w-md items-start gap-3 bg-superficie-elevada py-3 pr-2 pl-4 shadow-elevada"
            >
              <Icone aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${CORES[t.tipo]}`} />
              <div className="min-w-0 flex-1 py-0.5">
                <p>{t.texto}</p>
                {t.codigo && <p className="mt-1 font-mono text-sm break-all text-texto-mudo">código: {t.codigo}</p>}
              </div>
              <button
                type="button"
                onClick={() => fechar(t.id)}
                className="grid size-11 shrink-0 place-items-center rounded-campo text-texto-mudo hover:text-texto"
                aria-label="Fechar aviso"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
          );
        })}
      </div>
    </ContextoToast.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ContextoToast);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ProvedorToasts>');
  return ctx;
}

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Diálogo modal com o <dialog> nativo: o navegador já prende o foco dentro, fecha com Esc,
 * deixa o resto da página inerte e devolve o foco a quem abriu. Nada de biblioteca.
 *
 * Foco inicial: marque o campo com data-foco-inicial (não use autoFocus dentro do diálogo).
 * `folha`: no celular vira folha presa embaixo (ao alcance do polegar); no desktop, modal central.
 */
export default function Dialogo({ aberto, aoFechar, titulo, descricao, folha = false, children }) {
  const ref = useRef(null);
  const idTitulo = useId();
  const idDescricao = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) {
      d.showModal();
      // O autoFocus do React roda antes de o <dialog> abrir (campo ainda invisível) e se perde;
      // o showModal() então focaria o primeiro botão (o "Fechar"). Por isso o foco inicial é
      // escolhido aqui, depois de abrir: o elemento marcado com data-foco-inicial.
      d.querySelector('[data-foco-inicial]')?.focus();
    }
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      aria-describedby={descricao ? idDescricao : undefined}
      onClose={() => aberto && aoFechar()}
      onCancel={(e) => {
        e.preventDefault(); // Esc: quem decide fechar é o estado do React
        aoFechar();
      }}
      onClick={(e) => e.target === ref.current && aoFechar()} // clique no véu fecha
      className={`m-auto w-[calc(100%-2rem)] max-w-lg border border-borda-sutil bg-superficie-elevada p-0 text-texto shadow-elevada backdrop:bg-[var(--veu)] ${
        folha
          ? 'max-lg:mb-0 max-lg:w-full max-lg:max-w-full max-lg:rounded-t-folha max-lg:rounded-b-none max-lg:border-b-0 lg:rounded-cartao'
          : 'rounded-cartao'
      }`}
    >
      {aberto && (
        <div className="flex max-h-[85dvh] flex-col gap-5 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id={idTitulo} className="text-xl">
                {titulo}
              </h2>
              {descricao && (
                <p id={idDescricao} className="text-texto-secundario">
                  {descricao}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={aoFechar}
              className="-mt-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-campo text-texto-mudo hover:text-texto"
              aria-label="Fechar"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

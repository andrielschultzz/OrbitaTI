import { Construction } from 'lucide-react';

/** Esqueleto das telas que a Fase 3 constrói. Some quando todas existirem. */
export default function EmConstrucao({ titulo, children }) {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl md:text-3xl">{titulo}</h1>
      <div className="cartao flex items-start gap-3 p-5 text-texto-secundario">
        <Construction aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-aviso" />
        <p>Tela em construção (bloco 13, Fase 3).</p>
      </div>
      {children}
    </section>
  );
}

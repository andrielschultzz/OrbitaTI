import { BadgeCheck, CircleDot, CircleSlash, FileText } from 'lucide-react';

// Estágio do contato: cor + ícone + texto (cor nunca é o único sinal).
export const ESTAGIOS = [
  { valor: 'lead', rotulo: 'Lead', Icone: CircleDot, cor: 'text-primario' },
  { valor: 'proposta', rotulo: 'Proposta', Icone: FileText, cor: 'text-aviso' },
  { valor: 'cliente', rotulo: 'Cliente', Icone: BadgeCheck, cor: 'text-sucesso' },
  { valor: 'perdido', rotulo: 'Perdido', Icone: CircleSlash, cor: 'text-texto-mudo' },
];

export const estagioDe = (valor) => ESTAGIOS.find((e) => e.valor === valor) ?? ESTAGIOS[0];

export function SeloEstagio({ valor, className = '' }) {
  const { rotulo, Icone, cor } = estagioDe(valor);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-borda-sutil px-2.5 py-0.5 text-xs font-semibold ${cor} ${className}`}
    >
      <Icone aria-hidden="true" className="size-3.5" />
      {rotulo}
    </span>
  );
}

/** Seletor segmentado acessível: um grupo de rádios estilizado (setas do teclado funcionam). */
// Colunas por quantidade de opções. Com 5 (tipos de interação), no celular quebra em 3 + 2:
// em 375 px cada coluna teria ~57 px e "WhatsApp" não cabe sem cortar.
const COLUNAS = { 4: 'grid-cols-4', 5: 'grid-cols-3 md:grid-cols-5' };

/** `empilhado`: ícone sempre em cima do texto (para muitas opções ou coluna estreita). */
export function SeletorSegmentado({ legenda, nome, opcoes, valor, aoMudar, desabilitado = false, empilhado = false }) {
  return (
    // min-w-0: por padrão um <fieldset> não encolhe abaixo do conteúdo e causava rolagem horizontal em 375 px.
    <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={desabilitado}>
      <legend className="mb-1.5 text-sm font-medium text-texto-secundario">{legenda}</legend>
      <div className={`grid gap-1 rounded-campo border border-borda-campo p-1 ${COLUNAS[opcoes.length] ?? 'grid-cols-4'}`}>
        {opcoes.map(({ valor: v, rotulo, Icone }) => {
          const ativo = valor === v;
          return (
            <label
              key={v}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[calc(var(--raio-campo)-4px)] px-1 text-center text-xs font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-foco ${empilhado ? '' : 'md:flex-row md:gap-1.5 md:text-sm'} ${
                ativo ? 'botao-primario' : 'text-texto-secundario hover:bg-superficie-ativa hover:text-texto'
              }`}
            >
              <input
                type="radio"
                name={nome}
                value={v}
                checked={ativo}
                onChange={() => aoMudar(v)}
                className="sr-only"
              />
              {Icone && <Icone aria-hidden="true" className="size-4 shrink-0" />}
              <span className="leading-tight">{rotulo}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

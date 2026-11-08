import simbolo from '../../assets/marca/simbolo.svg';

const TAMANHOS = {
  sm: { simbolo: 'size-8', texto: 'text-lg' },
  md: { simbolo: 'size-11', texto: 'text-2xl' },
  lg: { simbolo: 'size-16', texto: 'text-4xl' },
};

/** Logotipo como TEXTO HTML (não texto dentro de SVG): nítido em qualquer tela e lido por leitor de tela. */
export function Logotipo({ tamanho = 'md', className = '' }) {
  return (
    <span className={`font-titulo font-extrabold tracking-tight ${TAMANHOS[tamanho].texto} ${className}`}>
      <span className="text-texto">Orbita</span>
      <span className="texto-gradiente">TI</span>
    </span>
  );
}

/** Só o símbolo. Decorativo por padrão (quem usa ao lado do logotipo não precisa repetir o nome). */
export function Simbolo({ tamanho = 'md', rotulo, className = '' }) {
  return (
    <img
      src={simbolo}
      alt={rotulo ?? ''}
      aria-hidden={rotulo ? undefined : true}
      className={`${TAMANHOS[tamanho].simbolo} shrink-0 ${className}`}
      width="64"
      height="64"
    />
  );
}

/** Símbolo + logotipo, lado a lado. */
export function MarcaHorizontal({ tamanho = 'md', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Simbolo tamanho={tamanho} />
      <Logotipo tamanho={tamanho} />
    </span>
  );
}

/** Ícone de app: símbolo sobre fundo escuro arredondado (igual à variação da logo de referência). */
export function IconeApp({ className = '' }) {
  return (
    <span
      className={`inline-grid size-20 place-items-center rounded-[22%] ${className}`}
      style={{ background: 'linear-gradient(180deg,#0B1B30,#020A1F)', boxShadow: 'var(--brilho-ativo)' }}
    >
      <img src={simbolo} alt="" aria-hidden="true" className="size-16" width="64" height="64" />
    </span>
  );
}

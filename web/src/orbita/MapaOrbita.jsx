import { posicaoNoMapa, DIAS_ANEL_INTERNO, DIAS_ANEL_EXTERNO } from './orbita.js';
import simbolo from '../assets/marca/simbolo.svg';

const LADO = 320;
const GEO = { centro: LADO / 2, raioInterno: 72, raioExterno: 140 };
const ANEIS = [
  { dias: DIAS_ANEL_INTERNO, rotulo: '90 dias' },
  { dias: 180, rotulo: '6 meses' },
  { dias: DIAS_ANEL_EXTERNO, rotulo: '1 ano' },
];

function primeiroNome(nome) {
  const p = nome.trim().split(/\s+/)[0] ?? '';
  return p.length > 10 ? `${p.slice(0, 9)}…` : p;
}

/**
 * Mapa de órbita: você no centro, contatos frios afastando-se com o tempo.
 * É COMPLEMENTO visual. O conteúdo acessível é a lista ao lado (role="img" + descrição aqui).
 * Tocar num ponto chama aoAbrir(id). Os pontos não entram no Tab: a lista já é navegável.
 */
export default function MapaOrbita({ itens, aoAbrir, className = '' }) {
  const descricao =
    itens.length === 0
      ? 'Mapa de órbita vazio: nenhum contato esfriando.'
      : `Mapa de órbita com ${itens.length} contatos esfriando. ` +
        itens.map((c) => `${c.nome}, ${c.dias_sem_interacao} dias`).join('; ') + '.';

  return (
    <svg
      viewBox={`0 0 ${LADO} ${LADO}`}
      role="img"
      aria-label={descricao}
      className={`mapa-orbita block h-auto w-full max-w-[320px] ${className}`}
    >
      <defs>
        <radialGradient id="mapa-halo">
          <stop offset="0.5" stopColor="var(--ciano)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--ciano)" stopOpacity="0" />
        </radialGradient>
        <filter id="mapa-brilho" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Anéis de referência (decorativos) */}
      {ANEIS.map(({ dias, rotulo }) => {
        const r = posicaoNoMapa(dias, 0, GEO).raio;
        return (
          <g key={dias}>
            <circle cx={GEO.centro} cy={GEO.centro} r={r} fill="none" stroke="var(--borda-sutil)" strokeWidth="1.5" />
            <text
              className="mapa-orbita-rotulo"
              x={GEO.centro}
              y={GEO.centro - r - 5}
              textAnchor="middle"
              fontSize="11"
              fill="var(--texto-mudo)"
            >
              {rotulo}
            </text>
          </g>
        );
      })}

      {/* Anel tracejado que gira devagar (só ele se mexe; desliga com reduced-motion) */}
      <circle
        className="mapa-orbita-giro"
        cx={GEO.centro}
        cy={GEO.centro}
        r={GEO.raioExterno + 8}
        fill="none"
        stroke="var(--ciano)"
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeDasharray="2 10"
      />

      {/* Você no centro */}
      <circle cx={GEO.centro} cy={GEO.centro} r="58" fill="url(#mapa-halo)" />
      <image href={simbolo} x={GEO.centro - 42} y={GEO.centro - 42} width="84" height="84" />

      {/* Contatos frios */}
      {itens.map((c, i) => {
        const { x, y, fracao } = posicaoNoMapa(c.dias_sem_interacao, i, GEO);
        const cor = fracao > 0.66 ? 'var(--indigo)' : fracao > 0.33 ? 'var(--azul)' : 'var(--ciano)';
        const rotuloEmBaixo = y < GEO.centro;
        return (
          <g
            key={c.id}
            className="cursor-pointer"
            onClick={() => aoAbrir?.(c.id)}
            data-contato={c.id}
          >
            {/* área de toque de ~44 px no tamanho em que o mapa aparece no celular */}
            <circle cx={x} cy={y} r="24" fill="transparent" />
            <circle cx={x} cy={y} r="7" fill={cor} filter="url(#mapa-brilho)" />
            <circle cx={x} cy={y} r="3" fill="var(--texto)" />
            <text
              className="mapa-orbita-rotulo"
              x={x}
              y={rotuloEmBaixo ? y + 22 : y - 14}
              textAnchor="middle"
              fontSize="12"
              fontWeight="600"
              fill="var(--texto-secundario)"
            >
              {primeiroNome(c.nome)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

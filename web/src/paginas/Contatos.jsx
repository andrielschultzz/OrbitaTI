import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, Plus, RotateCcw, Search, SearchX, Upload, UserRoundPlus } from 'lucide-react';
import { api, criarCanceladora } from '../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../api/mensagens.js';
import { useToast } from '../componentes/Toasts.jsx';
import { SeloEstagio } from '../contatos/estagios.jsx';
import SaindoDeOrbita from '../contatos/SaindoDeOrbita.jsx';
import FolhaNovoContato from '../contatos/FolhaNovoContato.jsx';
import { textoUltimaInteracao } from '../util/formatos.js';

const DEBOUNCE_MS = 300; // protege o rate limit e o banco: é a busca que o CQ-01 mede

const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');

export default function Contatos() {
  const [params, setParams] = useSearchParams();
  const novoAberto = params.get('novo') === '1';
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState(''); // busca depois do debounce
  const [estado, setEstado] = useState({ carregando: true, itens: [], limite: null, erro: null });
  const proximoSinal = useMemo(() => criarCanceladora(), []);
  const { mostrar } = useToast();
  const refBusca = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(
    async (texto) => {
      setEstado((e) => ({ ...e, carregando: true, erro: null }));
      try {
        // Uma busca nova cancela a anterior: a resposta velha nunca sobrescreve a nova.
        const { itens, limite } = await api('/contatos', { consulta: { busca: texto }, sinal: proximoSinal() });
        setEstado({ carregando: false, itens, limite, erro: null });
      } catch (e) {
        if (e.name === 'AbortError' || e.codigo === 'NAO_AUTENTICADO') return;
        setEstado((s) => ({ ...s, carregando: false, erro: e }));
        if (ehInesperado(e)) mostrar({ tipo: 'erro', texto: mensagemDeErro(e), codigo: e.requestId });
      }
    },
    [proximoSinal, mostrar],
  );

  useEffect(() => {
    carregar(termo);
  }, [termo, carregar]);

  const abrirNovo = () => setParams({ novo: '1' });
  const fecharNovo = () => {
    setParams({}, { replace: true });
  };

  function aoCriar(contato) {
    // Aparece na lista sem recarregar a página.
    setEstado((e) => ({ ...e, itens: [...e.itens.filter((c) => c.id !== contato.id), contato].sort(porNome) }));
  }

  const { carregando, itens, limite, erro } = estado;
  const buscando = busca.trim() !== ''; // texto digitado (antes do debounce: o bloco some na hora)
  const primeiroUso = !carregando && !erro && !termo && itens.length === 0;
  const semResultado = !carregando && !erro && termo && itens.length === 0;
  const listaCheia = limite !== null && itens.length >= limite;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl md:text-3xl">Contatos</h1>
      </div>

      {primeiroUso ? (
        <section className="cartao flex flex-col items-center gap-4 px-5 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-superficie-ativa text-primario">
            <UserRoundPlus aria-hidden="true" className="size-7" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-xl">Cadastre seu primeiro contato</h2>
            <p className="text-texto-secundario">Só o nome já basta. O resto você completa depois.</p>
          </div>
          <button type="button" className="botao botao-primario" onClick={abrirNovo}>
            <Plus aria-hidden="true" className="size-5" /> Novo contato
          </button>
          <Link to="/importar" className="inline-flex min-h-11 items-center gap-2 font-semibold text-primario">
            <Upload aria-hidden="true" className="size-4" /> ou importe sua planilha
          </Link>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="busca-contatos" className="text-sm font-medium text-texto-secundario">
              Buscar por nome, e-mail ou empresa
            </label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-texto-mudo" />
              <input
                ref={refBusca}
                id="busca-contatos"
                type="search"
                className="campo pl-11"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                maxLength={100}
                autoComplete="off"
                enterKeyHint="search"
              />
            </div>
          </div>

          {/* Com texto na busca, só os resultados. O "Saindo de órbita" volta quando a busca esvazia. */}
          {!buscando && <SaindoDeOrbita />}

          <section aria-labelledby="titulo-lista" className="flex flex-col gap-3">
          <h2 id="titulo-lista" className="sr-only">
            {buscando ? 'Resultados da busca' : 'Todos os contatos'}
          </h2>

          <p aria-live="polite" className="min-h-5 text-sm text-texto-mudo">
            {!carregando && !erro && itens.length > 0 &&
              (listaCheia
                ? `Mostrando os primeiros ${limite}. Refine a busca para achar quem você procura.`
                : `${itens.length} ${itens.length === 1 ? 'contato' : 'contatos'}`)}
          </p>

          {erro && !carregando && (
            <div className="cartao flex flex-col items-start gap-3 p-5">
              <p>{mensagemDeErro(erro)}</p>
              <button type="button" className="botao botao-secundario" onClick={() => carregar(termo)}>
                <RotateCcw aria-hidden="true" className="size-5" /> Tentar de novo
              </button>
            </div>
          )}

          {semResultado && (
            <div className="cartao flex flex-col items-center gap-2 px-5 py-8 text-center">
              <SearchX aria-hidden="true" className="size-7 text-texto-mudo" />
              <p>Nenhum contato encontrado para “{termo}”.</p>
              <button
                type="button"
                className="botao botao-fantasma"
                onClick={() => {
                  setBusca('');
                  refBusca.current?.focus();
                }}
              >
                Limpar busca
              </button>
            </div>
          )}

          {carregando && itens.length === 0 && (
            <ul className="cartao flex flex-col divide-y divide-borda-sutil" aria-busy="true" aria-label="Carregando contatos">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <li key={i} className="flex flex-col gap-2 px-4 py-3.5">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-superficie-ativa" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-superficie-ativa" />
                </li>
              ))}
            </ul>
          )}

          {itens.length > 0 && (
            <ul
              className={`cartao flex flex-col divide-y divide-borda-sutil transition-opacity ${carregando ? 'opacity-60' : ''}`}
              aria-busy={carregando}
            >
              {itens.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/contatos/${c.id}`}
                    className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-superficie-ativa"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold">{c.nome}</span>
                        <SeloEstagio valor={c.estagio} />
                      </span>
                      <span className="line-clamp-2 text-sm text-texto-mudo">
                        {c.empresa ? `${c.empresa} · ` : ''}
                        {textoUltimaInteracao(c)}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-texto-mudo" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          </section>
        </>
      )}

      <FolhaNovoContato aberto={novoAberto} aoFechar={fecharNovo} aoCriar={aoCriar} />
    </div>
  );
}

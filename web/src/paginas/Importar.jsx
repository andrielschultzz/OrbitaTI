import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { api } from '../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../api/mensagens.js';
import { usePlanoAtual } from '../api/usePlanos.js';
import { useSessao } from '../sessao/ProvedorSessao.jsx';
import { formatarBytes } from '../util/formatos.js';
import Botao from '../componentes/ui/Botao.jsx';

function Limites({ plano }) {
  if (!plano) return <div className="h-5 w-3/4 animate-pulse rounded bg-superficie-ativa" aria-hidden="true" />;
  const l = plano.limites;
  // Todos os números vêm de GET /planos (plano atual pelo claim do token). Nenhum fixo aqui.
  return (
    <p className="text-sm text-texto-secundario">
      Plano {plano.nome}: até {l.linhas_por_importacao.toLocaleString('pt-BR')} linhas por arquivo,{' '}
      {l.importacoes_simultaneas} importações ao mesmo tempo, arquivo de até {formatarBytes(l.tamanho_maximo_csv_bytes)}.
    </p>
  );
}

export default function Importar() {
  const { sessao } = useSessao();
  const { plano } = usePlanoAtual(sessao.plano);
  const navegar = useNavigate();
  const [arquivo, setArquivo] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const refInput = useRef(null);
  const refErro = useRef(null);

  const mostrarErro = (e) => {
    setErro(e);
    requestAnimationFrame(() => refErro.current?.focus());
  };

  function escolher(lista) {
    const f = lista?.[0];
    if (!f) return;
    setErro(null);
    const max = plano?.limites.tamanho_maximo_csv_bytes;
    // Confere antes de enviar (poupa o upload); a API confere de novo (413) de qualquer jeito.
    if (max && f.size > max) {
      setArquivo(null);
      return mostrarErro({ texto: mensagemDeErro({ codigo: 'ARQUIVO_GRANDE' }, 'importar') });
    }
    setArquivo(f);
  }

  async function enviar() {
    if (!arquivo || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const { importacao_id } = await api('/importacoes', { metodo: 'POST', csv: arquivo });
      navegar(`/importar/${importacao_id}`);
    } catch (falha) {
      setEnviando(false);
      if (falha.codigo === 'NAO_AUTENTICADO') return;
      mostrarErro({
        texto: mensagemDeErro(falha, 'importar'),
        modelo: falha.codigo === 'CSV_SEM_COLUNAS' || falha.codigo === 'CSV_VAZIO',
        codigo: ehInesperado(falha) ? falha.requestId : null,
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl md:text-3xl">Importar contatos</h1>
        <p className="text-texto-secundario">
          Envie uma planilha CSV com as colunas <strong className="text-texto">nome</strong> e{' '}
          <strong className="text-texto">email</strong>. Telefone, empresa e observação são opcionais. Contato com o
          mesmo e-mail é atualizado, não duplicado.
        </p>
        <Limites plano={plano} />
      </div>

      <a href="/modelo-contatos.csv" download className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primario">
        <Download aria-hidden="true" className="size-5" /> Baixar modelo de planilha
      </a>

      {erro && (
        <div ref={refErro} tabIndex={-1} role="alert" className="flex items-start gap-3 rounded-campo border border-erro p-4 outline-none">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-erro" />
          <div className="flex flex-col gap-1">
            <p>{erro.texto}</p>
            {erro.modelo && (
              <a href="/modelo-contatos.csv" download className="font-semibold text-primario underline underline-offset-2">
                Baixar o modelo
              </a>
            )}
            {erro.codigo && <p className="font-mono text-sm text-texto-mudo">código: {erro.codigo}</p>}
          </div>
        </div>
      )}

      {/* Área de soltar + seletor. No celular, tocar abre o seletor de arquivos do sistema. */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          escolher(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-cartao border-2 border-dashed px-5 py-10 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foco ${
          arrastando ? 'border-primario bg-superficie-ativa' : 'border-borda-campo hover:border-texto-secundario'
        }`}
      >
        <input
          ref={refInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => escolher(e.target.files)}
        />
        <span className="grid size-12 place-items-center rounded-full bg-superficie-ativa text-primario">
          <Upload aria-hidden="true" className="size-6" />
        </span>
        <span className="font-semibold">Escolher arquivo CSV</span>
        <span className="text-sm text-texto-mudo">ou arraste e solte aqui</span>
      </label>

      {arquivo && (
        <div className="cartao flex flex-col gap-4 p-4 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <FileSpreadsheet aria-hidden="true" className="size-6 shrink-0 text-sucesso" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{arquivo.name}</p>
              <p className="text-sm text-texto-mudo">{formatarBytes(arquivo.size)}</p>
            </div>
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-campo text-texto-mudo hover:text-texto"
              aria-label={`Remover ${arquivo.name}`}
              onClick={() => {
                setArquivo(null);
                if (refInput.current) refInput.current.value = '';
              }}
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <Botao icone={Upload} carregando={enviando} textoCarregando="Enviando…" onClick={enviar}>
            Importar
          </Botao>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { AlertTriangle, Download, LogOut, UserRoundX } from 'lucide-react';
import { api } from '../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../api/mensagens.js';
import { usePlanoAtual } from '../api/usePlanos.js';
import { useSessao } from '../sessao/ProvedorSessao.jsx';
import { useToast } from '../componentes/Toasts.jsx';
import { formatarBytes, formatarPreco } from '../util/formatos.js';
import AlternadorTema from '../componentes/AlternadorTema.jsx';
import Botao from '../componentes/ui/Botao.jsx';
import Campo from '../componentes/ui/Campo.jsx';
import Dialogo from '../componentes/ui/Dialogo.jsx';

// Confirmação do cancelamento: digitar CANCELAR (decisão registrada no bloco 13). O nome da empresa
// não serve porque o Portal não o conhece: não está no token e nenhuma rota do contrato o devolve.
const PALAVRA_CONFIRMACAO = 'CANCELAR';

function Plano({ plano }) {
  if (!plano) return <div className="h-40 animate-pulse rounded-cartao bg-superficie-ativa" aria-hidden="true" />;
  const l = plano.limites;
  const linhas = [
    ['Usuários', l.usuarios === 1 ? '1' : `até ${l.usuarios}`],
    ['Linhas por importação', l.linhas_por_importacao.toLocaleString('pt-BR')],
    ['Importações ao mesmo tempo', l.importacoes_simultaneas],
    ['Tamanho máximo do arquivo', formatarBytes(l.tamanho_maximo_csv_bytes)],
  ];
  return (
    <section aria-labelledby="titulo-plano" className="cartao flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-plano" className="text-lg">
          Plano {plano.nome}
        </h2>
        <p>
          <span className="font-titulo text-xl font-extrabold">{formatarPreco(plano.preco_mensal_centavos)}</span>
          <span className="text-texto-secundario">/mês</span>
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex justify-between gap-3 border-b border-borda-sutil py-2">
            <dt className="text-texto-secundario">{rotulo}</dt>
            <dd className="font-semibold">{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AreaAdmin() {
  const { sair } = useSessao();
  const { mostrar } = useToast();
  const [exportando, setExportando] = useState(false);
  const [dialogo, setDialogo] = useState(false);
  const [confirmacao, setConfirmacao] = useState('');
  const [cancelando, setCancelando] = useState(false);

  const avisarFalha = (falha) => {
    if (falha.codigo === 'NAO_AUTENTICADO') return;
    // 404 em /conta/* = o bloco 14 ainda não existe na API ("Essa função ainda não está disponível.")
    mostrar({ tipo: 'erro', texto: mensagemDeErro(falha, 'conta'), codigo: ehInesperado(falha) ? falha.requestId : null });
  };

  async function exportar() {
    setExportando(true);
    try {
      // O token vai no cabeçalho, por isso não dá para ser um <a href> simples: baixa e entrega o arquivo.
      const blob = await api('/conta/exportacao', { resposta: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orbitati-exportacao-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      mostrar({ tipo: 'sucesso', texto: 'Exportação baixada.' });
    } catch (falha) {
      avisarFalha(falha);
    } finally {
      setExportando(false);
    }
  }

  async function cancelar(ev) {
    ev.preventDefault();
    if (confirmacao.trim().toUpperCase() !== PALAVRA_CONFIRMACAO || cancelando) return;
    setCancelando(true);
    try {
      await api('/conta/cancelamento', { metodo: 'POST' });
      // O token já emitido valeria até 15 min (sem denylist): sai na hora.
      sair();
      mostrar({ tipo: 'info', texto: 'Conta cancelada. O link da exportação foi enviado por e-mail e vale 30 dias.' });
    } catch (falha) {
      setCancelando(false);
      setDialogo(false);
      avisarFalha(falha);
    }
  }

  return (
    <section aria-labelledby="titulo-dados-conta" className="cartao flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h2 id="titulo-dados-conta" className="text-lg">
          Seus dados
        </h2>
        <p className="text-sm text-texto-secundario">Só administradores veem esta área.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Botao variante="secundario" icone={Download} carregando={exportando} textoCarregando="Preparando…" onClick={exportar} className="self-start">
          Exportar meus dados
        </Botao>
        <p className="text-sm text-texto-mudo">Arquivo JSON com contatos, interações e importações da conta.</p>
      </div>
      <div className="flex flex-col gap-2 border-t border-borda-sutil pt-5">
        <Botao variante="perigo" icone={UserRoundX} onClick={() => setDialogo(true)} className="self-start">
          Cancelar conta
        </Botao>
        <p className="text-sm text-texto-mudo">Os dados ficam disponíveis para exportação por 30 dias e depois são apagados.</p>
      </div>

      <Dialogo
        aberto={dialogo}
        aoFechar={() => {
          if (cancelando) return;
          setDialogo(false);
          setConfirmacao('');
        }}
        titulo="Cancelar a conta?"
        descricao="Ninguém da sua empresa consegue mais entrar. Você recebe por e-mail um link para baixar os dados, válido por 30 dias. Depois disso, tudo é apagado."
      >
        <form onSubmit={cancelar} className="flex flex-col gap-4" noValidate>
          <p className="flex items-start gap-2 rounded-campo border border-erro p-3 text-sm">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-erro" />
            Isso não pode ser desfeito pelo Portal.
          </p>
          <Campo
            rotulo={`Para confirmar, digite ${PALAVRA_CONFIRMACAO}`}
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
            <Botao variante="secundario" onClick={() => setDialogo(false)} disabled={cancelando}>
              Voltar
            </Botao>
            <Botao
              type="submit"
              variante="perigo"
              icone={UserRoundX}
              carregando={cancelando}
              textoCarregando="Cancelando…"
              disabled={confirmacao.trim().toUpperCase() !== PALAVRA_CONFIRMACAO}
            >
              Cancelar conta
            </Botao>
          </div>
        </form>
      </Dialogo>
    </section>
  );
}

export default function Conta() {
  const { sessao, sair } = useSessao();
  const { plano } = usePlanoAtual(sessao.plano);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl md:text-3xl">Conta</h1>
      <Plano plano={plano} />

      <section aria-labelledby="titulo-preferencias" className="cartao flex flex-col gap-4 p-5">
        <h2 id="titulo-preferencias" className="text-lg">
          Preferências
        </h2>
        <div className="flex flex-wrap gap-3">
          <AlternadorTema />
        </div>
      </section>

      {sessao.papel === 'admin' && <AreaAdmin />}

      <button type="button" className="botao botao-secundario self-start" onClick={sair}>
        <LogOut aria-hidden="true" className="size-5" /> Sair da conta
      </button>
    </div>
  );
}

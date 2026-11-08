import { useState } from 'react';
import { ChevronDown, Save } from 'lucide-react';
import { api } from '../api/cliente.js';
import { ehInesperado, mensagemDeErro } from '../api/mensagens.js';
import { useToast } from '../componentes/Toasts.jsx';
import { vazioParaNull } from '../util/formatos.js';
import Dialogo from '../componentes/ui/Dialogo.jsx';
import Campo from '../componentes/ui/Campo.jsx';
import Botao from '../componentes/ui/Botao.jsx';

const VAZIO = { nome: '', telefone: '', observacao: '', email: '', empresa: '' };

/**
 * "Novo contato" em menos de 30 s: só Nome (obrigatório, com foco), Telefone e Observação.
 * E-mail e empresa ficam em "mais campos", recolhido. Enter salva.
 */
export default function FolhaNovoContato({ aberto, aoFechar, aoCriar }) {
  const [dados, setDados] = useState(VAZIO);
  const [maisCampos, setMaisCampos] = useState(false);
  const [erros, setErros] = useState({});
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();

  function fechar() {
    setDados(VAZIO);
    setErros({});
    setMaisCampos(false);
    aoFechar();
  }

  const mudar = (campo) => (e) => {
    setDados((d) => ({ ...d, [campo]: e.target.value }));
    if (erros[campo]) setErros((x) => ({ ...x, [campo]: undefined }));
  };

  async function salvar(ev) {
    ev.preventDefault();
    if (enviando) return;
    if (!dados.nome.trim()) {
      setErros({ nome: 'Informe o nome.' });
      return;
    }
    setEnviando(true);
    try {
      const contato = await api('/contatos', {
        metodo: 'POST',
        corpo: {
          nome: dados.nome.trim(),
          telefone: vazioParaNull(dados.telefone),
          observacao: vazioParaNull(dados.observacao),
          email: vazioParaNull(dados.email)?.toLowerCase() ?? null,
          empresa: vazioParaNull(dados.empresa),
        },
      });
      mostrar({ tipo: 'sucesso', texto: `${contato.nome} foi cadastrado.` });
      aoCriar(contato);
      fechar();
    } catch (falha) {
      if (falha.codigo === 'EMAIL_DUPLICADO') {
        setMaisCampos(true);
        setErros({ email: mensagemDeErro(falha, 'contato') });
      } else if (falha.codigo === 'VALIDACAO' && falha.campos.length) {
        const porCampo = Object.fromEntries(falha.campos.map((c) => [c.campo, c.erro]));
        if (porCampo.email || porCampo.empresa) setMaisCampos(true);
        setErros(porCampo);
      } else if (falha.codigo !== 'NAO_AUTENTICADO') {
        mostrar({ tipo: 'erro', texto: mensagemDeErro(falha), codigo: ehInesperado(falha) ? falha.requestId : null });
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} aoFechar={fechar} titulo="Novo contato" folha>
      <form onSubmit={salvar} className="flex flex-col gap-4" noValidate>
        <Campo
          rotulo="Nome"
          value={dados.nome}
          onChange={mudar('nome')}
          erro={erros.nome}
          data-foco-inicial
          autoComplete="off"
          maxLength={120}
          enterKeyHint="done"
          obrigatorio
        />
        <Campo
          rotulo="Telefone"
          tipo="tel"
          inputMode="tel"
          value={dados.telefone}
          onChange={mudar('telefone')}
          erro={erros.telefone}
          autoComplete="off"
          maxLength={30}
          enterKeyHint="done"
        />
        <Campo
          rotulo="Observação"
          value={dados.observacao}
          onChange={mudar('observacao')}
          erro={erros.observacao}
          placeholder="Uma linha de contexto"
          autoComplete="off"
          maxLength={500}
          enterKeyHint="done"
        />

        <button
          type="button"
          className="flex min-h-11 items-center gap-2 self-start rounded-campo px-1 text-sm font-semibold text-primario"
          aria-expanded={maisCampos}
          aria-controls="mais-campos-contato"
          onClick={() => setMaisCampos((v) => !v)}
        >
          <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${maisCampos ? 'rotate-180' : ''}`} />
          Mais campos
        </button>
        <div id="mais-campos-contato" hidden={!maisCampos} className="flex flex-col gap-4">
          <Campo
            rotulo="E-mail"
            tipo="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={dados.email}
            onChange={mudar('email')}
            erro={erros.email}
            autoComplete="off"
            maxLength={254}
          />
          <Campo
            rotulo="Empresa"
            value={dados.empresa}
            onChange={mudar('empresa')}
            erro={erros.empresa}
            autoComplete="off"
            maxLength={120}
          />
        </div>

        <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
          <Botao variante="secundario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao type="submit" icone={Save} carregando={enviando} textoCarregando="Salvando…">
            Salvar contato
          </Botao>
        </div>
      </form>
    </Dialogo>
  );
}

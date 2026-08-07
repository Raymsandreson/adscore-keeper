// =============================================================================
// Marcos de um processo ADMINISTRATIVO (INSS), na aba Marcos do processo.
//
// POR QUE existe: a aba Marcos lê process_movements, que é alimentada pelo
// ESCAVADOR — e o Escavador só entende número CNJ. Processo administrativo
// guarda número de requerimento, então nunca teria marco ali. O resultado era
// "Nenhum marco processual detectado ainda. Os marcos são extraídos das
// movimentações do Escavador", que para esses processos é falso: não é que
// ainda não detectou, é que nunca vai detectar por aquela via.
//
// Medido em 06/08/2026: dos 1.776 processos, 236 têm número que não é CNJ.
// Desses, 153 TÊM requerimento capturado do INSS (e passam a mostrar a régua
// aqui) e 83 não têm — para esses o e-mail do INSS nunca foi processado, e a
// tela agora diz isso em vez de culpar o Escavador.
//
// A régua administrativa é ancorada no RESULTADO, não no status: o status do
// INSS vai e volta (Concluída → Pendente 103×). Ver migration 20260806170000.
// =============================================================================
import { useEffect, useState } from 'react';
import {
  fetchRequerimentoPorNumero, classificarNumeroProcesso, MARCO_INSS_LABEL,
  DIAS_EXIGENCIA_CRITICA,
  type RequerimentoInss, type MarcoInss, type FormaNumero,
} from '@/lib/inssRegua';
import { Badge } from '@/components/ui/badge';
import { TriangleAlert, HelpCircle, Landmark, FileQuestion, Mailbox } from 'lucide-react';

const ETAPAS: { chave: MarcoInss | 'desfecho'; rotulo: string }[] = [
  { chave: 'protocolado', rotulo: 'Protocolado' },
  { chave: 'desfecho', rotulo: 'Concessão ou indeferimento' },
];

const CORES: Record<MarcoInss, string> = {
  protocolado: 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-300',
  concedido:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  indeferido:  'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  encerrado:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

function fmt(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

/**
 * Sem requerimento capturado — mas o motivo NÃO é o mesmo para todo mundo, e a
 * ação que cada caso pede é oposta:
 *
 *   nb  → o número é de requerimento e o e-mail não chegou. Acionável: cobrar a
 *         caixa monitorada. 38 processos em 07/08/2026.
 *   nup → protocolo federal (NNNNN.NNNNNN/AAAA-DD). Não é requerimento de
 *         benefício; nenhum e-mail do INSS jamais o cita. Mandar conferir a caixa
 *         aqui é mandar esperar o que não vem. 10 processos, 9 deles em itens
 *         "Relatório de Acidente".
 *   indefinido → o campo não guarda número de processo (CNPJ, CEP, data,
 *         "reprotocolar-cliente nao foi p perícia"). 33 processos. Só o cadastro
 *         conserta.
 */
function SemRequerimento({ numero, forma }: { numero: string; forma: FormaNumero }) {
  const conteudo: Record<FormaNumero, { Icone: typeof Landmark; titulo: string; corpo: string; acao: string }> = {
    nb: {
      Icone: Mailbox,
      titulo: 'Requerimento ainda não capturado',
      corpo: 'O número tem forma de requerimento do INSS, mas nenhum e-mail dele foi processado até agora — por isso a régua está vazia.',
      acao: 'Confira se o e-mail do INSS chegou na caixa monitorada.',
    },
    nup: {
      Icone: Landmark,
      titulo: 'Protocolo administrativo — fora do acompanhamento',
      corpo: 'Este é um protocolo da administração federal, não um requerimento de benefício. Ele não gera e-mail do INSS nem movimentação no Escavador, então nunca terá régua automática.',
      acao: 'O andamento precisa ser consultado no órgão onde foi protocolado.',
    },
    indefinido: {
      Icone: FileQuestion,
      titulo: 'O campo não contém um número de processo',
      corpo: 'O conteúdo cadastrado não tem forma de CNJ, de requerimento do INSS nem de protocolo administrativo — sem um número válido não há o que acompanhar.',
      acao: 'Corrija o número no cadastro do processo.',
    },
    // Não chega aqui: número CNJ é roteado para a régua do Escavador antes.
    cnj: {
      Icone: FileQuestion,
      titulo: 'Sem marcos',
      corpo: 'Número em formato judicial sem movimentação capturada.',
      acao: 'Atualize o processo para buscar no Escavador.',
    },
  };
  const { Icone, titulo, corpo, acao } = conteudo[forma];

  return (
    <div className="border rounded-lg p-4 bg-muted/20 text-center space-y-1.5">
      <Icone className="h-5 w-5 mx-auto text-muted-foreground" />
      <p className="text-sm font-medium">{titulo}</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        <span className="font-mono">{numero}</span> — {corpo}
      </p>
      <p className="text-[11px] text-muted-foreground">{acao}</p>
    </div>
  );
}

export default function InssMarcosProcesso({ processNumber }: { processNumber: string }) {
  const [req, setReq] = useState<RequerimentoInss | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    fetchRequerimentoPorNumero(processNumber)
      .then((r) => { if (vivo) setReq(r); })
      .catch((e) => { if (vivo) setErro(e?.message || 'Falha ao buscar o requerimento'); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [processNumber]);

  if (loading) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Buscando no INSS…</p>;
  }
  if (erro) {
    return <p className="text-xs text-rose-600 py-4 text-center">{erro}</p>;
  }

  // Sem requerimento capturado. O motivo depende da FORMA do número — mandar
  // todo mundo conferir a caixa do INSS acerta em 38 casos e mente em 43.
  if (!req) {
    const forma = classificarNumeroProcesso(processNumber);
    return <SemRequerimento numero={processNumber} forma={forma} />;
  }

  const critico = req.emExigencia && (req.diasEmExigencia ?? 0) > DIAS_EXIGENCIA_CRITICA;
  const idxAtual = req.temDesfecho ? 1 : 0;

  return (
    <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={CORES[req.marcoAtual]}>{MARCO_INSS_LABEL[req.marcoAtual]}</Badge>
        {req.beneficio && <span className="text-xs text-muted-foreground">{req.beneficio}</span>}
        <span className="text-xs text-muted-foreground">Protocolo: {fmt(req.protocolDate)}</span>
      </div>

      {/* Régua administrativa: 2 etapas, não 12. O ciclo é outro. */}
      <div className="space-y-1.5">
        {ETAPAS.map((e, i) => (
          <div key={e.chave} className="flex items-center gap-2.5">
            <span className={`h-3 w-3 rounded-full shrink-0 ${
              i < idxAtual ? 'bg-primary'
              : i === idxAtual ? 'bg-primary ring-4 ring-primary/20'
              : 'border-2 border-dashed border-muted-foreground/40'
            }`} />
            <span className={`text-sm ${i <= idxAtual ? '' : 'text-muted-foreground'}`}>
              {i === 1 && req.temDesfecho ? MARCO_INSS_LABEL[req.marcoAtual] : e.rotulo}
            </span>
          </div>
        ))}
      </div>

      {req.emExigencia && (
        <div className={`flex items-start gap-1.5 text-xs rounded p-2 ${
          critico ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200'
                  : 'bg-muted text-muted-foreground'}`}>
          <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Em exigência
            {req.diasEmExigencia != null ? ` há ${req.diasEmExigencia} dias` : ''}
            {critico ? ' — passou do prazo razoável, precisa de ação.' : '.'}
          </span>
        </div>
      )}

      {req.concluidaSemResultado && (
        <div className="flex items-start gap-1.5 text-xs rounded p-2 bg-sky-50 dark:bg-sky-900/20
                        text-sky-900 dark:text-sky-200">
          <HelpCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>O INSS deu o requerimento por concluído, mas o resultado não foi capturado.</span>
        </div>
      )}

      {req.despacho && (
        <p className="text-xs text-muted-foreground border-l-2 pl-2">{req.despacho}</p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Régua administrativa: o status do INSS vai e volta, então o que vale como marco é o
        resultado. Atualizado pelo e-mail do INSS{req.ultimoEmail ? ` em ${fmt(req.ultimoEmail)}` : ''}.
      </p>
    </div>
  );
}

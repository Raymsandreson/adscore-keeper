// =============================================================================
// Fila: requerimentos do INSS que ainda não são de nenhum processo.
//
// Por que existe (24/08/2026). O e-mail do INSS virou a quinta fonte de marco,
// e ele é a ÚNICA fonte que alcança requerimento administrativo — 548 dos 843
// processos deste POP não têm CNJ nenhum e por isso eram invisíveis para a
// régua, que indexava só por CNJ.
//
// Mas o e-mail do INSS não traz CNJ: traz PROTOCOLO. Enquanto o protocolo não
// estiver anotado num processo, os e-mails dele não viram marco de ninguém —
// é isso que esta fila mostra, e é isso que o botão resolve.
//
// A LIGAÇÃO É ANOTADA, NUNCA ADIVINHADA. As três chaves possíveis foram
// medidas antes de escolher esta: leads.cpf existe em 673 de 21.425 leads;
// leads.lead_name é o título do card do kanban e casou 0 de 1.127 nomes do
// INSS; contacts.full_name cobre 15%. A sugestão por nome que aparece na linha
// serve para adiantar o clique — nunca para vincular sozinha.
//
// Anotado uma vez, o histórico inteiro daquele protocolo entra de uma vez
// (é o que o toast informa) e todo e-mail futuro vira marco sem ninguém mexer.
// =============================================================================
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, Link2, Mailbox, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useFilaRequerimentosInss,
  type ProcessoDoPop,
  type RequerimentoSemDono,
} from '@/hooks/useFilaRequerimentosInss';

interface Props { boardId: string }

const dataCurta = (iso: string | null) => {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
};

/** O status do INSS pinta a linha: exigência e cancelamento pedem ação. */
const corDoStatus = (status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (!status) return 'outline';
  if (status.startsWith('EXIG')) return 'destructive';
  if (status.startsWith('CANCEL')) return 'destructive';
  if (status.startsWith('CONCL')) return 'default';
  return 'secondary';
};

export function PopFilaRequerimentosInss({ boardId }: Props) {
  const { fila, temSinalDeEmail, loading, buscarProcessos, vincular } =
    useFilaRequerimentosInss(boardId);

  const [aberto, setAberto] = useState(false);
  const [ligando, setLigando] = useState<string | null>(null);   // protocolo em edição
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<ProcessoDoPop[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // POP sem sinal de e-mail não tem o que fazer com esta fila.
  if (!temSinalDeEmail && !loading) return null;

  const abrirBusca = async (protocolo: string) => {
    setLigando(protocolo);
    setTermo('');
    setBuscando(true);
    try {
      setAchados(await buscarProcessos(''));
    } finally {
      setBuscando(false);
    }
  };

  const buscar = async (t: string) => {
    setTermo(t);
    setBuscando(true);
    try {
      setAchados(await buscarProcessos(t));
    } finally {
      setBuscando(false);
    }
  };

  const ligar = async (processo: ProcessoDoPop, protocolo: string) => {
    setSalvando(true);
    try {
      const r = await vincular(processo.id, protocolo);
      toast.success(
        r.marcos > 0
          ? `${r.marcos} marco(s) entraram de ${r.eventos_do_protocolo} e-mail(s)` +
            (r.fases_movidas > 0 ? ' — e a fase andou.' : '.')
          : `Protocolo anotado. Os ${r.eventos_do_protocolo} e-mail(s) dele ainda não casam com nenhum sinal deste POP.`,
      );
      setLigando(null);
      setAchados([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao vincular o protocolo');
    } finally {
      setSalvando(false);
    }
  };

  const Linha = ({ r }: { r: RequerimentoSemDono }) => (
    <div className="rounded border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{r.protocolo}</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={r.nome_segurado || ''}>
          {r.nome_segurado || '—'}
        </span>
        {r.status_atual ? (
          <Badge variant={corDoStatus(r.status_atual)} className="shrink-0 text-[10px]">
            {r.status_atual}
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 text-[10px]">só protocolo</Badge>
        )}
        <span className="shrink-0 text-muted-foreground" title="e-mails deste protocolo">
          {r.eventos} e-mail{r.eventos > 1 ? 's' : ''}
        </span>
        <span className="shrink-0 text-muted-foreground" title="protocolado em">
          {dataCurta(r.data_protocolo)}
        </span>
        {ligando === r.protocolo ? (
          <Button
            type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs"
            onClick={() => { setLigando(null); setAchados([]); }}
          >
            <X className="mr-1 h-3 w-3" /> cancelar
          </Button>
        ) : (
          <Button
            type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs"
            onClick={() => void abrirBusca(r.protocolo)}
            title="Escolher de qual processo deste POP é este requerimento"
          >
            <Link2 className="mr-1 h-3 w-3" /> vincular
          </Button>
        )}
      </div>

      {r.lead_sugerido_rotulo && ligando !== r.protocolo ? (
        <p className="mt-1 truncate text-[10px] text-muted-foreground">
          parece ser: {r.lead_sugerido_rotulo} — confira antes, a sugestão é por nome
        </p>
      ) : null}

      {ligando === r.protocolo ? (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={termo}
              onChange={(e) => void buscar(e.target.value)}
              placeholder="buscar o processo deste POP pelo nome ou número…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          {buscando ? (
            <Skeleton className="h-16 w-full" />
          ) : achados.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Nenhum processo sem protocolo bate com isso neste POP.
            </p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {achados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={salvando}
                  onClick={() => void ligar(p, r.protocolo)}
                  className="flex w-full items-center justify-between gap-2 rounded border bg-card px-2 py-1.5 text-left transition-colors hover:bg-accent/50 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                  {p.process_number ? (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {p.process_number}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-muted-foreground">sem CNJ</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mt-4 rounded-lg border p-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <Mailbox className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-sm font-medium">Requerimentos do INSS sem dono</span>
        {!loading && fila.length > 0 && (
          <Badge variant="secondary" className="shrink-0">{fila.length}</Badge>
        )}
      </button>

      {aberto && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground">
            O e-mail do INSS não traz número de processo — traz <b>protocolo</b>. Enquanto o
            protocolo não estiver anotado num processo deste POP, os e-mails dele não viram
            marco de ninguém. Anotado uma vez, o histórico inteiro entra de uma vez e todo
            e-mail futuro passa a mover a régua sozinho.
          </p>

          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : fila.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum requerimento pendente — todo protocolo que chegou por e-mail já tem dono.
            </p>
          ) : (
            <div className="space-y-1">
              {fila.map((r) => <Linha key={r.protocolo} r={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Auditoria da régua: os códigos de movimentação que os processos DESTE POP
// produzem, e qual marco reconhece cada um.
//
// Por que existe (16/08/2026): o TPU 277 ("Convenção das Partes para Satisfação
// Voluntária") estava cadastrado como sinal de "Levantamento / pagamento". Não é
// levantamento — é o combinado de COMO pagar. Como o marco tem ordem 24 e a
// execução tem 20, o processo subia ao topo da régua e travava: o caso 88 ficou
// 846 dias em "pagamento" tendo ido para execução com IDPJ. Ninguém tinha como
// ver isso: a linha da fase avisa "sem sinal", mas não existia o outro lado —
// o código que aparece nos autos e nenhum marco escuta.
//
// A régua do POP trabalhista tinha 36 códigos com sinal para 180 vistos.
//
// Duas armadilhas que a tela precisa respeitar:
//   1. NÃO casar por texto. O código 12066 é "Cumprimento de Levantamento da
//      SUSPENSÃO" e não tem nada a ver com dinheiro; casar por "levantamento"
//      repetiria o erro do 277. Por isso aqui se escolhe código a código.
//   2. Expediente domina a lista por frequência (Publicação, Conclusão, Petição,
//      Mero expediente). Sem o botão de ignorar, a fila nunca encolhe e a
//      auditoria vira ruído.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronRight, EyeOff, Radar, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { usePopMarcos } from '@/hooks/usePopMarcos';

interface Props { boardId: string }

interface LinhaAuditoria {
  codigo: number;
  nome: string | null;
  processos: number;
  ocorrencias: number;
  ultimo_visto: string | null;
  marcos: string | null;
  sem_sinal: boolean;
  ignorado: boolean;
}

const dataCurta = (iso: string | null) => {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
};

export function PopCodigosAuditoria({ boardId }: Props) {
  const [linhas, setLinhas] = useState<LinhaAuditoria[]>([]);
  const [loading, setLoading] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [mostrarIgnorados, setMostrarIgnorados] = useState(false);
  const [salvando, setSalvando] = useState<number | null>(null);
  const { marcos } = usePopMarcos(boardId);

  const carregar = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data, error } = await (db.rpc as unknown as (
        f: string, a: Record<string, unknown>,
      ) => PromiseLike<{ data?: LinhaAuditoria[] | null; error?: { message?: string } | null }>)(
        'pop_tpu_auditoria', { p_board_id: boardId },
      );
      if (error) throw new Error(error.message || 'pop_tpu_auditoria falhou');
      setLinhas(data || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar a auditoria');
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { if (aberto) void carregar(); }, [aberto, carregar]);

  const { pendentes, ignorados, comSinal } = useMemo(() => ({
    pendentes: linhas.filter(l => l.sem_sinal && !l.ignorado),
    ignorados: linhas.filter(l => l.ignorado),
    comSinal: linhas.filter(l => !l.sem_sinal),
  }), [linhas]);

  /** Vira sinal do marco escolhido. Só TPU: documento tem outro fluxo. */
  const virarSinal = async (codigo: number, marcoId: string) => {
    setSalvando(codigo);
    try {
      await ensureExternalSession();
      const { error } = await db.from('pop_marco_sinais').insert({
        pop_marco_id: marcoId, tipo: 'tpu', codigo,
        // `origem` só aceita 'manual' | 'ia' (check constraint). Foi gente que
        // decidiu na auditoria, então é manual — e confirmado.
        origem: 'manual', confirmado: true,
        motivo: 'cadastrado na auditoria de códigos do POP',
      } as never);
      if (error) throw new Error(error.message);
      toast.success('Sinal cadastrado. Vale para as próximas detecções.');
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cadastrar o sinal');
    } finally {
      setSalvando(null);
    }
  };

  const ignorar = async (codigo: number, desfazer = false) => {
    setSalvando(codigo);
    try {
      await ensureExternalSession();
      const q = desfazer
        ? db.from('pop_tpu_ignorado').delete().eq('board_id', boardId).eq('codigo', codigo)
        : db.from('pop_tpu_ignorado').insert({ board_id: boardId, codigo } as never);
      const { error } = await q;
      if (error) throw new Error(error.message);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao gravar');
    } finally {
      setSalvando(null);
    }
  };

  const Linha = ({ l, modo }: { l: LinhaAuditoria; modo: 'pendente' | 'ignorado' }) => (
    <div className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs">
      <span className="font-mono text-[10px] text-muted-foreground">{l.codigo}</span>
      <span className="min-w-0 flex-1 truncate" title={l.nome || ''}>{l.nome || '—'}</span>
      <span className="shrink-0 text-muted-foreground" title="processos deste POP em que aparece">
        {l.processos} proc.
      </span>
      <span className="shrink-0 text-muted-foreground" title="visto pela última vez">
        {dataCurta(l.ultimo_visto)}
      </span>
      {modo === 'pendente' ? (
        <>
          <Select onValueChange={v => void virarSinal(l.codigo, v)} disabled={salvando === l.codigo}>
            <SelectTrigger className="h-7 w-[13rem] shrink-0 text-xs">
              <SelectValue placeholder="virar sinal de…" />
            </SelectTrigger>
            <SelectContent>
              {marcos.map(m => (
                <SelectItem key={m.id} value={m.id} className="text-xs">{m.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs"
            onClick={() => void ignorar(l.codigo)} disabled={salvando === l.codigo}
            title="Este código não move a régua deste POP"
          >
            <EyeOff className="mr-1 h-3 w-3" /> ignorar
          </Button>
        </>
      ) : (
        <Button
          type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs"
          onClick={() => void ignorar(l.codigo, true)} disabled={salvando === l.codigo}
        >
          <Undo2 className="mr-1 h-3 w-3" /> voltar para a fila
        </Button>
      )}
    </div>
  );

  return (
    <div className="mt-4 rounded-lg border p-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setAberto(v => !v)}
      >
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <Radar className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-sm font-medium">Auditoria dos códigos de movimentação</span>
        {aberto && !loading && pendentes.length > 0 && (
          <Badge variant="secondary" className="shrink-0">{pendentes.length} sem marco</Badge>
        )}
      </button>

      {aberto && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Cada código que os processos deste POP produziram, e qual marco escuta ele. Código sem
            marco nenhum é etapa que o processo cumpre e a régua não enxerga. Escolha código a
            código: casar por texto já custou caro aqui — “Cumprimento de Levantamento da Suspensão”
            não tem nada a ver com levantamento de dinheiro.
          </p>

          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              {pendentes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum código pendente — todos já viraram sinal ou foram ignorados.
                </p>
              ) : (
                <div className="space-y-1">
                  {pendentes.map(l => <Linha key={l.codigo} l={l} modo="pendente" />)}
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
                <span>{comSinal.length} código(s) já com marco</span>
                {ignorados.length > 0 && (
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => setMostrarIgnorados(v => !v)}
                  >
                    {ignorados.length} ignorado(s) {mostrarIgnorados ? '— esconder' : '— ver'}
                  </button>
                )}
              </div>

              {mostrarIgnorados && ignorados.length > 0 && (
                <div className="space-y-1 border-t pt-2">
                  {ignorados.map(l => <Linha key={l.codigo} l={l} modo="ignorado" />)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

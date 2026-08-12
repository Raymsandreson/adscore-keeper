// =============================================================================
// Estado das duas filas de captura, dentro do sino.
//
// Por que aqui: o sino já é onde se olha "o que chegou de novo nos processos".
// A pergunta "e o que ainda NÃO chegou?" é a mesma pergunta pelo avesso — e sem
// resposta visível, uma fila parada passa despercebida. Foi o que aconteceu
// entre 09/07 e 11/08: a captura terminou sozinha, sem erro nenhum, e ninguém
// viu por um mês.
//
// O gasto exibido não é estimativa: vem de jm_esc_solicitacoes.creditos, que é
// o valor que a própria API do Escavador devolve na resposta ("creditos":"20").
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, FileText, Radio, AlertTriangle, Mail } from 'lucide-react';

interface CapturaStatus {
  fonte: 'escavador' | 'datajud' | 'email';
  descricao: string;
  total: number;
  concluidos: number;
  na_fila: number;
  em_andamento: number;
  com_erro: number;
  pct: number;
  iniciou_em: string | null;
  ultimo_concluido: string | null;
  gasto_reais: string | number | null;
  falta_gastar_reais: string | number | null;
}

function hora(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function reais(v: string | number | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function CapturaStatusPanel() {
  const [linhas, setLinhas] = useState<CapturaStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    try {
      // `as any`: a view é nova e ainda não está nos tipos gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (db as any).from('vw_jm_captura_status').select('*');
      setLinhas((data || []) as CapturaStatus[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  if (loading) return <div className="px-4 py-3"><Skeleton className="h-16 w-full" /></div>;
  if (!linhas.length) return null;

  return (
    <div className="space-y-3 border-b bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          Atualização dos processos
        </span>
        <button
          type="button"
          onClick={() => void carregar()}
          className="text-muted-foreground hover:text-foreground"
          title="Atualizar este resumo"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {linhas.map((l) => {
        const emAndamento = l.na_fila > 0 || l.em_andamento > 0;
        return (
          <div key={l.fonte} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                {l.fonte === 'escavador' ? <FileText className="h-3.5 w-3.5" />
                  : l.fonte === 'email' ? <Mail className="h-3.5 w-3.5" />
                  : <Radio className="h-3.5 w-3.5" />}
                {l.fonte === 'escavador' ? 'Documentos (Escavador)'
                  : l.fonte === 'email' ? 'Avisos por e-mail'
                  : 'Movimentações (DataJud)'}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {l.concluidos} de {l.total} · {l.pct}%
              </span>
            </div>

            <Progress value={l.pct} className="h-1.5" />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {emAndamento ? (
                <span>
                  {l.na_fila > 0 ? `${l.na_fila} na fila` : null}
                  {l.na_fila > 0 && l.em_andamento > 0 ? ' · ' : null}
                  {l.em_andamento > 0 ? `${l.em_andamento} em andamento` : null}
                </span>
              ) : (
                <span>concluído</span>
              )}

              {l.fonte === 'escavador' ? (
                <>
                  <span>começou {hora(l.iniciou_em)}</span>
                  <span>última entrega {hora(l.ultimo_concluido)}</span>
                  <span className="font-medium text-foreground">
                    gasto {reais(l.gasto_reais)}
                  </span>
                  {Number(l.falta_gastar_reais) > 0 ? (
                    <span>falta ~{reais(l.falta_gastar_reais)}</span>
                  ) : null}
                </>
              ) : (
                <>
                  {/* No e-mail, a descrição diz DE QUAL CAIXA vem — é o que se
                      quer saber ao olhar: tribunal ou INSS. */}
                  {l.fonte === 'email' ? <span>{l.descricao}</span> : null}
                  {/* Chegada e leitura são coisas diferentes, e por um tempo o
                      painel tratou as duas como uma só: mostrava o último
                      e-mail RECEBIDO sob o rótulo "última entrega", com a fila
                      em 0 processados. Uma fila parada parecia fila andando. */}
                  {l.fonte === 'email' ? (
                    <span>último e-mail {hora(l.iniciou_em)}</span>
                  ) : null}
                  <span>última entrega {hora(l.ultimo_concluido)}</span>
                  <span>sem custo</span>
                </>
              )}

              {l.com_erro > 0 ? (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  {l.com_erro} com erro
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

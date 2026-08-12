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
//
// Vem recolhido: no celular as três barras comiam um terço da tela antes da
// primeira movimentação aparecer, e quem abre o sino abre pra ler o que chegou.
// O que não pode sumir junto é o aviso de fila parada — por isso a barra
// fechada continua dizendo quantos estão na fila e quantos deram erro.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, FileText, Radio, AlertTriangle, Mail, ChevronDown, ChevronRight } from 'lucide-react';

const CHAVE_ABERTO = 'jm.captura-status.aberto';

// A ordem é a da cadeia, não a do custo: o aviso por e-mail diz que o processo
// mexeu, o DataJud diz o QUE mudou (código TPU do movimento) e o Escavador só
// então busca o documento de quem tem documento. Ler de cima para baixo é ler o
// funil. A view faz UNION ALL sem ORDER BY — a ordem que chega não é garantida,
// então quem manda é esta lista.
const ORDEM_DA_CADEIA: CapturaStatus['fonte'][] = ['email', 'datajud', 'escavador'];

function lerPreferencia(): boolean {
  try {
    return localStorage.getItem(CHAVE_ABERTO) === '1';
  } catch {
    return false;
  }
}

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
  const [aberto, setAberto] = useState(lerPreferencia);

  const alternar = useCallback(() => {
    setAberto((v) => {
      const proximo = !v;
      try { localStorage.setItem(CHAVE_ABERTO, proximo ? '1' : '0'); } catch { /* modo privado */ }
      return proximo;
    });
  }, []);

  const carregar = useCallback(async () => {
    try {
      // `as any`: a view é nova e ainda não está nos tipos gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (db as any).from('vw_jm_captura_status').select('*');
      const vindas = (data || []) as CapturaStatus[];
      setLinhas(
        [...vindas].sort(
          (a, b) => ORDEM_DA_CADEIA.indexOf(a.fonte) - ORDEM_DA_CADEIA.indexOf(b.fonte),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  if (loading) return <div className="px-4 py-3"><Skeleton className="h-4 w-48" /></div>;
  if (!linhas.length) return null;

  // Resumo da barra fechada: o mínimo pra uma fila travada não passar em branco.
  const pendentes = linhas.reduce((s, l) => s + l.na_fila + l.em_andamento, 0);
  const comErro = linhas.reduce((s, l) => s + l.com_erro, 0);

  return (
    <div className="border-b bg-muted/30 px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
          title={aberto ? 'Recolher o resumo da captura' : 'Ver o resumo da captura'}
        >
          {aberto
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="shrink-0">Atualização dos processos</span>
          {!aberto && (
            <span className="truncate text-[11px] font-normal">
              {comErro > 0 ? (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {comErro} com erro
                </span>
              ) : pendentes > 0 ? (
                `· ${pendentes} na fila`
              ) : (
                '· em dia'
              )}
            </span>
          )}
        </button>
        {aberto && (
          <button
            type="button"
            onClick={() => void carregar()}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Atualizar este resumo"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {aberto && (
      <div className="mt-3 space-y-3">
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
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Target, CheckCircle2, Clock, AlertTriangle, ExternalLink, Loader2, Sparkles, Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useProcessMovements, type MarcoTipo, type ProcessMovement } from '@/hooks/useProcessMovements';

// -----------------------------------------------------------------------------
// Aba "Resultado" — mostra o resultado ESPERADO (alvo, herdado do POP com override
// opcional por-processo) x o resultado ATINGIDO (detectado das movimentações do
// Escavador). Decisões do produto (jul/2026):
//   - Auto-confirma SÓ marco inequívoco (trânsito em julgado / acordo / pagamento);
//     o resto vira sugestão que o assessor confirma em 1 clique.
//   - O mapa marco→resultado do POP vem de settings.resultados[].marco (gatilho).
//   - Toda detecção é auditável: guarda a movimentação de origem (ref) + data.
// Fase 1 (aqui): caminho judicial + esperado + confirmação. O espelhamento no
// ranking do telão e a detecção por e-mail (POP administrativo) são a Fase 2.
// -----------------------------------------------------------------------------

const MARCO_LABEL: Record<MarcoTipo, string> = {
  peticao_inicial: 'Petição Inicial',
  audiencia_conciliacao: 'Audiência de Conciliação',
  pericia: 'Perícia',
  audiencia_instrucao: 'Audiência de Instrução',
  sentenca_1grau: 'Sentença (1º Grau)',
  acordo: 'Acordo homologado',
  acordao_2grau: 'Acórdão (2º Grau)',
  acordao_superior: 'Acórdão (Superior)',
  transito_julgado: 'Trânsito em Julgado',
  pagamento: 'Pagamento',
};

// Só estes marcos caracterizam um RESULTADO (desfecho). Audiência/perícia/petição
// são estações intermediárias — não viram resultado atingido.
const MARCO_ORDEM_RESULTADO: Partial<Record<MarcoTipo, number>> = {
  sentenca_1grau: 2,
  acordo: 3,
  acordao_2grau: 4,
  acordao_superior: 5,
  transito_julgado: 6,
  pagamento: 7,
};

// Marcos inequívocos: o sistema grava sozinho (status = confirmado). Baixo erro.
const MARCOS_INEQUIVOCOS: MarcoTipo[] = ['transito_julgado', 'acordo', 'pagamento'];

export interface PopResultado {
  id: string;
  label: string;
  /** Marco-gatilho: quando este marco é detectado, o resultado do POP é este. */
  marco?: MarcoTipo | null;
}

export interface PopResultConfig {
  resultados: PopResultado[];
  resultado_esperado_id?: string | null;
}

interface AtingidoState {
  resultado: string | null;
  tipo: string | null;
  data: string | null;
  fonte: string | null;
  ref: string | null;
  status: string | null;
}

interface Props {
  processId: string;
  processType: string | null;
  /** settings do POP vinculado (resultados + resultado esperado). */
  pop: PopResultConfig | null;
  /** override por-processo do resultado esperado (null = herda do POP). */
  esperadoOverrideId: string | null;
  /** data-alvo (prognóstico) por-processo. */
  dataAlvo: string | null;
  /** valores atuais do resultado atingido gravado na ficha. */
  atingido: AtingidoState;
  /** roteia override + data-alvo pelo form/save do pai (fluxo dirty). */
  onSetEsperado: (key: string, value: unknown) => void;
  /** sincroniza o form do pai após gravação direta do atingido. */
  onAtingidoWritten: (row: Record<string, unknown>) => void;
}

function fmtDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR');
}

function labelForMarco(tipo: MarcoTipo, pop: PopResultConfig | null): string {
  const mapped = pop?.resultados?.find((r) => r.marco === tipo);
  return mapped?.label || MARCO_LABEL[tipo] || tipo;
}

/** Escolhe o desfecho mais conclusivo entre os marcos do processo (maior ordem). */
function pickDesfecho(movements: ProcessMovement[]): ProcessMovement | null {
  let best: ProcessMovement | null = null;
  let bestOrdem = -1;
  for (const m of movements) {
    const ordem = MARCO_ORDEM_RESULTADO[m.tipo_movimentacao];
    if (ordem == null) continue;
    if (ordem > bestOrdem) {
      bestOrdem = ordem;
      best = m;
    }
  }
  return best;
}

export function ProcessResultadoTab({
  processId, processType, pop, esperadoOverrideId, dataAlvo, atingido,
  onSetEsperado, onAtingidoWritten,
}: Props) {
  const isAdministrativo = (processType || 'judicial') === 'administrativo';
  const { movements, loading } = useProcessMovements(processId);
  const [saving, setSaving] = useState(false);
  const autoWrittenRef = useRef<string | null>(null);

  const desfecho = useMemo(() => pickDesfecho(movements), [movements]);

  // Resultado esperado efetivo: override do processo ou herança do POP.
  const effectiveEsperadoId = esperadoOverrideId || pop?.resultado_esperado_id || null;
  const esperadoLabel = pop?.resultados?.find((r) => r.id === effectiveEsperadoId)?.label || null;
  const isHerdado = !esperadoOverrideId;

  const persistAtingido = useCallback(async (payload: Partial<Record<string, unknown>>) => {
    setSaving(true);
    try {
      const { data, error } = await externalSupabase
        .from('lead_processes')
        .update(payload as never)
        .eq('id', processId)
        .select();
      if (error) throw error;
      if (data && data[0]) onAtingidoWritten(data[0] as Record<string, unknown>);
    } catch (e) {
      console.error('[ProcessResultadoTab] erro ao gravar resultado atingido:', e);
    } finally {
      setSaving(false);
    }
  }, [processId, onAtingidoWritten]);

  // Auto-confirma marco INEQUÍVOCO detectado (Q2). Nunca sobrescreve um resultado
  // marcado manualmente (fonte='manual') — escape hatch do assessor. Idempotente:
  // só grava quando a evidência (ref) muda e progride (mesma sessão não repete).
  useEffect(() => {
    if (loading || !desfecho) return;
    if (atingido.fonte === 'manual') return;
    const tipo = desfecho.tipo_movimentacao;
    if (!MARCOS_INEQUIVOCOS.includes(tipo)) return;
    if (atingido.ref === desfecho.id && atingido.status === 'confirmado') return;
    if (autoWrittenRef.current === desfecho.id) return;
    autoWrittenRef.current = desfecho.id;
    persistAtingido({
      resultado_atingido: labelForMarco(tipo, pop),
      resultado_atingido_tipo: tipo,
      resultado_atingido_data: desfecho.data_movimentacao?.slice(0, 10) || null,
      resultado_atingido_fonte: 'escavador',
      resultado_atingido_ref: desfecho.id,
      resultado_atingido_status: 'confirmado',
    });
  }, [loading, desfecho, atingido.fonte, atingido.ref, atingido.status, pop, persistAtingido]);

  // Sugestão pendente: desfecho ambíguo detectado que ainda não virou o atingido gravado.
  const sugestaoPendente = useMemo(() => {
    if (!desfecho) return null;
    const tipo = desfecho.tipo_movimentacao;
    if (MARCOS_INEQUIVOCOS.includes(tipo)) return null; // esses auto-confirmam
    if (atingido.ref === desfecho.id) return null; // já tratado
    if (atingido.fonte === 'manual') return null;
    return desfecho;
  }, [desfecho, atingido.ref, atingido.fonte]);

  const confirmarSugestao = () => {
    if (!sugestaoPendente) return;
    const tipo = sugestaoPendente.tipo_movimentacao;
    persistAtingido({
      resultado_atingido: labelForMarco(tipo, pop),
      resultado_atingido_tipo: tipo,
      resultado_atingido_data: sugestaoPendente.data_movimentacao?.slice(0, 10) || null,
      resultado_atingido_fonte: 'escavador',
      resultado_atingido_ref: sugestaoPendente.id,
      resultado_atingido_status: 'confirmado',
    });
  };

  // Override manual: assessor escolhe um resultado do POP à mão (vira fonte da verdade).
  const setManual = (resultadoId: string) => {
    if (resultadoId === '__limpar__') {
      persistAtingido({
        resultado_atingido: null, resultado_atingido_tipo: null, resultado_atingido_data: null,
        resultado_atingido_fonte: null, resultado_atingido_ref: null, resultado_atingido_status: null,
      });
      autoWrittenRef.current = null;
      return;
    }
    const r = pop?.resultados?.find((x) => x.id === resultadoId);
    if (!r) return;
    persistAtingido({
      resultado_atingido: r.label,
      resultado_atingido_tipo: r.marco || null,
      resultado_atingido_data: (new Date().toISOString().slice(0, 10)),
      resultado_atingido_fonte: 'manual',
      resultado_atingido_ref: null,
      resultado_atingido_status: 'confirmado',
    });
  };

  const temAtingido = !!atingido.resultado;

  return (
    <div className="space-y-3">
      {/* ---------------- ESPERADO (alvo) ---------------- */}
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">Status esperado</span>
          {isHerdado && esperadoLabel && (
            <Badge variant="outline" className="text-[9px] ml-auto">herdado do POP</Badge>
          )}
        </div>

        {!pop || (pop.resultados?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum status cadastrado no POP vinculado. Configure os status possíveis e o esperado no POP (WorkflowBuilder).
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Alvo</Label>
              <Select
                value={esperadoOverrideId || '__herdar__'}
                onValueChange={(v) => onSetEsperado('resultado_esperado_id_override', v === '__herdar__' ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  <SelectItem value="__herdar__">
                    Herdar do POP{esperadoLabel && isHerdado ? ` — ${esperadoLabel}` : pop.resultado_esperado_id ? ` — ${pop.resultados.find(r => r.id === pop.resultado_esperado_id)?.label || ''}` : ''}
                  </SelectItem>
                  {pop.resultados.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!esperadoLabel && (
                <p className="text-[10px] text-muted-foreground">
                  O POP ainda não define um status esperado. Marque-o no WorkflowBuilder ou escolha um override acima.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Data-alvo (prognóstico)</Label>
              <Input
                type="date"
                value={dataAlvo || ''}
                onChange={(e) => onSetEsperado('resultado_esperado_data_alvo', e.target.value || null)}
                className="h-8 text-xs bg-background"
              />
            </div>
          </>
        )}
      </div>

      {/* ---------------- ATINGIDO (detectado) ---------------- */}
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status atingido</span>
          {saving && <Loader2 className="h-3 w-3 animate-spin ml-auto text-muted-foreground" />}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Lendo movimentações…
          </div>
        ) : temAtingido ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn(
                'text-[10px]',
                atingido.status === 'confirmado'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
              )}>
                {atingido.resultado}
              </Badge>
              <span className="text-[11px] text-muted-foreground">em {fmtDate(atingido.data)}</span>
              {atingido.status === 'confirmado'
                ? <Badge variant="outline" className="text-[9px] gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" />confirmado</Badge>
                : <Badge variant="outline" className="text-[9px] gap-0.5"><Clock className="h-2.5 w-2.5" />sugerido</Badge>}
            </div>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              {atingido.fonte === 'manual'
                ? <><Sparkles className="h-2.5 w-2.5" /> definido manualmente</>
                : atingido.fonte === 'email_intimacao'
                  ? <><Mail className="h-2.5 w-2.5" /> detectado da intimação por e-mail</>
                  : <><Sparkles className="h-2.5 w-2.5" /> detectado automaticamente das movimentações</>}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {isAdministrativo
              ? 'POP administrativo: o resultado virá da intimação por e-mail (detecção automática na Fase 2).'
              : 'Nenhum desfecho detectado ainda nas movimentações. Assim que sair sentença, acordo, trânsito ou pagamento, aparece aqui automaticamente.'}
          </p>
        )}

        {/* Sugestão ambígua pendente de confirmação */}
        {sugestaoPendente && (
          <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-900/10 p-2 space-y-1.5">
            <p className="text-[11px] flex items-center gap-1 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              Detectado <strong>{labelForMarco(sugestaoPendente.tipo_movimentacao, pop)}</strong> em {fmtDate(sugestaoPendente.data_movimentacao)}. Confirma?
            </p>
            {sugestaoPendente.descricao && (
              <p className="text-[10px] text-muted-foreground line-clamp-3">{sugestaoPendente.descricao}</p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-6 text-[11px]" onClick={confirmarSugestao} disabled={saving}>
                Confirmar
              </Button>
              {sugestaoPendente.link_decisao && (
                <a
                  href={sugestaoPendente.link_decisao} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-primary flex items-center gap-0.5"
                >
                  <ExternalLink className="h-2.5 w-2.5" /> ver decisão
                </a>
              )}
            </div>
          </div>
        )}

        {/* Override manual — escape hatch quando a detecção erra ou é atípico */}
        {pop && (pop.resultados?.length ?? 0) > 0 && (
          <div className="pt-1 space-y-1 border-t">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Ajustar manualmente</Label>
            <Select value="" onValueChange={setManual}>
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue placeholder="Definir status à mão…" />
              </SelectTrigger>
              <SelectContent className="z-[9999]">
                {pop.resultados.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
                {temAtingido && <SelectItem value="__limpar__">Limpar status</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

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
  /** Status esperado(s) do POP — pode ser mais de um. */
  resultado_esperado_ids?: string[] | null;
  /** Legado (single) — usado como fallback quando não há resultado_esperado_ids. */
  resultado_esperado_id?: string | null;
}

/** O override por-processo é guardado como JSON array de ids (texto). Aceita
 *  também o formato legado (id único em texto puro) ou vazio. */
function parseOverrideIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  } catch { /* não é JSON — trata como id único legado */ }
  return [raw];
}
function serializeOverrideIds(ids: string[]): string | null {
  return ids.length ? JSON.stringify(ids) : null;
}
function popExpectedIds(pop: PopResultConfig | null): string[] {
  if (!pop) return [];
  if (Array.isArray(pop.resultado_esperado_ids) && pop.resultado_esperado_ids.length) return pop.resultado_esperado_ids;
  return pop.resultado_esperado_id ? [pop.resultado_esperado_id] : [];
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
  /** nº CNJ do processo — usado pra casar as intimações por e-mail (POP administrativo). */
  processNumber: string | null;
  /** settings do POP vinculado (resultados + resultado esperado). */
  pop: PopResultConfig | null;
  /** override por-processo do status esperado, cru do banco (JSON array de ids,
   *  id único legado, ou null = herda do POP). */
  esperadoOverrideRaw: string | null;
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

function resultadoForMarco(tipo: MarcoTipo, pop: PopResultConfig | null): PopResultado | null {
  return pop?.resultados?.find((r) => r.marco === tipo) || null;
}
function labelForMarco(tipo: MarcoTipo, pop: PopResultConfig | null): string {
  return resultadoForMarco(tipo, pop)?.label || MARCO_LABEL[tipo] || tipo;
}

function normalize(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Palavras que sugerem que a intimação carrega um desfecho (não é mero expediente).
const ADMIN_DESFECHO_KW = [
  'deferi', 'indeferi', 'concedi', 'homologa', 'sentenc', 'improcedent', 'procedent',
  'exigencia', 'arquiva', 'cessa', 'concessao', 'negativa', 'decisao',
];

interface IntimacaoEmail {
  id: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string | null;
  has_movimentacao: boolean | null;
}

function looksLikeDesfecho(e: IntimacaoEmail): boolean {
  const t = normalize(`${e.subject || ''} ${e.snippet || ''} ${e.body_text || ''}`);
  return ADMIN_DESFECHO_KW.some((k) => t.includes(k));
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
  processId, processType, processNumber, pop, esperadoOverrideRaw, dataAlvo, atingido,
  onSetEsperado, onAtingidoWritten,
}: Props) {
  const isAdministrativo = (processType || 'judicial') === 'administrativo';
  const { movements, loading } = useProcessMovements(processId);
  const [saving, setSaving] = useState(false);
  const autoWrittenRef = useRef<string | null>(null);

  // Intimações por e-mail (POP administrativo): fonte do desfecho quando não há
  // movimentação do Escavador. Só busca quando é administrativo e tem nº.
  const [emails, setEmails] = useState<IntimacaoEmail[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  useEffect(() => {
    if (!isAdministrativo || !processNumber) { setEmails([]); return; }
    let cancel = false;
    setLoadingEmails(true);
    (externalSupabase as unknown as { from: (t: string) => any })
      .from('processual_emails')
      .select('id, subject, snippet, body_text, received_at, has_movimentacao')
      .eq('process_number', processNumber)
      .is('deleted_at', null)
      .order('received_at', { ascending: false })
      .limit(8)
      .then(({ data }: { data: IntimacaoEmail[] | null }) => {
        if (!cancel) { setEmails(data || []); setLoadingEmails(false); }
      });
    return () => { cancel = true; };
  }, [isAdministrativo, processNumber]);

  // Intimação mais recente que parece carregar um desfecho — vira a evidência de origem.
  const desfechoEmail = useMemo(() => emails.find(looksLikeDesfecho) || emails[0] || null, [emails]);

  const desfecho = useMemo(() => pickDesfecho(movements), [movements]);

  // Status esperado(s) efetivos: override do processo (se houver) ou herança do POP.
  const overrideIds = useMemo(() => parseOverrideIds(esperadoOverrideRaw), [esperadoOverrideRaw]);
  const isHerdado = overrideIds.length === 0;
  const effectiveEsperadoIds = isHerdado ? popExpectedIds(pop) : overrideIds;
  const esperadoLabels = effectiveEsperadoIds
    .map((id) => pop?.resultados?.find((r) => r.id === id)?.label)
    .filter((l): l is string => !!l);

  const toggleOverride = (id: string) => {
    // base = o que está efetivo hoje (herdado ou já override) — o 1º toggle a partir
    // de "herdado" materializa o conjunto atual e então aplica a mudança.
    const base = isHerdado ? popExpectedIds(pop) : overrideIds;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    // se voltou a ser exatamente o conjunto do POP, limpa o override (volta a herdar)
    const popIds = popExpectedIds(pop);
    const sameAsPop = next.length === popIds.length && next.every((x) => popIds.includes(x));
    onSetEsperado('resultado_esperado_id_override', sameAsPop ? null : serializeOverrideIds(next));
  };

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
      resultado_atingido_id: resultadoForMarco(tipo, pop)?.id || null,
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
      resultado_atingido_id: resultadoForMarco(tipo, pop)?.id || null,
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
        resultado_atingido: null, resultado_atingido_id: null, resultado_atingido_tipo: null, resultado_atingido_data: null,
        resultado_atingido_fonte: null, resultado_atingido_ref: null, resultado_atingido_status: null,
      });
      autoWrittenRef.current = null;
      return;
    }
    const r = pop?.resultados?.find((x) => x.id === resultadoId);
    if (!r) return;
    // POP administrativo: o status é definido a partir da intimação por e-mail —
    // registra a origem (email_intimacao) e a intimação de referência.
    const viaEmail = isAdministrativo && !!desfechoEmail;
    persistAtingido({
      resultado_atingido: r.label,
      resultado_atingido_id: r.id,
      resultado_atingido_tipo: r.marco || null,
      resultado_atingido_data: viaEmail && desfechoEmail?.received_at
        ? desfechoEmail.received_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      resultado_atingido_fonte: viaEmail ? 'email_intimacao' : 'manual',
      resultado_atingido_ref: viaEmail ? desfechoEmail!.id : null,
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
          <Badge variant="outline" className="text-[9px] ml-auto">
            {isHerdado ? 'herdado do POP' : 'override do processo'}
          </Badge>
        </div>

        {!pop || (pop.resultados?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum status cadastrado no POP vinculado. Configure os status possíveis e o esperado no POP (WorkflowBuilder).
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Alvo(s)</Label>
              {esperadoLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {esperadoLabels.map((l) => (
                    <Badge key={l} className="text-[10px] bg-primary/10 text-primary hover:bg-primary/10">{l}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  Nenhum status esperado definido. Marque um ou mais no POP (WorkflowBuilder) ou sobrescreva abaixo.
                </p>
              )}
              {/* Override por-processo: marque um ou mais; deixe igual ao POP pra herdar. */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {pop.resultados.map((r) => {
                  const on = effectiveEsperadoIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleOverride(r.id)}
                      className={cn(
                        'text-[10px] rounded-full border px-2 py-0.5 transition-colors',
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {on ? '✓ ' : ''}{r.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-muted-foreground">
                Clique pra marcar/desmarcar. Igual ao POP = herda; diferente = override deste processo.
              </p>
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
        ) : isAdministrativo ? (
          <p className="text-[11px] text-muted-foreground">
            POP administrativo: o status vem da intimação por e-mail (abaixo). Escolha o status com base nela.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Nenhum desfecho detectado ainda nas movimentações. Assim que sair sentença, acordo, trânsito ou pagamento, aparece aqui automaticamente.
          </p>
        )}

        {/* Intimações por e-mail — evidência de origem para POP administrativo */}
        {isAdministrativo && (
          <div className="rounded-md border border-blue-300/40 bg-blue-50 dark:bg-blue-900/10 p-2 space-y-1.5">
            <p className="text-[11px] font-medium flex items-center gap-1 text-blue-800 dark:text-blue-300">
              <Mail className="h-3 w-3" /> Intimações por e-mail
            </p>
            {loadingEmails ? (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Buscando intimações…
              </div>
            ) : emails.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
                Nenhuma intimação por e-mail encontrada para este número. Chegando uma, aparece aqui.
              </p>
            ) : (
              <div className="space-y-1">
                {emails.slice(0, 4).map((e) => (
                  <div
                    key={e.id}
                    className={cn(
                      'rounded border p-1.5 text-[10px]',
                      looksLikeDesfecho(e) ? 'border-blue-300 bg-background' : 'border-transparent bg-background/50',
                    )}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-muted-foreground">{fmtDate(e.received_at)}</span>
                      {looksLikeDesfecho(e) && (
                        <Badge variant="outline" className="text-[8px] py-0 border-blue-400 text-blue-700 dark:text-blue-300">possível desfecho</Badge>
                      )}
                      <span className="font-medium truncate">{e.subject || '(sem assunto)'}</span>
                    </div>
                    {e.snippet && <p className="text-muted-foreground line-clamp-2 mt-0.5">{e.snippet}</p>}
                  </div>
                ))}
                <p className="text-[9px] text-muted-foreground pt-0.5">
                  Defina o status abaixo — ele fica gravado como vindo da intimação (fonte auditável).
                </p>
              </div>
            )}
          </div>
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

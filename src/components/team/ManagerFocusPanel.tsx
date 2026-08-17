// =============================================================================
// FOCO DOS GERENTES — um card por gerente com o quanto do esforço dele caiu na
// área de foco no período, e (para quem tem carteira) quantos processos saíram
// por ACORDO ou por EXECUÇÃO.
//
// Pedido do usuário (17/08/2026): "cada gerente tem q ter uma porcentagem na sua
// área de foco; o de vendas deve ter pelo menos 80% em vendas; o processual
// fazer os processos saírem, seja por acordo ou execução".
//
// A configuração abre em painel LATERAL (Sheet), por cima da lista — regra
// permanente ui-sem-redirecionar.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Crosshair, Loader2, RefreshCw, Settings2, Target, TrendingDown, Handshake, Gavel, AlertTriangle,
  ArrowDownToLine, ArrowUpFromLine, X, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useManagerFocus, FocusPeriod, PERIOD_LABEL, ManagerFocusRow, FocusTypeCount,
  FocusPreview, ManagerFocusInput, KEYWORD_SUGGESTIONS,
} from '@/hooks/useManagerFocus';

const PERIODS: FocusPeriod[] = ['semana', 'mes', 'trimestre', 'ano'];

/** Cor da barra: verde bate o piso, âmbar chega perto, vermelho longe. */
function focusTone(pct: number | null, min: number | null) {
  if (pct === null || min === null) return 'muted';
  if (pct >= min) return 'ok';
  if (pct >= min - 15) return 'warn';
  return 'bad';
}

function ManagerCard({ row, onConfigure }: { row: ManagerFocusRow; onConfigure: (r: ManagerFocusRow) => void }) {
  const tone = focusTone(row.pct, row.min_percent);
  const fora = useMemo(() => (row.fora || []).slice(0, 5), [row.fora]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{row.nome || 'Sem nome'}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {(row.times || []).length > 0 ? (row.times || []).join(' · ') : 'Sem time vinculado'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {row.configurado ? (
              <Badge variant="secondary" className="gap-1">
                <Crosshair className="h-3 w-3" />
                {row.focus_label}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                <AlertTriangle className="h-3 w-3" />
                Sem área de foco
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={() => onConfigure(row)} title="Configurar foco">
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---- Esforço: % na área de foco ---- */}
        {row.configurado ? (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm text-muted-foreground">
                {row.no_foco} de {row.concluidas} atividades concluídas na área
              </span>
              <span className={cn(
                'text-2xl font-semibold tabular-nums',
                tone === 'ok' && 'text-emerald-600',
                tone === 'warn' && 'text-amber-600',
                tone === 'bad' && 'text-red-600',
                tone === 'muted' && 'text-muted-foreground',
              )}>
                {row.pct === null ? '—' : `${row.pct}%`}
              </span>
            </div>

            {/* Barra com a marca do piso: dá pra ver a distância da meta. */}
            <div className="relative">
              <Progress
                value={row.pct ?? 0}
                className={cn(
                  'h-2.5',
                  tone === 'ok' && '[&>div]:bg-emerald-500',
                  tone === 'warn' && '[&>div]:bg-amber-500',
                  tone === 'bad' && '[&>div]:bg-red-500',
                )}
              />
              {row.min_percent !== null && (
                <div
                  className="absolute top-0 h-2.5 w-0.5 bg-foreground/60"
                  style={{ left: `${Math.min(100, Math.max(0, row.min_percent))}%` }}
                  title={`Piso: ${row.min_percent}%`}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {row.pct === null
                ? 'Nenhuma atividade concluída no período.'
                : row.atingiu
                  ? `Acima do piso de ${row.min_percent}%.`
                  : `Abaixo do piso de ${row.min_percent}% — faltam ${
                      Math.max(0, Math.ceil((row.min_percent! * row.concluidas) / 100) - row.no_foco)
                    } atividades na área para bater.`}
            </p>
            {row.resgatadas_pelo_texto > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {row.resgatadas_pelo_texto} delas só foram reconhecidas pelo assunto —
                o tipo cadastrado estava errado.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Escolha a área de foco e quais tipos de atividade contam como foco para
            este gerente — sem isso não há % para cobrar.
          </p>
        )}

        {/* ---- Onde o foco vaza ---- */}
        {row.configurado && fora.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
              <TrendingDown className="h-3.5 w-3.5" /> Fora da área
            </p>
            <div className="flex flex-wrap gap-1.5">
              {fora.map(f => (
                <Badge key={f.tipo} variant="outline" className="font-normal">
                  {f.label} <span className="ml-1 tabular-nums text-muted-foreground">{f.n}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ---- Resultado: entrou × saiu ----
             O que não entra não sai; o que não sai trava a entrada. Por isso as
             duas pontas ficam lado a lado, com a vazão entre elas. */}
        {row.track_process_exits && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Target className="h-3.5 w-3.5" /> Processos no período
              </p>
              <span className="text-xs text-muted-foreground">
                carteira: {row.processos_carteira}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-background/60 py-1.5">
                <div className="text-xl font-semibold tabular-nums flex items-center justify-center gap-1">
                  <ArrowDownToLine className="h-4 w-4 text-sky-600" />{row.entradas}
                </div>
                <div className="text-[10px] font-medium uppercase text-muted-foreground">Entraram</div>
              </div>
              <div className="rounded-md bg-background/60 py-1.5">
                <div className="text-xl font-semibold tabular-nums flex items-center justify-center gap-1">
                  <ArrowUpFromLine className="h-4 w-4 text-emerald-600" />{row.saidas}
                  {row.exit_target ? (
                    <span className="text-xs font-normal text-muted-foreground">/{row.exit_target}</span>
                  ) : null}
                </div>
                <div className="text-[10px] font-medium uppercase text-muted-foreground">Saíram</div>
              </div>
              <div className="rounded-md bg-background/60 py-1.5">
                <div className={cn(
                  'text-xl font-semibold tabular-nums',
                  row.vazao_pct === null ? 'text-muted-foreground'
                    : row.vazao_pct >= 100 ? 'text-emerald-600' : 'text-amber-600',
                )}>
                  {row.vazao_pct === null ? '—' : `${row.vazao_pct}%`}
                </div>
                <div className="text-[10px] font-medium uppercase text-muted-foreground">Vazão</div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                <Handshake className="h-4 w-4 text-emerald-600" />
                Acordo <strong className="tabular-nums">{row.saidas_por_acordo}</strong>
              </span>
              <span className="flex items-center gap-1.5">
                <Gavel className="h-4 w-4 text-blue-600" />
                Execução <strong className="tabular-nums">{row.saidas_por_execucao}</strong>
              </span>
              {row.min_exit_percent !== null && row.pct_saida_carteira !== null && (
                <span className={cn(
                  'ml-auto text-xs font-medium',
                  row.atingiu_saida ? 'text-emerald-600' : 'text-red-600',
                )}>
                  {row.pct_saida_carteira}% da carteira saiu · piso {row.min_exit_percent}%
                </span>
              )}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              {row.vazao_pct === null
                ? 'Nenhum processo entrou no período — a vazão fica sem base de comparação.'
                : row.vazao_pct >= 100
                  ? 'Saiu mais do que entrou: a fila diminuiu.'
                  : `Entraram ${row.entradas} e saíram ${row.saidas} — a fila cresceu em ${row.entradas - row.saidas}.`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Painel lateral de configuração — abre por cima da lista, não redireciona. */
function FocusConfigSheet({
  row, open, onOpenChange, fetchTypes, previewFocus, onSave, onClear,
}: {
  row: ManagerFocusRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fetchTypes: (id: string) => Promise<FocusTypeCount[]>;
  previewFocus: (id: string, types: string[], keywords: string[]) => Promise<FocusPreview | null>;
  onSave: (input: ManagerFocusInput) => Promise<void>;
  onClear: (id: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [minPercent, setMinPercent] = useState(80);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [trackExits, setTrackExits] = useState(false);
  const [exitTarget, setExitTarget] = useState<string>('');
  const [minExitPercent, setMinExitPercent] = useState<string>('');
  const [types, setTypes] = useState<FocusTypeCount[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<FocusPreview | null>(null);

  useEffect(() => {
    if (!row || !open) return;
    setLabel(row.focus_label || '');
    setMinPercent(row.min_percent ?? 80);
    setSelected(new Set(row.activity_type_keys || []));
    setKeywords(row.focus_keywords || []);
    setKeywordDraft('');
    setTrackExits(row.track_process_exits);
    setExitTarget(row.exit_target != null ? String(row.exit_target) : '');
    setMinExitPercent(row.min_exit_percent != null ? String(row.min_exit_percent) : '');
    setPreview(null);
    setSearch('');
    setLoading(true);
    fetchTypes(row.manager_user_id)
      .then(setTypes)
      .catch(e => {
        console.error('[FocusConfigSheet] tipos:', e);
        toast.error('Não consegui carregar os tipos de atividade');
      })
      .finally(() => setLoading(false));
  }, [row, open, fetchTypes]);

  // A lista já vem ordenada por uso; o filtro é só de busca.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? types.filter(t => t.label.toLowerCase().includes(q)) : types;
  }, [types, search]);

  const toggle = useCallback((tipo: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(tipo)) next.delete(tipo); else next.add(tipo);
      return next;
    });
  }, []);

  const addKeyword = useCallback((raw: string) => {
    const k = raw.trim().toLowerCase();
    if (!k) return;
    setKeywords(prev => (prev.includes(k) ? prev : [...prev, k]));
    setKeywordDraft('');
  }, []);

  // Prévia no servidor (mesma regra da conta oficial) — sem isso, escolher
  // palavra-chave é às cegas. Debounce curto porque cada tecla mudaria a conta.
  useEffect(() => {
    if (!row || !open) return;
    const types_ = Array.from(selected);
    if (!types_.length && !keywords.length) { setPreview(null); return; }
    const id = setTimeout(() => {
      previewFocus(row.manager_user_id, types_, keywords)
        .then(setPreview)
        .catch(e => console.warn('[FocusConfigSheet] prévia:', e));
    }, 400);
    return () => clearTimeout(id);
  }, [row, open, selected, keywords, previewFocus]);

  const handleSave = async () => {
    if (!row) return;
    if (!label.trim()) { toast.error('Dê um nome à área de foco (ex: Vendas)'); return; }
    if (selected.size === 0 && keywords.length === 0) {
      toast.error('Escolha ao menos um tipo ou uma palavra do assunto');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        manager_user_id: row.manager_user_id,
        manager_name: row.nome,
        focus_label: label.trim(),
        min_percent: minPercent,
        activity_type_keys: Array.from(selected),
        focus_keywords: keywords,
        track_process_exits: trackExits,
        exit_target: exitTarget.trim() === '' ? null : Math.max(0, Number(exitTarget) || 0),
        min_exit_percent: minExitPercent.trim() === ''
          ? null
          : Math.min(100, Math.max(0, Number(minExitPercent) || 0)),
      });
      toast.success(`Foco de ${row.nome || 'gerente'}: ${label.trim()} · mínimo ${minPercent}%`);
      onOpenChange(false);
    } catch (e) {
      console.error('[FocusConfigSheet] salvar:', e);
      toast.error('Erro ao salvar o foco');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle>Foco de {row?.nome || 'gerente'}</SheetTitle>
          <SheetDescription>
            A porcentagem é medida sobre as atividades concluídas: as dos tipos
            marcados aqui contam como foco, o resto conta contra.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="focus-label">Área de foco</Label>
              <Input
                id="focus-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Vendas, Processual…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="focus-min">Mínimo (%)</Label>
              <Input
                id="focus-min"
                type="number"
                min={0}
                max={100}
                value={minPercent}
                onChange={e => setMinPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              />
            </div>
          </div>

          {/* Prévia: o efeito da configuração antes de salvar. */}
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">Como fica (últimos 60 dias)</p>
            {preview ? (
              <>
                <p className="mt-1 text-sm">
                  <strong className="text-lg tabular-nums">{preview.pct ?? 0}%</strong>{' '}
                  — {preview.no_foco} de {preview.concluidas} atividades na área.
                </p>
                {preview.resgatadas_pelo_texto > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {preview.so_por_tipo} vieram pelo tipo e{' '}
                    <strong>{preview.resgatadas_pelo_texto} só foram achadas pelo assunto</strong>{' '}
                    — o tipo delas estava errado.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Marque tipos ou adicione palavras para ver o efeito.
              </p>
            )}
          </div>

          {/* Palavras do assunto — vencem o tipo errado. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="focus-kw">Palavras no assunto / contexto</Label>
              {KEYWORD_SUGGESTIONS[label.trim().toLowerCase()] && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    const sug = KEYWORD_SUGGESTIONS[label.trim().toLowerCase()] || [];
                    setKeywords(prev => [...new Set([...prev, ...sug])]);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  sugestões de {label.trim().toLowerCase()}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A atividade conta como foco se o tipo estiver marcado <em>ou</em> se
              alguma destas palavras aparecer no assunto, na descrição, no que foi
              feito, no próximo passo ou no processo vinculado. Sem acento e sem
              caixa — "audiencia" acha "AUDIÊNCIA".
            </p>
            <div className="flex gap-2">
              <Input
                id="focus-kw"
                value={keywordDraft}
                onChange={e => setKeywordDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addKeyword(keywordDraft);
                  }
                }}
                placeholder="acordo, audiência, sentença…"
              />
              <Button type="button" variant="outline" onClick={() => addKeyword(keywordDraft)}>
                Adicionar
              </Button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {keywords.map(k => (
                  <Badge key={k} variant="secondary" className="gap-1 font-normal">
                    {k}
                    <button
                      type="button"
                      onClick={() => setKeywords(prev => prev.filter(x => x !== k))}
                      className="hover:text-destructive"
                      aria-label={`Remover ${k}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tipos que contam como foco</Label>
              <span className="text-xs text-muted-foreground">
                opcional — o assunto já cobre boa parte
              </span>
            </div>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar tipo…"
            />
            <ScrollArea className="h-64 rounded-md border">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : visible.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4">
                  Nenhuma atividade concluída nos últimos 90 dias.
                </p>
              ) : (
                <div className="p-1">
                  {visible.map(t => (
                    <label
                      key={t.tipo}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted/60 cursor-pointer"
                    >
                      <Checkbox
                        checked={selected.has(t.tipo)}
                        onCheckedChange={() => toggle(t.tipo)}
                      />
                      <span className="flex-1 text-sm truncate">{t.label}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{t.n}</span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="focus-exits" className="cursor-pointer">Cobrar entrada e saída de processo</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Conta os processos da carteira que entraram (petição inicial) e
                  os que saíram por acordo ou execução (cumprimento de sentença,
                  precatório/RPV, pagamento), com a vazão entre as duas pontas.
                </p>
              </div>
              <Switch id="focus-exits" checked={trackExits} onCheckedChange={setTrackExits} />
            </div>
            {trackExits && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="focus-exit-target">Meta de saídas (opcional)</Label>
                  <Input
                    id="focus-exit-target"
                    type="number"
                    min={0}
                    value={exitTarget}
                    onChange={e => setExitTarget(e.target.value)}
                    placeholder="sem meta"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="focus-exit-pct">Piso da carteira (%)</Label>
                  <Input
                    id="focus-exit-pct"
                    type="number"
                    min={0}
                    max={100}
                    value={minExitPercent}
                    onChange={e => setMinExitPercent(e.target.value)}
                    placeholder="sem piso"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t pt-4">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
          {row?.configurado && (
            <Button
              variant="outline"
              disabled={saving}
              onClick={async () => {
                if (!row) return;
                setSaving(true);
                try {
                  await onClear(row.manager_user_id);
                  toast.success('Foco removido');
                  onOpenChange(false);
                } catch (e) {
                  console.error('[FocusConfigSheet] limpar:', e);
                  toast.error('Erro ao remover');
                } finally {
                  setSaving(false);
                }
              }}
            >
              Remover
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ManagerFocusPanel() {
  const [period, setPeriod] = useState<FocusPeriod>('mes');
  const { rows, loading, error, refetch, fetchTypes, previewFocus, saveFocus, clearFocus } = useManagerFocus(period);
  const [editing, setEditing] = useState<ManagerFocusRow | null>(null);

  // Quem está abaixo do piso vem primeiro — é o que a reunião precisa ver.
  const ordered = useMemo(() => {
    const rank = (r: ManagerFocusRow) => {
      if (!r.configurado) return 2;
      if (r.atingiu === false) return 0;
      return 1;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b) || (a.nome || '').localeCompare(b.nome || ''));
  }, [rows]);

  const abaixo = useMemo(() => ordered.filter(r => r.atingiu === false).length, [ordered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            Foco dos Gerentes
          </h2>
          <p className="text-sm text-muted-foreground">
            Quanto do esforço de cada gerente ficou na área dele — e, na carteira,
            quantos processos saíram por acordo ou execução.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {abaixo > 0 && (
            <Badge variant="outline" className="text-red-600 border-red-300">
              {abaixo} abaixo do piso
            </Badge>
          )}
          <Select value={period} onValueChange={v => setPeriod(v as FocusPeriod)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map(p => (
                <SelectItem key={p} value={p}>{PERIOD_LABEL[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={refetch} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : ordered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum gerente cadastrado. Defina o gestor de um time na aba Times.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {ordered.map(row => (
            <ManagerCard key={row.manager_user_id} row={row} onConfigure={setEditing} />
          ))}
        </div>
      )}

      <FocusConfigSheet
        row={editing}
        open={!!editing}
        onOpenChange={v => { if (!v) setEditing(null); }}
        fetchTypes={fetchTypes}
        previewFocus={previewFocus}
        onSave={saveFocus}
        onClear={clearFocus}
      />
    </div>
  );
}

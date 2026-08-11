import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Building2,
  Briefcase,
  Loader2,
  Map,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Tag,
  Users2,
  X,
} from 'lucide-react';
import {
  NONE_KEY,
  PAGE_SIZE,
  useClassificationReport,
  type ClassificationContact,
  type FacetKey,
  type FacetRow,
  type ReportFilters,
} from '@/hooks/useClassificationContacts';
import { classificationLabel } from '@/hooks/useContactClassifications';

// A conversa é das telas mais pesadas do sistema — só carrega quando alguém
// clica em WhatsApp.
const DashboardChatPreview = lazy(() =>
  import('@/components/whatsapp/DashboardChatPreview').then(m => ({ default: m.DashboardChatPreview }))
);

interface ClassificationContactsSheetProps {
  /** Slug do status (contacts.classifications). `null` mantém o painel fechado. */
  classification: string | null;
  color?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FACETS: { key: FacetKey; title: string; icon: React.ElementType }[] = [
  { key: 'state', title: 'Estado', icon: Map },
  { key: 'city', title: 'Cidade', icon: Building2 },
  { key: 'neighborhood', title: 'Bairro', icon: MapPin },
  { key: 'profession', title: 'Profissão', icon: Briefcase },
];

const INITIAL_FACET_ROWS = 6;

/**
 * Identidade da conversa no banco: só dígitos, com DDI. Era um link `wa.me`,
 * que jogava a pessoa para fora do sistema e para o WhatsApp Web — sem
 * histórico da equipe, sem IA, sem virar atividade. Aqui abre a conversa de
 * dentro, com tudo isso.
 */
function chatPhone(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 11) digits = `55${digits}`;
  return digits;
}

/** Painel lateral: contatos de um relacionamento + detalhamento por cidade/estado/bairro/profissão. */
export function ClassificationContactsSheet({
  classification,
  color,
  open,
  onOpenChange,
}: ClassificationContactsSheetProps) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Partial<Record<FacetKey, string | null>>>({});
  const [expanded, setExpanded] = useState<Partial<Record<FacetKey, boolean>>>({});
  const [page, setPage] = useState(0);
  /** Conversa aberta por cima do painel (sobe de baixo, com todas as funções). */
  const [chat, setChat] = useState<{ phone: string; name: string } | null>(null);

  // Busca só vai ao banco depois que o usuário para de digitar.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters: ReportFilters = useMemo(() => ({
    state: selected.state !== undefined ? (selected.state ?? NONE_KEY) : null,
    city: selected.city !== undefined ? (selected.city ?? NONE_KEY) : null,
    neighborhood: selected.neighborhood !== undefined ? (selected.neighborhood ?? NONE_KEY) : null,
    profession: selected.profession !== undefined ? (selected.profession ?? NONE_KEY) : null,
    search,
  }), [selected, search]);

  const { report, loading, error } = useClassificationReport(
    open ? classification : null,
    filters,
    page,
  );

  const activeFilters = (Object.keys(selected) as FacetKey[]).filter(k => selected[k] !== undefined);
  const hasFilters = activeFilters.length > 0 || search.trim() !== '';

  const toggleFacet = (key: FacetKey, value: string | null) => {
    setSelected(prev => {
      const next = { ...prev };
      const current = next[key];
      if (current !== undefined && current === value) delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(0);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setSearchInput('');
      setSearch('');
      setSelected({});
      setExpanded({});
      setPage(0);
    }
    onOpenChange(v);
  };

  const label = classification ? classificationLabel(classification) : '';
  const badgeColor = color && color.startsWith('bg-') ? color : 'bg-slate-500';

  const facetLabel = (row: FacetRow) => row.label || 'Sem informação';

  const renderFacet = (facet: { key: FacetKey; title: string; icon: React.ElementType }) => {
    const Icon = facet.icon;
    const all = report.facets[facet.key] || [];
    const isExpanded = expanded[facet.key];
    const rows = isExpanded ? all : all.slice(0, INITIAL_FACET_ROWS);
    return (
      <div key={facet.key} className="rounded-lg border bg-card p-3 min-w-0">
        <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{facet.title}</span>
          <span className="ml-auto shrink-0 tabular-nums">{all.length}</span>
        </div>
        {all.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nada a mostrar</p>
        ) : (
          <div className="space-y-1">
            {rows.map((row) => {
              const active = selected[facet.key] !== undefined && selected[facet.key] === row.key;
              return (
                <button
                  key={`${facet.key}-${row.key ?? NONE_KEY}`}
                  type="button"
                  onClick={() => toggleFacet(facet.key, row.key)}
                  className={`w-full flex items-center gap-2 rounded px-2 py-1 text-xs text-left transition-colors ${
                    active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/60'
                  }`}
                >
                  <span className={`truncate min-w-0 ${row.key === null ? 'italic text-muted-foreground' : ''}`}>
                    {facetLabel(row)}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{row.count}</span>
                </button>
              );
            })}
            {all.length > INITIAL_FACET_ROWS && (
              <button
                type="button"
                className="text-xs text-primary hover:underline px-2 pt-1"
                onClick={() => setExpanded(prev => ({ ...prev, [facet.key]: !prev[facet.key] }))}
              >
                {isExpanded ? 'Ver menos' : `Ver todos (${all.length})`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderContact = (c: ClassificationContact) => {
    const digits = chatPhone(c.phone);
    const place = [c.neighborhood, c.city, c.state].filter(Boolean).join(' · ');
    return (
      <div key={c.id} className="rounded-lg border bg-card p-3 space-y-1.5 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-sm leading-tight break-words min-w-0">
            {c.full_name || 'Sem nome'}
          </span>
          {digits && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0 gap-1"
              onClick={() => setChat({ phone: digits, name: c.full_name || 'Sem nome' })}
            >
              <MessageCircle className="h-3 w-3 text-green-600" />
              WhatsApp
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {c.phone && (
            <span className="flex items-center gap-1 min-w-0">
              <Phone className="h-3 w-3 shrink-0" /><span className="truncate">{c.phone}</span>
            </span>
          )}
          {place && (
            <span className="flex items-center gap-1 min-w-0">
              <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{place}</span>
            </span>
          )}
          {c.profession && (
            <span className="flex items-center gap-1 min-w-0">
              <Briefcase className="h-3 w-3 shrink-0" /><span className="truncate">{c.profession}</span>
            </span>
          )}
        </div>
      </div>
    );
  };

  const from = report.filtered === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, report.filtered);
  const lastPage = Math.max(0, Math.ceil(report.filtered / PAGE_SIZE) - 1);

  return (
    <>
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0">
        <SheetHeader className="p-4 pb-3 border-b space-y-2 text-left shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base pr-8">
            <Users2 className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">Relacionamento Conosco</span>
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap">
            <Badge className={`${badgeColor} text-white text-xs`}>
              <Tag className="h-3 w-3 mr-1" />
              {label}
            </Badge>
            <span className="text-sm">
              {loading && report.total === 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> carregando…
                </span>
              ) : (
                <>
                  <strong className="text-foreground tabular-nums">{report.filtered}</strong>
                  {hasFilters && report.filtered !== report.total && (
                    <span className="text-muted-foreground"> de {report.total}</span>
                  )}
                  <span className="text-muted-foreground">
                    {' '}contato{report.filtered === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 pb-2 space-y-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por nome, telefone, cidade, profissão..."
              className="h-9 pl-8 text-sm"
            />
          </div>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFilters.map((k) => {
                const key = selected[k] as string | null;
                const title = FACETS.find(f => f.key === k)?.title || k;
                const row = (report.facets[k] || []).find(r => r.key === key);
                return (
                  <Badge key={k} variant="secondary" className="text-xs gap-1 max-w-full">
                    <span className="truncate">
                      {title}: {key === null ? 'sem informação' : (row?.label || key)}
                    </span>
                    <button type="button" onClick={() => toggleFacet(k, key)} className="shrink-0">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => { setSelected({}); setPage(0); }}
              >
                Limpar
              </Button>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 pt-0 space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}

            {loading && report.total === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : report.total === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhum contato com esse relacionamento.
              </p>
            ) : (
              <>
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${loading ? 'opacity-60' : ''}`}>
                  {FACETS.map(renderFacet)}
                </div>

                <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`}>
                  {report.filtered === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Nenhum contato com esses filtros.
                    </p>
                  ) : (
                    <>
                      {report.contacts.map(renderContact)}

                      {report.filtered > PAGE_SIZE && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={page === 0 || loading}
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                          >
                            Anterior
                          </Button>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {from}–{to} de {report.filtered}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= lastPage || loading}
                            onClick={() => setPage(p => p + 1)}
                          >
                            Próxima
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>

    {/* Conversa por cima do painel: sobe de baixo e traz tudo — histórico da
        equipe, resposta com IA, virar atividade. O painel continua atrás. */}
    {chat && (
      <Suspense fallback={null}>
        <DashboardChatPreview
          open={!!chat}
          onOpenChange={(v) => { if (!v) setChat(null); }}
          phone={chat.phone}
          contactName={chat.name}
          instanceName={null}
          hasLead={false}
          hasContact={true}
          wasResponded={false}
          responseTimeMinutes={null}
        />
      </Suspense>
    )}
    </>
  );
}

export default ClassificationContactsSheet;

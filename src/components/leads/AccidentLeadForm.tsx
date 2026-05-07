import React, { useMemo, useState, useRef } from 'react';
import { useLeadSources } from '@/hooks/useLeadSources';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Sparkles, User, MapPin, Building, FileText, Briefcase, Wand2, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useGeolocation } from '@/hooks/useGeolocation';
import { toast } from 'sonner';
import { LEAD_FIELD_REGISTRY, TAB_DEFS, type LeadFieldRenderCtx, type LeadFieldTab } from './leadFormFields';
import { useLeadFieldLayout, type ResolvedField } from '@/hooks/useLeadFieldLayout';
import { FieldCustomizeOverlay } from './FieldCustomizeOverlay';
import { cn } from '@/lib/utils';
import type { AccidentLeadFormData } from './leadFormTypes';

export type { AccidentLeadFormData } from './leadFormTypes';

interface AccidentLeadFormProps {
  formData: AccidentLeadFormData;
  onChange: (data: Partial<AccidentLeadFormData>) => void;
  onOpenExtractor: () => void;
  teamMembers?: { id: string; full_name: string | null; email: string | null }[];
  classifications?: { id: string; name: string; color: string }[];
  boardId?: string | null;
  boardName?: string;
}

const stateToRegion: Record<string, string> = {
  'AC': 'Norte', 'AP': 'Norte', 'AM': 'Norte', 'PA': 'Norte', 'RO': 'Norte', 'RR': 'Norte', 'TO': 'Norte',
  'AL': 'Nordeste', 'BA': 'Nordeste', 'CE': 'Nordeste', 'MA': 'Nordeste', 'PB': 'Nordeste', 'PE': 'Nordeste', 'PI': 'Nordeste', 'RN': 'Nordeste', 'SE': 'Nordeste',
  'DF': 'Centro-Oeste', 'GO': 'Centro-Oeste', 'MT': 'Centro-Oeste', 'MS': 'Centro-Oeste',
  'ES': 'Sudeste', 'MG': 'Sudeste', 'RJ': 'Sudeste', 'SP': 'Sudeste',
  'PR': 'Sul', 'RS': 'Sul', 'SC': 'Sul',
};

const TAB_ICONS: Record<LeadFieldTab, React.ComponentType<{ className?: string }>> = {
  basic: User, accident: FileText, location: MapPin, companies: Building, legal: Briefcase,
};

export function AccidentLeadForm({ formData, onChange, onOpenExtractor, teamMembers = [], classifications = [], boardId, boardName }: AccidentLeadFormProps) {
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { sources: leadSources } = useLeadSources();
  const { loading: geoLoading, fetchLocation } = useGeolocation();
  const { resolved, fieldsByTab, saveLayout } = useLeadFieldLayout(boardId);
  const [personalizeMode, setPersonalizeMode] = useState(false);
  const [activeTab, setActiveTab] = useState<LeadFieldTab>('basic');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const tabSwitchTimer = useRef<number | null>(null);

  const handleAutoLocation = async () => {
    const loc = await fetchLocation();
    if (loc) {
      const region = stateToRegion[loc.state] || '';
      onChange({ visit_state: loc.state, visit_city: loc.city, visit_region: region });
      fetchCities(loc.state);
      toast.success(`Localização detectada: ${loc.city}/${loc.state}`);
    } else {
      toast.error('Não foi possível detectar a localização');
    }
  };

  const handleStateChange = (state: string) => {
    const region = stateToRegion[state] || '';
    onChange({ visit_state: state, visit_region: region, visit_city: '' });
    fetchCities(state);
  };

  const formatDateBR = (dateStr: string) => {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    }
    return dateStr;
  };

  const parseDateBR = (input: string) => {
    const clean = input.replace(/\D/g, '');
    let formatted = '';
    if (clean.length <= 2) formatted = clean;
    else if (clean.length <= 4) formatted = clean.slice(0, 2) + '/' + clean.slice(2);
    else formatted = clean.slice(0, 2) + '/' + clean.slice(2, 4) + '/' + clean.slice(4, 8);
    if (clean.length === 8) {
      const day = clean.slice(0, 2);
      const month = clean.slice(2, 4);
      const year = clean.slice(4, 8);
      const iso = `${year}-${month}-${day}`;
      const dateObj = new Date(iso + 'T00:00:00');
      if (!isNaN(dateObj.getTime()) && dateObj.getDate() === parseInt(day) && (dateObj.getMonth() + 1) === parseInt(month)) {
        return { display: formatted, iso };
      }
      return { display: formatted, iso: '' };
    }
    return { display: formatted, iso: '' };
  };

  const ctx: LeadFieldRenderCtx = {
    formData, onChange, teamMembers, classifications, leadSources,
    states, cities, loadingCities, geoLoading,
    onAutoLocation: handleAutoLocation, onStateChange: handleStateChange,
    formatDateBR, parseDateBR,
  };

  const registryByKey = useMemo(() => {
    const m = new Map<string, typeof LEAD_FIELD_REGISTRY[number]>();
    LEAD_FIELD_REGISTRY.forEach(d => m.set(d.key, d));
    return m;
  }, []);

  // ===== Personalization handlers =====
  const moveField = (key: string, targetTab: LeadFieldTab, targetOrder?: number) => {
    if (!boardId) { toast.error('Selecione um funil'); return; }
    const next: ResolvedField[] = resolved.map(f => ({ ...f }));
    const moving = next.find(f => f.field_key === key);
    if (!moving) return;
    const oldTab = moving.tab;
    moving.tab = targetTab;
    moving.display_order = targetOrder ?? 9999;
    // Renumber both tabs
    const renum = (tab: LeadFieldTab) => {
      next.filter(f => f.tab === tab).sort((a, b) => a.display_order - b.display_order)
        .forEach((f, i) => { f.display_order = i + 1; });
    };
    renum(oldTab);
    if (oldTab !== targetTab) renum(targetTab);
    saveLayout(next);
  };

  const toggleHide = (key: string) => {
    if (!boardId) return;
    const next: ResolvedField[] = resolved.map(f =>
      f.field_key === key ? { ...f, hidden: !f.hidden } : { ...f }
    );
    saveLayout(next);
  };

  const onTabDragOver = (tab: LeadFieldTab) => (e: React.DragEvent) => {
    if (!personalizeMode || !draggingKey) return;
    e.preventDefault();
    if (activeTab !== tab) {
      if (tabSwitchTimer.current) window.clearTimeout(tabSwitchTimer.current);
      tabSwitchTimer.current = window.setTimeout(() => setActiveTab(tab), 250);
    }
  };

  const onTabDrop = (tab: LeadFieldTab) => (e: React.DragEvent) => {
    if (!personalizeMode || !draggingKey) return;
    e.preventDefault();
    moveField(draggingKey, tab);
    setDraggingKey(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button" variant="outline" onClick={onOpenExtractor}
          className="flex-1 gap-2 border-dashed border-primary/50 hover:border-primary"
        >
          <Sparkles className="h-4 w-4 text-primary" />
          Extrair dados de notícia ou documento com IA
        </Button>
        {boardId && (
          <Button
            type="button"
            variant={personalizeMode ? 'default' : 'outline'}
            onClick={() => setPersonalizeMode(p => !p)}
            className="gap-2"
            title="Personalizar campos deste funil"
          >
            {personalizeMode ? <Check className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
            {personalizeMode ? 'Concluir' : 'Personalizar'}
          </Button>
        )}
      </div>

      {personalizeMode && (
        <div className="text-xs text-muted-foreground bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
          Modo personalização ativo · arraste pela <b>alça</b> para mover entre abas, clique no <b>olho</b> para ocultar deste funil ou no <b>lápis</b> para editar.
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LeadFieldTab)} className="w-full">
        <TabsList className="grid w-full grid-cols-5 h-auto">
          {TAB_DEFS.map(t => {
            const Icon = TAB_ICONS[t.key];
            return (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className={cn(
                  'text-xs py-2',
                  personalizeMode && draggingKey && 'ring-2 ring-primary/40 ring-offset-1'
                )}
                onDragOver={onTabDragOver(t.key)}
                onDrop={onTabDrop(t.key)}
              >
                <Icon className="h-3 w-3 mr-1" />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {TAB_DEFS.map(t => {
          // In personalize mode, also show hidden fields (with reduced opacity)
          const items = personalizeMode
            ? resolved.filter(f => f.tab === t.key).sort((a, b) => a.display_order - b.display_order)
            : fieldsByTab(t.key);
          return (
            <TabsContent
              key={t.key}
              value={t.key}
              className="space-y-4 mt-4"
              onDragOver={(e) => personalizeMode && draggingKey && e.preventDefault()}
              onDrop={(e) => { if (personalizeMode && draggingKey) { e.preventDefault(); moveField(draggingKey, t.key); setDraggingKey(null); } }}
            >
              <div className="grid grid-cols-2 gap-4">
                {items.map((f, idx) => {
                  const def = registryByKey.get(f.field_key);
                  if (!def) return null;
                  const node = def.render(ctx);
                  if (node === null && !personalizeMode) return null;
                  const content = node ?? (
                    <div className="text-xs text-muted-foreground italic border border-dashed rounded p-2">
                      {def.label} <span className="opacity-60">(condicional)</span>
                    </div>
                  );
                  const wrapperClass = def.fullWidth ? 'col-span-2' : '';
                  if (!personalizeMode) {
                    return <div key={f.field_key} className={wrapperClass}>{content}</div>;
                  }
                  return (
                    <div key={f.field_key} className={wrapperClass}>
                      <FieldCustomizeOverlay
                        fieldKey={f.field_key}
                        hidden={f.hidden}
                        isDragging={draggingKey === f.field_key}
                        onEdit={() => setEditingKey(f.field_key)}
                        onToggleHide={() => toggleHide(f.field_key)}
                        onDragStart={(e) => {
                          setDraggingKey(f.field_key);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', f.field_key);
                        }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          if (!draggingKey || draggingKey === f.field_key) return;
                          moveField(draggingKey, t.key, f.display_order);
                          setDraggingKey(null);
                        }}
                      >
                        {content}
                      </FieldCustomizeOverlay>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="col-span-2 text-center text-xs text-muted-foreground italic py-6">
                    Nenhum campo nesta aba. {personalizeMode && 'Arraste um campo de outra aba para cá.'}
                  </div>
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Edit dialog (light, info-only for fixed fields) */}
      <Dialog open={!!editingKey} onOpenChange={(v) => !v && setEditingKey(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar campo</DialogTitle>
          </DialogHeader>
          {editingKey && (() => {
            const def = registryByKey.get(editingKey);
            const r = resolved.find(f => f.field_key === editingKey);
            if (!def || !r) return null;
            return (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Rótulo</Label>
                  <Input value={def.label} disabled className="mt-1" />
                  <p className="text-[10px] text-muted-foreground mt-1">Campo fixo do sistema — rótulo não editável.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Aba</Label>
                    <select
                      className="mt-1 w-full h-9 text-sm border rounded-md px-2 bg-background"
                      value={r.tab}
                      onChange={(e) => moveField(editingKey, e.target.value as LeadFieldTab)}
                    >
                      {TAB_DEFS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Ordem</Label>
                    <Input
                      type="number" min={1}
                      value={r.display_order}
                      onChange={(e) => {
                        const v = parseInt(e.target.value || '1', 10);
                        const next = resolved.map(f => f.field_key === editingKey ? { ...f, display_order: v } : { ...f });
                        saveLayout(next);
                      }}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-xs text-muted-foreground">Visível neste funil</span>
                  <Button size="sm" variant={r.hidden ? 'outline' : 'default'} onClick={() => toggleHide(editingKey)}>
                    {r.hidden ? 'Ocultado' : 'Visível'}
                  </Button>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button onClick={() => setEditingKey(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

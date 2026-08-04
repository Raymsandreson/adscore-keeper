import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { ensureRemapCache, remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { useProfilesList } from '@/hooks/useProfilesList';
import { MapPin, Phone, Instagram, Briefcase, Users2, Megaphone, MapPinOff } from 'lucide-react';
import type { ActivityDraft } from '@/components/activities/ActivityFullSheet';

const ActivityFullSheet = lazy(() => import('@/components/activities/ActivityFullSheet').then(m => ({ default: m.ActivityFullSheet })));

interface CityContact {
  id: string;
  full_name: string;
  phone: string | null;
  instagram_username: string | null;
  classification: string | null;
  classifications: string[] | null;
  profession: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export interface CitySuggestTrigger {
  city: string;
  state: string;
  /** CEP da visita — vira a âncora de segmentação do anúncio do Marketing. */
  cep?: string;
  address?: string;
  region?: string;
  /** Resumo do caso mandado pro Marketing (tipo, empresa, setor, data...). */
  details?: { label: string; value: string }[];
}

interface CityContactsSuggestionDialogProps {
  trigger: CitySuggestTrigger | null;
  onClose: () => void;
  /** Contexto do lead (fluxo de edição). Ausente na criação (lead ainda não existe). */
  leadId?: string | null;
  leadName?: string | null;
  /** Devolve pro formulário do lead o CEP digitado aqui quando o lead ainda não tinha. */
  onCepChange?: (cep: string) => void;
}

type TeamPerson = { user_id: string; full_name: string };

function formatCep(raw: string): string {
  const d = (raw || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

function cepDigits(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

const UNCLASSIFIED = '__none__';
const ALL_TAB = '__all__';

function waLink(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
}

export function CityContactsSuggestionDialog({ trigger, onClose, leadId, leadName, onCepChange }: CityContactsSuggestionDialogProps) {
  const { classificationConfig } = useContactClassifications();
  const profiles = useProfilesList();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'contacts' | 'empty'>('contacts');
  const [contacts, setContacts] = useState<CityContact[]>([]);
  const [cityLabel, setCityLabel] = useState('');
  const [pending, setPending] = useState<CitySuggestTrigger | null>(null);
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);
  const [cepInput, setCepInput] = useState('');
  const [marketing, setMarketing] = useState<{ assignee: TeamPerson | null; observers: TeamPerson[] }>({ assignee: null, observers: [] });

  useEffect(() => {
    if (!trigger?.city || !trigger?.state) return;

    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        // RPC normaliza cidade dos dois lados (acento/hífen/espaço/caixa) porque
        // contacts.city vem gravado em formatos inconsistentes (ex: "Itapecuru-Mirim",
        // "Itapecuru mirim") enquanto o lead usa o nome IBGE ("Itapecuru Mirim").
        const { data, error } = await (db as any)
          .rpc('contacts_in_normalized_city', { p_city: trigger.city, p_state: trigger.state });
        if (cancelled) return;
        if (error) throw error;
        const rows = ((data || []) as CityContact[])
          .slice()
          .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
        setCityLabel(`${trigger.city}/${trigger.state}`);
        setPending(trigger);
        setCepInput(formatCep(trigger.cep || ''));
        if (rows.length > 0) {
          setContacts(rows);
          setActiveTab(ALL_TAB);
          setMode('contacts');
        } else {
          setContacts([]);
          setMode('empty');
        }
        setOpen(true);
      } catch (e) {
        console.error('Erro ao buscar contatos da cidade:', e);
        if (!cancelled) onClose();
      }
    })();

    return () => { cancelled = true; };
  }, [trigger, onClose]);

  const nameOf = useCallback((userId: string) => {
    const p = profiles.find(x => x.user_id === userId);
    return p?.full_name || p?.email || 'Marketing';
  }, [profiles]);

  // Time do Marketing. O espelho no Externo guarda os ids misturados (uns do
  // Cloud, outros do Externo) — normaliza tudo pra Cloud, que é o UUID usado
  // pelo seletor de assessor da atividade (profiles do Cloud).
  useEffect(() => {
    if (!open || mode !== 'empty') return;
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data: teamRows } = await (db as any).from('teams').select('id, name');
        const team = ((teamRows || []) as any[]).find(t => /marketing/i.test(t.name || ''));
        if (!team || cancelled) return;
        const [{ data: mem }, { data: mgr }] = await Promise.all([
          (db as any).from('team_members').select('user_id').eq('team_id', team.id),
          (db as any).from('team_managers').select('manager_user_id').eq('team_id', team.id),
        ]);
        await ensureRemapCache();
        if (cancelled) return;
        const toCloud = (id: string | null | undefined) => (id ? (remapToCloudSync(id) || id) : null);
        const memberIds = Array.from(new Set(((mem || []) as any[]).map(r => toCloud(r.user_id)).filter(Boolean))) as string[];
        const managerIds = Array.from(new Set(((mgr || []) as any[]).map(r => toCloud(r.manager_user_id)).filter(Boolean))) as string[];
        const assigneeId = memberIds[0] || managerIds[0] || null;
        const observerIds = Array.from(new Set([...managerIds, ...memberIds])).filter(id => id !== assigneeId);
        setMarketing({
          assignee: assigneeId ? { user_id: assigneeId, full_name: nameOf(assigneeId) } : null,
          observers: observerIds.map(id => ({ user_id: id, full_name: nameOf(id) })),
        });
      } catch (e) {
        console.warn('[CityContactsSuggestion] time de Marketing não carregou:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [open, mode, nameOf]);

  const effectiveCep = formatCep(cepInput || pending?.cep || '');
  const cepOk = cepDigits(effectiveCep).length === 8;

  const marketingDraft: ActivityDraft = useMemo(() => {
    const local = pending ? `${pending.city}/${pending.state}` : '';
    const lines: string[] = [];
    if (local) lines.push(`Anúncio para captar parceiros, correspondentes ou indicadores em ${local}.`);
    if (effectiveCep) lines.push(`CEP de referência para o anúncio: ${effectiveCep} — segmentar a partir desse CEP.`);
    if (pending?.address) lines.push(`Endereço da visita: ${pending.address}`);
    if (pending?.region) lines.push(`Região: ${pending.region}`);
    lines.push('');
    lines.push(`Motivo: não temos nenhum contato cadastrado${local ? ` em ${local}` : ' nesta cidade'} — nenhum parceiro, correspondente ou indicador para acionar.`);
    if (leadName) lines.push(`Caso: ${leadName}`);
    (pending?.details || []).forEach(d => {
      if (d.value) lines.push(`${d.label}: ${d.value}`);
    });
    return {
      title: local ? `Marketing: buscar parceiros em ${local}` : 'Marketing: buscar parceiros',
      activity_type: 'tarefa',
      priority: 'normal',
      notes: lines.join('\n'),
      lead_id: leadId || undefined,
      lead_name: leadName || undefined,
      assigned_to: marketing.assignee?.user_id,
      assigned_to_name: marketing.assignee?.full_name,
      observers: marketing.observers,
      // Tarefa interna do Marketing: não existe POP jurídico pra ela, então entra
      // como atividade de gestão (dispensa POP e o vínculo obrigatório).
      is_management: true,
    };
  }, [pending, leadId, leadName, effectiveCep, marketing]);

  // Agrupa por relacionamento (classifications[]), com fallback pro campo legado e "Sem classificação"
  const groups = useMemo(() => {
    const map = new Map<string, CityContact[]>();
    for (const c of contacts) {
      const keys = (c.classifications && c.classifications.length > 0)
        ? c.classifications
        : (c.classification ? [c.classification] : [UNCLASSIFIED]);
      for (const k of keys) {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(c);
      }
    }
    return map;
  }, [contacts]);

  const labelFor = useCallback((key: string) => {
    if (key === UNCLASSIFIED) return 'Sem classificação';
    return classificationConfig[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }, [classificationConfig]);

  const colorFor = useCallback((key: string) => {
    if (key === UNCLASSIFIED) return 'bg-slate-400';
    return classificationConfig[key]?.color || 'bg-slate-400';
  }, [classificationConfig]);

  const tabs = useMemo(() => {
    return Array.from(groups.entries())
      .map(([key, list]) => ({ key, count: list.length }))
      .sort((a, b) => b.count - a.count);
  }, [groups]);

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setOpen(false);
      onClose();
    }
  };

  const renderCard = (c: CityContact) => {
    const rel = (c.classifications && c.classifications.length > 0)
      ? c.classifications
      : (c.classification ? [c.classification] : []);
    const wa = waLink(c.phone);
    return (
      <div key={c.id} className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-sm leading-tight break-words">{c.full_name}</span>
          {rel.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-end shrink-0">
              {rel.map(r => (
                <Badge key={r} variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                  <span className={`h-1.5 w-1.5 rounded-full ${colorFor(r)}`} />
                  {labelFor(r)}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {c.profession && (
            <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{c.profession}</span>
          )}
          {c.neighborhood && (
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.neighborhood}</span>
          )}
          {c.instagram_username && (
            <span className="flex items-center gap-1"><Instagram className="h-3 w-3" />@{c.instagram_username.replace(/^@/, '')}</span>
          )}
        </div>
        {c.phone && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</span>
            {wa && (
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const listFor = (tabKey: string): CityContact[] => {
    if (tabKey === ALL_TAB) return contacts;
    return groups.get(tabKey) || [];
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {mode === 'contacts' ? (
          <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Users2 className="h-4 w-4 text-primary" />
                Contatos nossos em {cityLabel}
              </DialogTitle>
              <DialogDescription>
                Já temos {contacts.length} {contacts.length === 1 ? 'contato' : 'contatos'} nesta cidade. Separados por relacionamento conosco.
              </DialogDescription>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
              <TabsList className="flex-shrink-0 flex w-full flex-wrap h-auto justify-start gap-1">
                <TabsTrigger value={ALL_TAB} className="text-xs">
                  Todos <span className="ml-1 opacity-60">{contacts.length}</span>
                </TabsTrigger>
                {tabs.map(t => (
                  <TabsTrigger key={t.key} value={t.key} className="text-xs">
                    {labelFor(t.key)} <span className="ml-1 opacity-60">{t.count}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={activeTab} className="flex-1 min-h-0 mt-3">
                <ScrollArea className="h-[45vh] pr-3">
                  <div className="space-y-2">
                    {listFor(activeTab).map(renderCard)}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </DialogContent>
        ) : (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <MapPinOff className="h-4 w-4 text-amber-500" />
                Nenhum contato em {cityLabel}
              </DialogTitle>
              <DialogDescription>
                Ainda não temos nenhum contato cadastrado nesta cidade. Quer registrar uma tarefa
                para o Marketing criar um anúncio buscando parceiros, correspondentes ou indicadores lá?
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">
                  CEP da visita <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={cepInput}
                  onChange={(e) => setCepInput(formatCep(e.target.value))}
                  placeholder="00000-000"
                  inputMode="numeric"
                  maxLength={9}
                  className="mt-1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {cepOk
                    ? 'O anúncio vai ser segmentado a partir deste CEP.'
                    : 'Sem o CEP o Marketing não consegue segmentar o anúncio na região certa.'}
                </p>
              </div>

              {marketing.assignee && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Vai para o time de Marketing — responsável <span className="font-medium text-foreground">{marketing.assignee.full_name}</span>
                  {marketing.observers.length > 0 && (
                    <> · acompanham: {marketing.observers.map(o => o.full_name).join(', ')}</>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Agora não
              </Button>
              <Button
                disabled={!cepOk}
                onClick={() => {
                  onCepChange?.(effectiveCep);
                  setOpen(false);
                  setActivitySheetOpen(true);
                }}
                className="gap-2"
              >
                <Megaphone className="h-4 w-4" />
                Registrar tarefa de marketing
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {activitySheetOpen && (
        <Suspense fallback={null}>
          <ActivityFullSheet
            open={activitySheetOpen}
            onOpenChange={setActivitySheetOpen}
            activityId={null}
            mode="create"
            draft={marketingDraft}
            leadId={leadId || undefined}
            leadName={leadName || undefined}
            onCreated={() => {
              setActivitySheetOpen(false);
              handleOpenChange(false);
            }}
          />
        </Suspense>
      )}
    </>
  );
}

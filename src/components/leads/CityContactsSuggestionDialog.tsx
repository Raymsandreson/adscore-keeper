import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { MapPin, Phone, Instagram, Briefcase, Users2 } from 'lucide-react';

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
}

interface CityContactsSuggestionDialogProps {
  trigger: CitySuggestTrigger | null;
  onClose: () => void;
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

export function CityContactsSuggestionDialog({ trigger, onClose }: CityContactsSuggestionDialogProps) {
  const { classificationConfig } = useContactClassifications();
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<CityContact[]>([]);
  const [cityLabel, setCityLabel] = useState('');
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    if (!trigger?.city || !trigger?.state) return;
    const key = `${trigger.city.trim().toLowerCase()}|${trigger.state.trim().toLowerCase()}`;
    if (key === lastKeyRef.current) return; // evita rebuscar a mesma cidade seguidamente
    lastKeyRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data, error } = await db
          .from('contacts')
          .select('id, full_name, phone, instagram_username, classification, classifications, profession, neighborhood, city, state')
          .eq('city', trigger.city)
          .eq('state', trigger.state)
          .is('deleted_at', null)
          .is('whatsapp_group_id', null)
          .order('full_name', { ascending: true })
          .limit(500);
        if (cancelled) return;
        if (error) throw error;
        const rows = (data || []) as CityContact[];
        if (rows.length > 0) {
          setContacts(rows);
          setCityLabel(`${trigger.city}/${trigger.state}`);
          setActiveTab(ALL_TAB);
          setOpen(true);
        } else {
          onClose();
        }
      } catch (e) {
        console.error('Erro ao buscar contatos da cidade:', e);
        if (!cancelled) onClose();
      }
    })();

    return () => { cancelled = true; };
  }, [trigger, onClose]);

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
    </Dialog>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useAmbassadors } from '@/hooks/useAmbassadors';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Plus, Search, Phone, Mail, MapPin,
  Loader2, Trash2, Users, Check
} from 'lucide-react';
import { toast } from 'sonner';

interface ContactOption {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  classification: string | null;
}

export function AmbassadorsList() {
  const {
    ambassadors, loading,
    markContactAsAmbassador, removeAmbassadorClassification
  } = useAmbassadors();

  const teamHook = useTeamMembers();
  const members = (teamHook as any).members || [];

  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return ambassadors;
    const s = search.toLowerCase();
    return ambassadors.filter(a =>
      a.full_name.toLowerCase().includes(s) ||
      a.phone?.includes(s) ||
      a.city?.toLowerCase().includes(s)
    );
  }, [ambassadors, search]);

  const ambassadorIds = useMemo(() => new Set(ambassadors.map(a => a.id)), [ambassadors]);

  // Fetch all contacts when picker opens
  const openPicker = async () => {
    setPickerOpen(true);
    setPickerSearch('');
    setLoadingContacts(true);
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, phone, email, city, state, classification')
      .order('full_name')
      .limit(500);
    setContacts(data || []);
    setLoadingContacts(false);
  };

  const filteredContacts = useMemo(() => {
    if (!pickerSearch) return contacts;
    const s = pickerSearch.toLowerCase();
    return contacts.filter(c =>
      c.full_name.toLowerCase().includes(s) ||
      c.phone?.includes(s) ||
      c.email?.toLowerCase().includes(s) ||
      c.classification?.toLowerCase().includes(s)
    );
  }, [contacts, pickerSearch]);

  const handleMarkAsAmbassador = async (contactId: string) => {
    setSaving(contactId);
    try {
      await markContactAsAmbassador(contactId);
      // Update local state
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, classification: 'embaixador' } : c));
    } catch {} finally {
      setSaving(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remover classificação de embaixador deste contato?')) return;
    await removeAmbassadorClassification(id);
  };

  const getMemberName = (userId: string) => {
    const m = members.find((m: any) => m.user_id === userId);
    return m?.full_name || m?.email || 'Desconhecido';
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar embaixador..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={openPicker} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Adicionar Embaixador
        </Button>
      </div>

      {/* List */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(amb => (
          <Card key={amb.id} className="relative">
            <CardContent className="pt-4 pb-3 px-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{amb.full_name}</p>
                  <Badge variant="outline" className="text-[10px] mt-0.5">Embaixador</Badge>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemove(amb.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {amb.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{amb.phone}</div>}
                {amb.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{amb.email}</div>}
                {(amb.city || amb.state) && <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{[amb.city, amb.state].filter(Boolean).join(', ')}</div>}
              </div>
              {amb.created_by && (
                <div className="pt-1 border-t">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Vinculado a: <span className="font-medium text-foreground">{getMemberName(amb.created_by)}</span>
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {search ? 'Nenhum embaixador encontrado.' : 'Nenhum embaixador cadastrado. Clique em "Adicionar Embaixador" para selecionar da lista de contatos.'}
          </CardContent>
        </Card>
      )}

      {/* Contact Picker Dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Selecionar Contato como Embaixador</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Busque e selecione um contato existente para marcá-lo como embaixador.
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, email, classificação..."
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {loadingContacts ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : filteredContacts.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">Nenhum contato encontrado.</p>
            ) : (
              filteredContacts.map(c => {
                const isAlready = ambassadorIds.has(c.id);
                return (
                  <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/50 border border-transparent hover:border-border">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{c.full_name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {c.phone && <span>{c.phone}</span>}
                        {c.email && <span>{c.email}</span>}
                      </div>
                      <div className="flex gap-1 mt-0.5">
                        {c.classification && (
                          <Badge variant="outline" className="text-[10px]">{c.classification}</Badge>
                        )}
                        {(c.city || c.state) && (
                          <span className="text-[10px] text-muted-foreground">{[c.city, c.state].filter(Boolean).join(', ')}</span>
                        )}
                      </div>
                    </div>
                    {isAlready ? (
                      <Badge className="bg-amber-100 text-amber-700 text-[10px] flex-shrink-0">
                        <Check className="h-3 w-3 mr-0.5" /> Embaixador
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0 text-xs"
                        disabled={saving === c.id}
                        onClick={() => handleMarkAsAmbassador(c.id)}
                      >
                        {saving === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Marcar'}
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

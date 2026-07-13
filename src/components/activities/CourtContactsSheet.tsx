import { useEffect, useMemo, useState } from 'react';
import { db, authClient } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Landmark, Search, Plus, Pencil, Trash2, Phone, Mail, MessageCircle, Copy, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface CourtContact {
  id: string;
  name: string;
  court_type: string | null;
  comarca: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const COURT_TYPES = [
  { value: 'vara', label: 'Vara' },
  { value: 'tribunal', label: 'Tribunal' },
  { value: 'secretaria', label: 'Secretaria' },
  { value: 'outro', label: 'Outro' },
];

const EMPTY_FORM = {
  name: '',
  court_type: 'vara',
  comarca: '',
  phone: '',
  whatsapp: '',
  email: '',
  notes: '',
};

// wa.me exige só dígitos com DDI; números BR de 10-11 dígitos ganham o 55.
const toWaLink = (raw: string) => {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
};

const copyText = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  } catch {
    toast.error('Não foi possível copiar.');
  }
};

// court_contacts ainda não está nos types gerados do Externo — cast único e controlado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const courtContactsTable = () => (db as any).from('court_contacts');

interface CourtContactsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CourtContactsSheet({ open, onOpenChange }: CourtContactsSheetProps) {
  const [contacts, setContacts] = useState<CourtContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null); // null = sem form; '' = novo
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await courtContactsTable()
        .select('*')
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      setContacts((data || []) as CourtContact[]);
    } catch (e) {
      console.error('[CourtContacts] load falhou', e);
      toast.error('Erro ao carregar contatos de varas/tribunais');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter((c) =>
      [c.name, c.comarca, c.phone, c.whatsapp, c.email, c.notes]
        .some((v) => v && v.toLowerCase().includes(term))
    );
  }, [contacts, search]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId('');
  };

  const openEdit = (c: CourtContact) => {
    setForm({
      name: c.name,
      court_type: c.court_type || 'vara',
      comarca: c.comarca || '',
      phone: c.phone || '',
      whatsapp: c.whatsapp || '',
      email: c.email || '',
      notes: c.notes || '',
    });
    setEditingId(c.id);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Informe o nome da vara/tribunal.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        court_type: form.court_type || null,
        comarca: form.comarca.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editingId) {
        const { error } = await courtContactsTable()
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
        toast.success('Contato atualizado!');
      } else {
        const { data: { user } } = await authClient.auth.getUser();
        const extUserId = await remapToExternal(user?.id || null);
        const { error } = await courtContactsTable()
          .insert({
            ...payload,
            created_by: extUserId,
            created_by_name: user?.user_metadata?.full_name || user?.email || null,
          });
        if (error) throw error;
        toast.success('Contato salvo!');
      }
      setEditingId(null);
      await load();
    } catch (e) {
      console.error('[CourtContacts] save falhou', e);
      toast.error('Erro ao salvar contato');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (c: CourtContact) => {
    try {
      const { error } = await courtContactsTable()
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', c.id);
      if (error) throw error;
      toast.success(`"${c.name}" arquivado.`);
      await load();
    } catch (e) {
      console.error('[CourtContacts] archive falhou', e);
      toast.error('Erro ao arquivar contato');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-primary" />
            Varas e Tribunais
          </SheetTitle>
          <SheetDescription className="text-xs">
            Meios de contato para cobrança de andamento processual.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 pb-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, comarca, telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Novo
          </Button>
        </div>

        {editingId !== null && (
          <div className="mx-4 mb-2 shrink-0 rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">
                {editingId ? 'Editar contato' : 'Novo contato'}
              </span>
              <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Input
              placeholder="Nome (ex: 2ª Vara do Trabalho de Fortaleza) *"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-8 text-xs"
            />
            <div className="flex gap-2">
              <Select value={form.court_type} onValueChange={(v) => setForm((f) => ({ ...f, court_type: v }))}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COURT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Comarca/UF"
                value={form.comarca}
                onChange={(e) => setForm((f) => ({ ...f, comarca: e.target.value }))}
                className="h-8 flex-1 text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Telefone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="h-8 flex-1 text-xs"
              />
              <Input
                placeholder="WhatsApp"
                value={form.whatsapp}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
                className="h-8 flex-1 text-xs"
              />
            </div>
            <Input
              placeholder="E-mail"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="h-8 text-xs"
            />
            <Textarea
              placeholder="Observações (horário de atendimento, ramal, nome do servidor...)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="min-h-[52px] text-xs"
            />
            <Button size="sm" className="h-8 w-full text-xs" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {editingId ? 'Salvar alterações' : 'Salvar contato'}
            </Button>
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 px-4 text-center text-sm text-muted-foreground">
              {search ? 'Nenhum contato encontrado.' : 'Nenhum contato salvo ainda. Clique em "Novo" para cadastrar.'}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((c) => (
                <div key={c.id} className="group px-4 py-2.5 hover:bg-muted/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">{c.name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        {c.court_type && (
                          <Badge variant="outline" className="text-[10px] capitalize">{c.court_type}</Badge>
                        )}
                        {c.comarca && <span>{c.comarca}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-6 w-6" title="Editar" onClick={() => openEdit(c)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        title="Arquivar"
                        onClick={() => handleArchive(c)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.phone && (
                      <button
                        onClick={() => copyText(c.phone!, 'Telefone')}
                        className="flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] hover:bg-muted"
                        title="Copiar telefone"
                      >
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {c.phone}
                        <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
                      </button>
                    )}
                    {c.whatsapp && (
                      <a
                        href={toWaLink(c.whatsapp)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] hover:bg-muted text-emerald-700 dark:text-emerald-400"
                        title="Abrir conversa no WhatsApp"
                      >
                        <MessageCircle className="h-3 w-3" />
                        {c.whatsapp}
                      </a>
                    )}
                    {c.email && (
                      <button
                        onClick={() => copyText(c.email!, 'E-mail')}
                        className="flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] hover:bg-muted"
                        title="Copiar e-mail"
                      >
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <span className="max-w-[180px] truncate">{c.email}</span>
                        <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
                      </button>
                    )}
                  </div>
                  {c.notes && (
                    <p className={cn('mt-1 text-[10px] text-muted-foreground line-clamp-2')} title={c.notes}>
                      {c.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

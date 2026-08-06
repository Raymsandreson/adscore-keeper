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
import {
  Landmark, Search, Plus, Pencil, Trash2, Phone, Mail, MessageCircle, Copy,
  Loader2, X, Scale, CheckCircle2, AlertTriangle, Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { originScopeLabel, type CourtBranch } from '@/lib/cnj';
import {
  BRANCH_OPTIONS, DEGREE_OPTIONS, CONTACT_TYPE_OPTIONS, CHANNEL_OPTIONS,
  branchLabel, degreeLabel, contactTypeLabel, courtsForBranch, findCourt,
  buildUnitKey, isContactStale, ufName,
} from '@/lib/courtCatalog';
import { useCourtProcessCounts, countForContact, type CourtProcessCounts } from '@/hooks/useCourtProcessCounts';

export interface CourtContact {
  id: string;
  name: string;
  /** Legado: misturava nível e tipo de ponto. Substituído por contact_type. */
  court_type: string | null;
  comarca: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  branch: string | null;
  degree: string | null;
  court_code: string | null;
  uf: string | null;
  contact_type: string | null;
  unit_name: string | null;
  unit_key: string | null;
  origin_codes: string[] | null;
  preferred_channel: string | null;
  last_confirmed_at: string | null;
}

const EMPTY_FORM = {
  name: '',
  branch: '' as CourtBranch | '',
  degree: '',
  court_code: '',
  uf: '',
  comarca: '',
  contact_type: 'secretaria',
  unit_name: '',
  phone: '',
  whatsapp: '',
  email: '',
  preferred_channel: '',
  notes: '',
};

type FormState = typeof EMPTY_FORM;

const NONE = '__none__';

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

/** Vocabulário antigo de court_type, mantido preenchido por 24h (Regra 4). */
const legacyCourtType = (contactType: string): string =>
  ['vara', 'tribunal', 'secretaria', 'outro'].includes(contactType) ? contactType : 'outro';

/** Canais do contato, em botões de copiar/abrir. Reaproveitado na tela de processo. */
export function CourtContactChannels({ contact }: { contact: CourtContact }) {
  const preferred = contact.preferred_channel;
  const ring = (channel: string) =>
    preferred === channel ? 'border-primary/60 bg-primary/5' : '';

  return (
    <div className="flex flex-wrap gap-1.5">
      {contact.phone && (
        <button
          onClick={() => copyText(contact.phone!, 'Telefone')}
          className={cn('flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] hover:bg-muted', ring('phone'))}
          title={preferred === 'phone' ? 'Canal que responde — copiar telefone' : 'Copiar telefone'}
        >
          <Phone className="h-3 w-3 text-muted-foreground" />
          {contact.phone}
          <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
        </button>
      )}
      {contact.whatsapp && (
        <a
          href={toWaLink(contact.whatsapp)}
          target="_blank"
          rel="noreferrer"
          className={cn('flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] hover:bg-muted text-emerald-700 dark:text-emerald-400', ring('whatsapp'))}
          title="Abrir conversa no WhatsApp"
        >
          <MessageCircle className="h-3 w-3" />
          {contact.whatsapp}
        </a>
      )}
      {contact.email && (
        <button
          onClick={() => copyText(contact.email!, 'E-mail')}
          className={cn('flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] hover:bg-muted', ring('email'))}
          title={preferred === 'email' ? 'Canal que responde — copiar e-mail' : 'Copiar e-mail'}
        >
          <Mail className="h-3 w-3 text-muted-foreground" />
          <span className="max-w-[220px] truncate">{contact.email}</span>
          <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
        </button>
      )}
    </div>
  );
}

/** Pontos de contato do mesmo lugar físico, agrupados pela unidade. */
interface UnitGroup {
  key: string;
  unitName: string;
  branch: string | null;
  degree: string | null;
  courtCode: string | null;
  uf: string | null;
  comarca: string | null;
  contacts: CourtContact[];
  active: number;
  total: number;
  approx: boolean;
}

function buildGroups(contacts: CourtContact[], counts: CourtProcessCounts): UnitGroup[] {
  const map = new Map<string, UnitGroup>();

  for (const c of contacts) {
    const key = c.unit_key || `solo:${c.id}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        unitName: c.unit_name || c.name,
        branch: c.branch,
        degree: c.degree,
        courtCode: c.court_code,
        uf: c.uf,
        comarca: c.comarca,
        contacts: [],
        active: 0,
        total: 0,
        approx: false,
      };
      map.set(key, group);
    }
    group.contacts.push(c);
    // Os atributos da unidade vêm do primeiro ponto que os tiver preenchidos.
    group.branch ||= c.branch;
    group.degree ||= c.degree;
    group.courtCode ||= c.court_code;
    group.uf ||= c.uf;
    group.comarca ||= c.comarca;
  }

  const groups = [...map.values()];
  for (const g of groups) {
    // Basta um ponto do grupo conhecer o código de origem para o grupo inteiro
    // contar certo — é assim que o "é esta a unidade?" beneficia os irmãos.
    const withOrigin = g.contacts.find((c) => c.origin_codes?.length);
    const ref = withOrigin || g.contacts[0];
    const hit = countForContact(counts, ref);
    g.active = hit.active;
    g.total = hit.total;
    g.approx = hit.approx;
    g.contacts.sort((a, b) => (a.contact_type || '').localeCompare(b.contact_type || ''));
  }

  // Onde há processo sobe; o resto desce e fica em ordem alfabética.
  groups.sort((a, b) => b.active - a.active || a.unitName.localeCompare(b.unitName, 'pt-BR'));
  return groups;
}

interface CourtContactsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CourtContactsSheet({ open, onOpenChange }: CourtContactsSheetProps) {
  const [contacts, setContacts] = useState<CourtContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fDegree, setFDegree] = useState('');
  const [fUf, setFUf] = useState('');
  const [fType, setFType] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null); // null = sem form; '' = novo
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { counts, loading: countsLoading } = useCourtProcessCounts(open);

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

  // Só oferece filtro para o que existe na base — 27 UFs num seletor com 6
  // contatos cadastrados seria ruído.
  const options = useMemo(() => {
    const uniq = (vals: (string | null)[]) => [...new Set(vals.filter(Boolean) as string[])];
    return {
      branches: BRANCH_OPTIONS.filter((o) => contacts.some((c) => c.branch === o.value)),
      degrees: DEGREE_OPTIONS.filter((o) => contacts.some((c) => c.degree === o.value)),
      ufs: uniq(contacts.map((c) => c.uf)).sort(),
      types: CONTACT_TYPE_OPTIONS.filter((o) => contacts.some((c) => c.contact_type === o.value)),
    };
  }, [contacts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (fBranch && c.branch !== fBranch) return false;
      if (fDegree && c.degree !== fDegree) return false;
      if (fUf && c.uf !== fUf) return false;
      if (fType && c.contact_type !== fType) return false;
      if (!term) return true;
      return [
        c.name, c.unit_name, c.comarca, c.court_code, c.uf, c.phone, c.whatsapp,
        c.email, c.notes, branchLabel(c.branch), degreeLabel(c.degree),
      ].some((v) => v && String(v).toLowerCase().includes(term));
    });
  }, [contacts, search, fBranch, fDegree, fUf, fType]);

  const groups = useMemo(() => buildGroups(filtered, counts), [filtered, counts]);

  const hasFilter = Boolean(fBranch || fDegree || fUf || fType);
  const clearFilters = () => { setFBranch(''); setFDegree(''); setFUf(''); setFType(''); };

  /** Unidades já cadastradas, para o operador reaproveitar o nome e agrupar. */
  const knownUnits = useMemo(
    () => [...new Set(contacts.map((c) => c.unit_name).filter(Boolean) as string[])].sort(),
    [contacts],
  );

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId('');
  };

  const openEdit = (c: CourtContact) => {
    setForm({
      name: c.name,
      branch: (c.branch || '') as CourtBranch | '',
      degree: c.degree || '',
      court_code: c.court_code || '',
      uf: c.uf || '',
      comarca: c.comarca || '',
      contact_type: c.contact_type || 'secretaria',
      unit_name: c.unit_name || c.name,
      phone: c.phone || '',
      whatsapp: c.whatsapp || '',
      email: c.email || '',
      preferred_channel: c.preferred_channel || '',
      notes: c.notes || '',
    });
    setEditingId(c.id);
  };

  /** Escolher o tribunal já resolve ramo e UF — menos campo para digitar errado. */
  const pickCourt = (code: string) => {
    const court = findCourt(code);
    setForm((f) => ({
      ...f,
      court_code: code,
      branch: (court?.branch || f.branch) as CourtBranch | '',
      uf: court && court.ufs.length === 1 ? court.ufs[0] : f.uf,
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Informe o nome do ponto de contato.');
      return;
    }
    setSaving(true);
    try {
      const unitName = form.unit_name.trim() || form.name.trim();
      const payload = {
        name: form.name.trim(),
        branch: form.branch || null,
        degree: form.degree || null,
        court_code: form.court_code || null,
        uf: form.uf || null,
        comarca: form.comarca.trim() || null,
        contact_type: form.contact_type || null,
        court_type: legacyCourtType(form.contact_type),
        unit_name: unitName,
        unit_key: buildUnitKey(form.court_code, unitName),
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        preferred_channel: form.preferred_channel || null,
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
            last_confirmed_at: new Date().toISOString(),
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

  const handleConfirm = async (c: CourtContact) => {
    try {
      const now = new Date().toISOString();
      const { error } = await courtContactsTable()
        .update({ last_confirmed_at: now, updated_at: now })
        .eq('id', c.id);
      if (error) throw error;
      toast.success('Contato confirmado.');
      await load();
    } catch (e) {
      console.error('[CourtContacts] confirm falhou', e);
      toast.error('Erro ao confirmar contato');
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

  const courtOptions = useMemo(
    () => courtsForBranch((form.branch || 'todos') as CourtBranch | 'todos'),
    [form.branch],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
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
              placeholder="Buscar por unidade, comarca, tribunal, telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Novo
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 shrink-0">
          <FilterSelect
            value={fBranch} onChange={setFBranch} placeholder="Ramo"
            options={options.branches.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterSelect
            value={fDegree} onChange={setFDegree} placeholder="Grau"
            options={options.degrees.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterSelect
            value={fUf} onChange={setFUf} placeholder="UF"
            options={options.ufs.map((uf) => ({ value: uf, label: `${uf} — ${ufName(uf)}` }))}
          />
          <FilterSelect
            value={fType} onChange={setFType} placeholder="Tipo"
            options={options.types.map((o) => ({ value: o.value, label: o.label }))}
          />
          {hasFilter && (
            <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearFilters}>
              Limpar
            </Button>
          )}
        </div>

        {editingId !== null && (
          <div className="mx-4 mb-2 shrink-0 rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">
                {editingId ? 'Editar ponto de contato' : 'Novo ponto de contato'}
              </span>
              <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <Input
              placeholder="Nome do ponto (ex: Secretaria da 2ª Vara do Trabalho de Fortaleza) *"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, unit_name: f.unit_name || '' }))}
              className="h-8 text-xs"
            />

            <div className="grid grid-cols-2 gap-2">
              <Select
                value={form.branch || NONE}
                onValueChange={(v) => setForm((f) => ({ ...f, branch: v === NONE ? '' : (v as CourtBranch), court_code: '' }))}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Ramo" /></SelectTrigger>
                <SelectContent>
                  {BRANCH_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={form.degree || NONE}
                onValueChange={(v) => setForm((f) => ({ ...f, degree: v === NONE ? '' : v }))}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Grau" /></SelectTrigger>
                <SelectContent>
                  {DEGREE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={form.court_code || NONE} onValueChange={(v) => v !== NONE && pickCourt(v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tribunal / órgão" /></SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {courtOptions.map((c) => (
                    <SelectItem key={c.code} value={c.code} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={form.contact_type}
                onValueChange={(v) => setForm((f) => ({ ...f, contact_type: v }))}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tipo do ponto" /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Unidade (agrupa secretaria e gabinete do mesmo lugar)"
                list="court-units"
                value={form.unit_name}
                onChange={(e) => setForm((f) => ({ ...f, unit_name: e.target.value }))}
                className="h-8 flex-1 text-xs"
              />
              <datalist id="court-units">
                {knownUnits.map((u) => <option key={u} value={u} />)}
              </datalist>
              <Input
                placeholder="Comarca/Subseção"
                value={form.comarca}
                onChange={(e) => setForm((f) => ({ ...f, comarca: e.target.value }))}
                className="h-8 w-[160px] text-xs"
              />
              <Input
                placeholder="UF"
                maxLength={2}
                value={form.uf}
                onChange={(e) => setForm((f) => ({ ...f, uf: e.target.value.toUpperCase() }))}
                className="h-8 w-[64px] text-xs"
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

            <div className="flex gap-2">
              <Input
                placeholder="E-mail"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="h-8 flex-1 text-xs"
              />
              <Select
                value={form.preferred_channel || NONE}
                onValueChange={(v) => setForm((f) => ({ ...f, preferred_channel: v === NONE ? '' : v }))}
              >
                <SelectTrigger className="h-8 w-[170px] text-xs">
                  <SelectValue placeholder="Canal que responde" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">Não sei ainda</SelectItem>
                  {CHANNEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Textarea
              placeholder="Observações (horário de atendimento, ramal, nome do servidor, 'só responde por e-mail'...)"
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
          ) : groups.length === 0 ? (
            <div className="py-10 px-4 text-center text-sm text-muted-foreground">
              {search || hasFilter
                ? 'Nenhum contato encontrado com esses filtros.'
                : 'Nenhum contato salvo ainda. Clique em "Novo" para cadastrar.'}
            </div>
          ) : (
            <div className="divide-y">
              {groups.map((g) => (
                <div key={g.key} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">{g.unitName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        {g.branch && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Scale className="h-2.5 w-2.5" />{branchLabel(g.branch, true)}
                          </Badge>
                        )}
                        {g.degree && (
                          <Badge variant="outline" className="text-[10px]">{degreeLabel(g.degree, true)}</Badge>
                        )}
                        {g.courtCode && (
                          <Badge variant="secondary" className="text-[10px]">{g.courtCode}</Badge>
                        )}
                        {(g.comarca || g.uf) && (
                          <span>{[g.comarca, g.uf].filter(Boolean).join('/')}</span>
                        )}
                      </div>
                    </div>
                    {g.total > 0 && (
                      <div
                        className="shrink-0 rounded-md border bg-card px-1.5 py-1 text-center"
                        title={
                          g.approx
                            ? `Processos no ${g.courtCode} inteiro — informe a unidade de origem para afinar`
                            : `Processos ${originScopeLabel(g.branch as CourtBranch)}`
                        }
                      >
                        <div className="flex items-center gap-1 text-[11px] font-semibold leading-none">
                          <Briefcase className="h-3 w-3 text-muted-foreground" />
                          {g.active}
                        </div>
                        <div className="mt-0.5 text-[9px] text-muted-foreground leading-none">
                          {g.approx ? `no ${g.courtCode}` : originScopeLabel(g.branch as CourtBranch)}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 space-y-2">
                    {g.contacts.map((c) => {
                      const stale = isContactStale(c.contact_type, c.last_confirmed_at, c.created_at);
                      return (
                        <div
                          key={c.id}
                          className={cn(
                            'group rounded-md border-l-2 pl-2 py-1 hover:bg-muted/40 transition-colors',
                            stale ? 'border-l-amber-400/70 opacity-70' : 'border-l-muted',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1 min-w-0">
                              <Badge variant="outline" className="text-[10px]">
                                {contactTypeLabel(c.contact_type) || c.court_type || 'Contato'}
                              </Badge>
                              {c.name !== g.unitName && (
                                <span className="text-[10px] text-muted-foreground truncate">{c.name}</span>
                              )}
                              {stale && (
                                <Badge variant="outline" className="gap-1 border-amber-400/60 text-[10px] text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="h-2.5 w-2.5" /> a conferir
                                </Badge>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {stale && (
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6 text-emerald-600"
                                  title="Confirmar que o contato continua válido"
                                  onClick={() => handleConfirm(c)}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-6 w-6" title="Editar" onClick={() => openEdit(c)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                                title="Arquivar" onClick={() => handleArchive(c)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-1">
                            <CourtContactChannels contact={c} />
                          </div>
                          {c.notes && (
                            <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2" title={c.notes}>
                              {c.notes}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {countsLoading && (
            <p className="px-4 py-2 text-[10px] text-muted-foreground">
              Contando processos por tribunal...
            </p>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function FilterSelect({
  value, onChange, placeholder, options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  if (!options.length) return null;
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger
        className={cn('h-7 w-auto gap-1 px-2 text-[11px]', value && 'border-primary/60 bg-primary/5')}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} className="text-xs">{placeholder}: todos</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

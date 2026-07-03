import { useEffect, useMemo, useRef, useState } from "react";
import { externalSupabase, ensureExternalSession } from "@/integrations/supabase/external-client";
import { cloudFunctions } from "@/lib/functionRouter";
import { useAuth } from "@/hooks/useAuth";
import { useProfilesList } from "@/hooks/useProfilesList";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, CheckCircle2, Users, Link2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Lead } from "@/hooks/useLeads";

const TRABALHISTA_BOARD_ID = "2dcd54b5-502b-413b-b795-5e24a20797d2";
const FIRST_KANBAN_STAGE = "recepcao";

const CASE_TYPES = ['Queda de Altura', 'Soterramento', 'Choque Elétrico', 'Acidente com Máquinas', 'Intoxicação', 'Explosão', 'Incêndio', 'Acidente de Trânsito', 'Esmagamento', 'Corte/Amputação', 'Afogamento', 'Outro'];
const LIABILITY_TYPES = ['Solidária', 'Subsidiária', 'Objetiva', 'Subjetiva', 'A Definir'];
const SECTORS = ['Construção Civil', 'Mineração', 'Agronegócio', 'Indústria', 'Energia', 'Logística', 'Siderurgia', 'Petróleo e Gás', 'Alimentício', 'Outro'];

const UF_REGIONS: Record<string, string> = {
  AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
};

interface CasoForm {
  lead_title: string;
  acolhedor: string;
  case_type: string;
  damage: string;            // dano curto (só compõe o título)
  dynamics_summary: string;  // dinâmica resumida (só compõe o título)
  news_link: string;
  city: string;
  state: string;
  visit_city: string;
  visit_state: string;
  visit_region: string;
  visit_address: string;
  accident_date: string;     // ISO
  damage_description: string;
  victim_name: string;
  victim_age: string;
  accident_address: string;
  contractor_company: string;
  main_company: string;
  sector: string;
  company_size_justification: string;
  liability_type: string;
  liability_justification: string;
}

const EMPTY_FORM: CasoForm = {
  lead_title: '', acolhedor: '', case_type: '', damage: '', dynamics_summary: '',
  news_link: '', city: '', state: '', visit_city: '', visit_state: '', visit_region: '',
  visit_address: '', accident_date: '', damage_description: '', victim_name: '',
  victim_age: '', accident_address: '', contractor_company: '', main_company: '',
  sector: '', company_size_justification: '', liability_type: '', liability_justification: '',
};

function formatISOToBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Lead título: Vítima(Cidade-UF) x Tomadora(Dano - Dinâmica) - DD/MM/AAAA
function composeTitle(f: CasoForm): string {
  const victim = f.victim_name.trim() || 'Vítima não identificada';
  const local = [f.city.trim(), f.state.trim()].filter(Boolean).join('-');
  const company = f.main_company.trim() || f.contractor_company.trim() || 'Empresa não identificada';
  const danoParts = [f.damage.trim(), f.dynamics_summary.trim()].filter(Boolean).join(' - ');
  let title = victim;
  if (local) title += `(${local})`;
  title += ` x ${company}`;
  if (danoParts) title += `(${danoParts})`;
  if (f.accident_date) title += ` - ${formatISOToBR(f.accident_date)}`;
  return title;
}

type StepState = 'idle' | 'running' | 'done' | 'error';

// Extrai o nº de nomes tipo "LEAD 94", "LEAD169", "LEAD132/jun.26".
// Números com zero à esquerda ("LEAD 0656") são de outro funil (INSS/BPC) e são ignorados.
function parseLeadSeq(name: string | null | undefined): number {
  const m = String(name || '').match(/^\s*(?:✅\s*)?LEAD\s*[-|:]?\s*(\d{1,6})\b/i);
  if (!m || /^0/.test(m[1])) return 0;
  return Number(m[1]);
}

// Maior nº entre: contador oficial, grupos vinculados a leads do board (tempo real)
// e snapshot UazAPI (pega grupos criados manualmente; sincroniza 1x/dia). Best-effort:
// cada fonte falha isolada e a sugestão continua editável pelo usuário.
async function suggestNextSequence(): Promise<number | null> {
  await ensureExternalSession();
  let best = 0;
  let seqStart: number | null = null;
  try {
    const { data } = await externalSupabase
      .from('board_group_settings')
      .select('current_sequence, sequence_start')
      .eq('board_id', TRABALHISTA_BOARD_ID)
      .maybeSingle();
    if (data?.current_sequence) best = Math.max(best, data.current_sequence);
    seqStart = data?.sequence_start ?? null;
  } catch { /* segue com as outras fontes */ }
  try {
    const { data } = await externalSupabase
      .from('lead_whatsapp_groups')
      .select('group_name, leads!inner(board_id)')
      .eq('leads.board_id', TRABALHISTA_BOARD_ID)
      .ilike('group_name', '%lead%')
      .limit(1000);
    for (const r of data || []) best = Math.max(best, parseLeadSeq((r as any).group_name));
  } catch { /* segue */ }
  try {
    const { data } = await externalSupabase
      .from('whatsapp_groups_uazapi_snapshot')
      .select('group_name')
      .ilike('group_name', '%lead%')
      .limit(3000);
    for (const r of data || []) best = Math.max(best, parseLeadSeq((r as any).group_name));
  } catch { /* segue */ }
  if (best > 0) return best + 1;
  return seqStart;
}

interface Props {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persiste updates no lead (mesmo caminho do resto da página). */
  saveLead: (leadId: string, updates: Partial<Lead>) => Promise<void>;
  /** Chamado após cadastro concluído para a página recarregar a lista. */
  onRegistered: () => void;
}

export function CadastrarCasoViavelDialog({ lead, open, onOpenChange, saveLead, onRegistered }: Props) {
  const { profile, user } = useAuth();
  const profiles = useProfilesList();

  const [newsText, setNewsText] = useState('');
  const [newsUrl, setNewsUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [form, setForm] = useState<CasoForm>(EMPTY_FORM);
  const [registering, setRegistering] = useState(false);
  const [steps, setSteps] = useState<{ save: StepState; group: StepState; link: StepState }>({ save: 'idle', group: 'idle', link: 'idle' });
  const [groupLink, setGroupLink] = useState('');
  const [seqNumber, setSeqNumber] = useState('');
  const [seqLoading, setSeqLoading] = useState(false);
  const titleTouched = useRef(false);

  const set = (patch: Partial<CasoForm>) => setForm((prev) => {
    const next = { ...prev, ...patch };
    if (patch.visit_state !== undefined) next.visit_region = UF_REGIONS[patch.visit_state] || '';
    if (!titleTouched.current && patch.lead_title === undefined) next.lead_title = composeTitle(next);
    return next;
  });

  // Reinicializa ao abrir com os dados já existentes do lead da linha clicada.
  useEffect(() => {
    if (!open || !lead) return;
    titleTouched.current = false;
    setNewsText('');
    setNewsUrl(String((lead as any).news_link || (lead as any).news_links?.[0] || ''));
    setGroupLink(String((lead as any).group_link || ''));
    setSteps({ save: 'idle', group: 'idle', link: 'idle' });
    const l = lead as any;
    const initial: CasoForm = {
      ...EMPTY_FORM,
      acolhedor: l.acolhedor || profile?.full_name || user?.email || '',
      case_type: l.case_type || '',
      news_link: l.news_link || '',
      city: l.city || '',
      state: l.state || '',
      visit_city: l.visit_city || l.city || '',
      visit_state: l.visit_state || l.state || '',
      visit_region: l.visit_region || UF_REGIONS[l.visit_state || l.state] || '',
      visit_address: l.visit_address || '',
      accident_date: (l.accident_date || '').slice(0, 10),
      damage_description: l.damage_description || '',
      victim_name: l.victim_name || '',
      victim_age: l.victim_age ? String(l.victim_age) : '',
      accident_address: l.accident_address || '',
      contractor_company: l.contractor_company || '',
      main_company: l.main_company || '',
      sector: l.sector || '',
      company_size_justification: l.company_size_justification || '',
      liability_type: l.liability_type || '',
      liability_justification: '',
    };
    initial.lead_title = composeTitle(initial);
    setForm(initial);

    // Sugere o próximo número aprendendo com o último grupo REAL criado, não só
    // com o contador oficial (grupos criados manualmente não avançam o contador).
    setSeqNumber('');
    setSeqLoading(true);
    suggestNextSequence()
      .then((n) => setSeqNumber(n ? String(n) : ''))
      .finally(() => setSeqLoading(false));
  }, [open, lead?.id]);

  const groupNamePreview = useMemo(() => {
    const local = [form.city.trim(), form.state.trim()].filter(Boolean).join('/');
    const parts = [`LEAD ${seqNumber || '?'}`];
    if (local) parts.push(local);
    const vs = [form.victim_name.trim(), form.main_company.trim()].filter(Boolean).join(' x ');
    if (vs) parts.push(vs);
    if (form.accident_date) parts.push(formatISOToBR(form.accident_date));
    return parts.join(' | ');
  }, [form, seqNumber]);

  const handleAnalyze = async () => {
    let text = newsText.trim();
    let sourceUrl = newsUrl.trim();
    // URL colada direto na textarea também vale como link
    if (!sourceUrl && /^https?:\/\/\S+$/.test(text)) {
      sourceUrl = text;
      text = '';
    }
    if (text.length < 50 && !sourceUrl) {
      toast.error('Cole o texto da notícia (mínimo 50 caracteres) ou informe o link antes de analisar.');
      return;
    }
    setAnalyzing(true);
    try {
      // Sem texto suficiente: lê a notícia pelo link (scrape-news / Firecrawl)
      if (text.length < 50) {
        const { data: scraped, error: scrapeErr } = await cloudFunctions.invoke('scrape-news', {
          body: { url: sourceUrl },
        });
        if (scrapeErr || !scraped?.success) {
          throw new Error(scraped?.error || scrapeErr?.message || 'Falha ao ler a notícia pelo link');
        }
        text = String(scraped.content || scraped.text || '').trim();
        if (text.length < 50) throw new Error('Não foi possível extrair conteúdo suficiente desta página.');
        setNewsText(text);
        setNewsUrl(sourceUrl);
      }
      const { data, error } = await cloudFunctions.invoke('analyze-news-case', { body: { text } });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Falha na análise');
      const d = data.data as Record<string, any>;
      const uf = String(d.state || '').toUpperCase().slice(0, 2);
      titleTouched.current = false;
      set({
        victim_name: d.victim_name || form.victim_name,
        victim_age: d.victim_age ? String(d.victim_age) : form.victim_age,
        accident_date: d.accident_date || form.accident_date,
        damage: d.damage || form.damage,
        dynamics_summary: d.dynamics_summary || form.dynamics_summary,
        case_type: CASE_TYPES.includes(d.case_type) ? d.case_type : form.case_type,
        damage_description: d.damage_description || form.damage_description,
        city: d.city || form.city,
        state: uf || form.state,
        visit_city: form.visit_city || d.city || '',
        visit_state: form.visit_state || uf || '',
        accident_address: d.accident_address || form.accident_address,
        contractor_company: d.contractor_company || form.contractor_company,
        main_company: d.main_company || form.main_company,
        sector: SECTORS.includes(d.sector) ? d.sector : form.sector,
        company_size_justification: d.company_size_justification || form.company_size_justification,
        liability_type: LIABILITY_TYPES.includes(d.liability_type) ? d.liability_type : form.liability_type,
        liability_justification: d.liability_justification || form.liability_justification,
        news_link: sourceUrl || d.news_link || form.news_link,
      });
      toast.success('Análise concluída — revise os campos antes de cadastrar.');
    } catch (e: any) {
      console.error('[CadastrarCasoViavel] analyze error', e);
      toast.error('Falha ao analisar com IA', { description: e?.message });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRegister = async () => {
    if (!lead) return;
    if (!form.lead_title.trim()) {
      toast.error('Lead título é obrigatório.');
      return;
    }
    setRegistering(true);
    setSteps({ save: 'running', group: 'idle', link: 'idle' });

    // Passo 1 — persistir o lead (status entra no Kanban como "recepcao")
    const notesExtra = form.liability_justification.trim()
      ? `Justificativa da responsabilidade (IA): ${form.liability_justification.trim()}`
      : '';
    const updates: Partial<Lead> = {
      lead_name: form.lead_title.trim(),
      status: FIRST_KANBAN_STAGE,
      source: 'Internet',
      acolhedor: form.acolhedor || null,
      case_type: form.case_type || null,
      news_link: form.news_link || null,
      city: form.city || null,
      state: form.state || null,
      visit_city: form.visit_city || null,
      visit_state: form.visit_state || null,
      visit_region: form.visit_region || null,
      visit_address: form.visit_address || null,
      accident_date: form.accident_date || null,
      damage_description: form.damage_description || null,
      victim_name: form.victim_name || null,
      victim_age: form.victim_age ? Number(form.victim_age) : null,
      accident_address: form.accident_address || null,
      contractor_company: form.contractor_company || null,
      main_company: form.main_company || null,
      sector: form.sector || null,
      company_size_justification: form.company_size_justification || null,
      liability_type: form.liability_type || null,
      ...(notesExtra ? { notes: [((lead as any).notes || '').trim(), notesExtra].filter(Boolean).join('\n\n') } : {}),
    } as any;

    try {
      await saveLead(lead.id, updates);
      setSteps((s) => ({ ...s, save: 'done', group: 'running' }));
    } catch (e: any) {
      setSteps((s) => ({ ...s, save: 'error' }));
      toast.error('Falha ao salvar o lead', { description: e?.message });
      setRegistering(false);
      return;
    }

    // Passo 2 — criar grupo WhatsApp (nome sequencial "LEAD N | ..." vem do board_group_settings)
    let groupJid: string | null = null;
    try {
      const { data, error } = await cloudFunctions.invoke('create-whatsapp-group', {
        body: {
          lead_id: lead.id,
          lead_name: form.lead_title.trim(),
          board_id: TRABALHISTA_BOARD_ID,
          creation_origin: 'noticia_viavel',
          phase: 'open',
          ...(Number(seqNumber) > 0 ? { forced_sequence: Number(seqNumber) } : {}),
        },
      });
      if (error) throw error;
      if (data?.queued) {
        setSteps((s) => ({ ...s, group: 'error', link: 'idle' }));
        toast.info('Lead cadastrado. Instâncias offline: grupo entrou na fila e será criado automaticamente.', { duration: 8000 });
        onRegistered();
        onOpenChange(false);
        setRegistering(false);
        return;
      }
      if (!data?.success || !data?.group_id) throw new Error(data?.error || 'Grupo não foi criado');
      groupJid = String(data.group_id);
      setSteps((s) => ({ ...s, group: 'done', link: 'running' }));
    } catch (e: any) {
      setSteps((s) => ({ ...s, group: 'error' }));
      toast.error('Lead cadastrado, mas a criação do grupo falhou', { description: e?.message, duration: 8000 });
      onRegistered();
      setRegistering(false);
      return;
    }

    // Passo 3 — buscar link de convite (a função persiste em leads.group_link)
    try {
      const { data, error } = await cloudFunctions.invoke('get-group-invite-link', {
        body: { group_jid: groupJid, lead_id: lead.id },
      });
      if (error || !data?.success || !data?.invite_link) throw new Error(data?.error || error?.message || 'Link não retornado');
      setGroupLink(data.invite_link);
      setSteps((s) => ({ ...s, link: 'done' }));
      toast.success('Caso cadastrado, grupo criado e link salvo no lead.');
    } catch (e: any) {
      setSteps((s) => ({ ...s, link: 'error' }));
      toast.warning('Grupo criado, mas não foi possível obter o link de convite agora.', { description: e?.message, duration: 8000 });
    }

    onRegistered();
    setRegistering(false);
  };

  const stepBadge = (state: StepState, label: string, icon: React.ReactNode) => (
    <Badge variant="outline" className={
      state === 'done' ? 'border-emerald-500 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30'
        : state === 'running' ? 'border-blue-500 text-blue-700 bg-blue-50 dark:bg-blue-900/30'
          : state === 'error' ? 'border-red-500 text-red-700 bg-red-50 dark:bg-red-900/30'
            : 'text-muted-foreground'
    }>
      {state === 'running' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : icon}
      {label}
    </Badge>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !registering && onOpenChange(v)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Cadastrar Caso Viável
          </DialogTitle>
          <DialogDescription>
            Cole o texto da notícia, analise com IA, revise os campos e cadastre. O grupo do WhatsApp
            é criado automaticamente e o link salvo no lead.
          </DialogDescription>
        </DialogHeader>

        {/* Análise com IA */}
        <div className="space-y-2 rounded-lg border border-dashed p-3 bg-muted/30">
          <Label>Colar Texto da Notícia para Análise</Label>
          <Textarea
            value={newsText}
            onChange={(e) => setNewsText(e.target.value)}
            placeholder="Cole aqui o texto completo da notícia do acidente de trabalho..."
            rows={5}
          />
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              value={newsUrl}
              onChange={(e) => setNewsUrl(e.target.value)}
              placeholder="ou cole o link da notícia (https://...)"
              className="h-9 flex-1 min-w-[240px]"
            />
            <Button type="button" onClick={handleAnalyze} disabled={analyzing || registering} className="gap-2">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? 'Analisando...' : 'Analisar com IA'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Com o texto vazio, a notícia é lida automaticamente pelo link.
          </p>
        </div>

        {/* Campos do lead — todos editáveis */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Lead título *</Label>
            <Input
              value={form.lead_title}
              onChange={(e) => { titleTouched.current = true; set({ lead_title: e.target.value }); }}
              placeholder="Vítima(Cidade-UF) x Tomadora(Dano - Dinâmica) - DD/MM/AAAA"
            />
          </div>

          <div>
            <Label>Número do Lead (grupo)</Label>
            <Input
              value={seqNumber}
              onChange={(e) => setSeqNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={seqLoading ? 'Calculando...' : 'Ex: 170'}
              disabled={seqLoading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Sugerido a partir do último grupo criado — ajuste se estiver errado.
            </p>
          </div>
          <div>
            <Label>Data da criação</Label>
            <Input value={format(new Date(), 'dd/MM/yyyy')} readOnly className="bg-muted" />
          </div>
          <div>
            <Label>Status inicial</Label>
            <Input value="Recepção (Cadastrados viáveis)" readOnly className="bg-muted" />
          </div>

          <div>
            <Label>Acolhedor</Label>
            {profiles.length > 0 ? (
              <Select value={form.acolhedor} onValueChange={(v) => set({ acolhedor: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.full_name || p.email || p.id}>{p.full_name || p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={form.acolhedor} onChange={(e) => set({ acolhedor: e.target.value })} />
            )}
          </div>
          <div>
            <Label>Origem do Caso</Label>
            <Input value="Internet" readOnly className="bg-muted" />
          </div>

          <div>
            <Label>Tipo de Caso</Label>
            <Select value={form.case_type} onValueChange={(v) => set({ case_type: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{CASE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Dano (compõe o título)</Label>
            <Input value={form.damage} onChange={(e) => set({ damage: e.target.value })} placeholder="Ex: Morte, Amputação..." />
          </div>

          <div className="sm:col-span-2">
            <Label>Dinâmica resumida (compõe o título)</Label>
            <Input value={form.dynamics_summary} onChange={(e) => set({ dynamics_summary: e.target.value })} placeholder="Ex: Esmagamento por perda de freio" />
          </div>

          <div className="sm:col-span-2">
            <Label>Link da Notícia</Label>
            <Input value={form.news_link} onChange={(e) => set({ news_link: e.target.value })} placeholder="https://..." />
          </div>

          <div className="sm:col-span-2">
            <Label>Link do Grupo do WhatsApp</Label>
            <Input value={groupLink} readOnly className="bg-muted" placeholder="Gerado automaticamente após o cadastro" />
          </div>

          <div>
            <Label>Nome da Vítima</Label>
            <Input value={form.victim_name} onChange={(e) => set({ victim_name: e.target.value })} />
          </div>
          <div>
            <Label>Idade da Vítima</Label>
            <Input type="number" value={form.victim_age} onChange={(e) => set({ victim_age: e.target.value })} />
          </div>

          <div>
            <Label>Data do Acidente</Label>
            <Input type="date" value={form.accident_date} onChange={(e) => set({ accident_date: e.target.value })} />
          </div>
          <div>
            <Label>Cidade / UF do Acidente</Label>
            <div className="flex gap-2">
              <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Cidade" />
              <Input value={form.state} onChange={(e) => set({ state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="UF" className="w-16" />
            </div>
          </div>

          <div className="sm:col-span-2">
            <Label>Endereço do Acidente</Label>
            <Input value={form.accident_address} onChange={(e) => set({ accident_address: e.target.value })} />
          </div>

          <div>
            <Label>Cidade da Visita</Label>
            <Input value={form.visit_city} onChange={(e) => set({ visit_city: e.target.value })} />
          </div>
          <div>
            <Label>Estado / Região da Visita</Label>
            <div className="flex gap-2">
              <Input value={form.visit_state} onChange={(e) => set({ visit_state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="UF" className="w-16" />
              <Input value={form.visit_region} readOnly className="bg-muted" placeholder="Região" />
            </div>
          </div>

          <div className="sm:col-span-2">
            <Label>Endereço da Visita</Label>
            <Input value={form.visit_address} onChange={(e) => set({ visit_address: e.target.value })} />
          </div>

          <div>
            <Label>Empresa Terceirizada</Label>
            <Input value={form.contractor_company} onChange={(e) => set({ contractor_company: e.target.value })} />
          </div>
          <div>
            <Label>Empresa Tomadora</Label>
            <Input value={form.main_company} onChange={(e) => set({ main_company: e.target.value })} />
          </div>

          <div>
            <Label>Setor</Label>
            <Select value={form.sector} onValueChange={(v) => set({ sector: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo de Responsabilidade</Label>
            <Select value={form.liability_type} onValueChange={(v) => set({ liability_type: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{LIABILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Label>Justificativa do Porte da Empresa</Label>
            <Textarea value={form.company_size_justification} onChange={(e) => set({ company_size_justification: e.target.value })} rows={3} />
          </div>
          <div className="sm:col-span-2">
            <Label>Justificativa da Responsabilidade</Label>
            <Textarea value={form.liability_justification} onChange={(e) => set({ liability_justification: e.target.value })} rows={3} placeholder="Salva nas observações do lead" />
          </div>

          <div className="sm:col-span-2">
            <Label>Descrição do Dano</Label>
            <Textarea value={form.damage_description} onChange={(e) => set({ damage_description: e.target.value })} rows={3} />
          </div>
        </div>

        {/* Preview do grupo + progresso */}
        <div className="rounded-lg border p-3 bg-muted/30 space-y-2 text-sm">
          <div className="text-muted-foreground">
            Nome do grupo (prévia): <span className="font-medium text-foreground">{groupNamePreview}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {stepBadge(steps.save, 'Salvar lead', <CheckCircle2 className="h-3 w-3 mr-1" />)}
            {stepBadge(steps.group, 'Criar grupo', <Users className="h-3 w-3 mr-1" />)}
            {stepBadge(steps.link, 'Obter link', <Link2 className="h-3 w-3 mr-1" />)}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={registering}>Cancelar</Button>
          <Button onClick={handleRegister} disabled={registering || analyzing} className="gap-2">
            {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {registering ? 'Cadastrando...' : 'Cadastrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

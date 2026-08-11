import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudFunctions } from "@/lib/functionRouter";
import {
  GROUP_AUTHOR_OPTIONS,
  DEFAULT_GROUP_AUTHOR_INSTANCE_ID,
  composeGroupIntroMessage,
  createLeadWhatsappGroup,
  fetchInstanceConnStatus,
  formatISOToBR,
  nextFreeLeadNumber as nextFreeLeadNumberForBoard,
  suggestNextSequence as suggestNextSequenceForBoard,
} from "@/lib/leadWhatsappGroupFlow";
import { TRABALHISTA_BOARD_ID } from "@/lib/trabalhistaAcolhedores";
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
import { Loader2, Sparkles, CheckCircle2, Users, Link2, WifiOff, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Lead } from "@/hooks/useLeads";

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
  /** Rótulo do acolhedor — derivado do perfil escolhido, nunca digitado à mão. */
  acolhedor: string;
  /** Acolhedor de verdade. É este que o push de mensagem nova usa. */
  acolhedor_user_id: string;
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
  lead_title: '', acolhedor: '', acolhedor_user_id: '', case_type: '', damage: '', dynamics_summary: '',
  news_link: '', city: '', state: '', visit_city: '', visit_state: '', visit_region: '',
  visit_address: '', accident_date: '', damage_description: '', victim_name: '',
  victim_age: '', accident_address: '', contractor_company: '', main_company: '',
  sector: '', company_size_justification: '', liability_type: '', liability_justification: '',
};

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

// Sequência e nº livre deste board — as funções genéricas vivem em
// leadWhatsappGroupFlow (compartilhadas com o "Adicionar Lead" dos funis).
const suggestNextSequence = () => suggestNextSequenceForBoard(TRABALHISTA_BOARD_ID, 'LEAD');
const nextFreeLeadNumber = (desired: number) => nextFreeLeadNumberForBoard(TRABALHISTA_BOARD_ID, desired);

interface Props {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persiste updates no lead (mesmo caminho do resto da página). */
  saveLead: (leadId: string, updates: Partial<Lead>) => Promise<void>;
  /** Chamado após cadastro concluído para a página recarregar a lista. */
  onRegistered: () => void;
}

const ALLOWED_ACOLHEDOR_IDS = [
  'f36dd4d0-b79f-42f8-8d56-8d566c25c8fc', // Analyne Sousa de Oliveira
  'e2de0610-7a9b-44aa-b893-3d91293ed700', // Luiz Ricardo
  '70200def-0910-4399-8a5e-0a27a02c5514', // Bruno Wenner Dantas Nunes
  '01f77785-871a-4a2f-b237-2392c2cb7860', // Juliana Clara Santos Pimentel
  'fab3461c-d1ca-4276-946a-972bf0c70cd9', // Mateus Santos Saraiva
];

export function CadastrarCasoViavelDialog({ lead, open, onOpenChange, saveLead, onRegistered }: Props) {
  const { profile, user } = useAuth();
  const profiles = useProfilesList();
  const allowedProfiles = useMemo(
    () => profiles.filter((p) => ALLOWED_ACOLHEDOR_IDS.includes(p.user_id)),
    [profiles]
  );
  const defaultAcolhedorId = useMemo(() => {
    const analyne = allowedProfiles.find((p) => p.user_id === 'f36dd4d0-b79f-42f8-8d56-8d566c25c8fc');
    return analyne?.user_id || '';
  }, [allowedProfiles]);

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
  const [groupNameInput, setGroupNameInput] = useState('');
  const groupNameTouched = useRef(false);
  const [authorInstanceId, setAuthorInstanceId] = useState(DEFAULT_GROUP_AUTHOR_INSTANCE_ID);
  // Status de conexão das instâncias (para bloquear autor offline antes de criar o grupo).
  const [connList, setConnList] = useState<Array<{ id: string; instance_name: string; connected: boolean }>>([]);
  const [connLoading, setConnLoading] = useState(false);
  const [showCreatorPicker, setShowCreatorPicker] = useState(false);
  const connMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of connList) m[r.id] = r.connected;
    return m;
  }, [connList]);

  // Consulta o status de conexão (WhatsApp) de todas as instâncias via edge
  // check-whatsapp-status → [{ id, instance_name, connected, status_raw }].
  const fetchConnStatus = useCallback(async () => {
    setConnLoading(true);
    try {
      const rows = await fetchInstanceConnStatus();
      setConnList(rows);
      return rows;
    } finally {
      setConnLoading(false);
    }
  }, []);

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
    groupNameTouched.current = false;
    setAuthorInstanceId(DEFAULT_GROUP_AUTHOR_INSTANCE_ID);
    setShowCreatorPicker(false);
    fetchConnStatus();
    setNewsText('');
    setNewsUrl(String((lead as any).news_link || (lead as any).news_links?.[0] || ''));
    setGroupLink(String((lead as any).group_link || ''));
    setSteps({ save: 'idle', group: 'idle', link: 'idle' });
    const l = lead as any;
    // Pré-seleção por user_id. O acolhedor_user_id do lead manda; se ele ainda
    // não tem (lead antigo), cai no padrão. Não se tenta mais adivinhar a pessoa
    // pelo texto do campo.
    const initialAcolhedorId =
      (l.acolhedor_user_id && allowedProfiles.some((p) => p.user_id === l.acolhedor_user_id))
        ? String(l.acolhedor_user_id)
        : defaultAcolhedorId;
    const initialProfile = allowedProfiles.find((p) => p.user_id === initialAcolhedorId);
    const initial: CasoForm = {
      ...EMPTY_FORM,
      acolhedor_user_id: initialAcolhedorId,
      acolhedor: initialProfile?.full_name || initialProfile?.email || '',
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
    const parts = [`LEAD${seqNumber || '?'}`];
    if (local) parts.push(local);
    const vs = [form.victim_name.trim(), form.main_company.trim()].filter(Boolean).join(' x ');
    if (vs) parts.push(vs);
    if (form.accident_date) parts.push(formatISOToBR(form.accident_date));
    return parts.join(' | ');
  }, [form, seqNumber]);

  // Enquanto o usuário não editar o nome do grupo, mantemos ele sincronizado
  // com a prévia. Depois de qualquer edição manual, o input passa a mandar.
  useEffect(() => {
    if (!groupNameTouched.current) setGroupNameInput(groupNamePreview);
  }, [groupNamePreview]);

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
    // Guarda-rails: sem esses campos o nome do grupo sai como "LEAD N | | x |"
    // e a descrição perde as linhas essenciais (vítima, idade, dano, cidade/UF).
    const faltando: string[] = [];
    if (!form.victim_name.trim()) faltando.push('Nome da Vítima');
    if (!form.main_company.trim() && !form.contractor_company.trim()) faltando.push('Empresa (Tomadora ou Terceirizada)');
    if (!form.city.trim() || !form.state.trim()) faltando.push('Cidade/UF do acidente');
    if (!form.accident_date) faltando.push('Data do Acidente');
    if (!form.damage.trim()) faltando.push('Dano');
    if (faltando.length > 0) {
      toast.error('Preencha antes de cadastrar', {
        description: `Sem esses campos o grupo sai com título/descrição incompletos: ${faltando.join(', ')}.`,
        duration: 8000,
      });
      return;
    }

    // Guard de conexão: se a instância-autor escolhida estiver offline, abre o
    // seletor de outra instância criadora antes de qualquer escrita. Status
    // desconhecido (fetch falhou) → segue e deixa o backend resolver/enfileirar.
    let rows = connList;
    if (!rows.length) rows = await fetchConnStatus();
    const selected = rows.find((r) => r.id === authorInstanceId);
    if (selected && !selected.connected) {
      setShowCreatorPicker(true);
      return;
    }

    await proceedRegister(authorInstanceId);
  };

  const proceedRegister = async (creatorInstanceId: string) => {
    if (!lead) return;
    setRegistering(true);
    setSteps({ save: 'running', group: 'idle', link: 'idle' });

    // Passo 1 — persistir o lead (status entra no Kanban como "recepcao")
    const notesExtra = form.liability_justification.trim()
      ? `Justificativa da responsabilidade (IA): ${form.liability_justification.trim()}`
      : '';
    // Resolve o lead_number livre antes de salvar, para evitar colisão com
    // a unique constraint (product_id, lead_number).
    let resolvedSeq = Number(seqNumber) > 0 ? Number(seqNumber) : 0;
    if (resolvedSeq > 0) {
      try {
        const free = await nextFreeLeadNumber(resolvedSeq);
        if (free !== resolvedSeq) {
          resolvedSeq = free;
          setSeqNumber(String(free));
        }
      } catch { /* tenta salvar mesmo assim */ }
    }
    const updates: Partial<Lead> = {
      lead_name: form.lead_title.trim(),
      status: FIRST_KANBAN_STAGE,
      source: 'Internet',
      acolhedor: form.acolhedor || null,
      acolhedor_user_id: form.acolhedor_user_id || null,
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
      // Sincroniza o nº do lead (usado por regenerate-lead-name p/ renomear grupo).
      ...(resolvedSeq > 0 ? { lead_number: resolvedSeq } : {}),
      ...(notesExtra ? { notes: [((lead as any).notes || '').trim(), notesExtra].filter(Boolean).join('\n\n') } : {}),
    } as any;

    const trySave = async (attempt: number): Promise<void> => {
      try {
        await saveLead(lead.id, updates);
      } catch (e: any) {
        const msg = String(e?.message || '');
        const isDup = /leads_product_lead_number_uniq|duplicate key/i.test(msg);
        if (isDup && attempt < 8) {
          // Relê a sequência real da base a cada colisão — o "+1 local" não basta
          // quando várias abas / operadores cadastram em paralelo.
          let next = resolvedSeq + 1;
          try {
            const suggested = await suggestNextSequence();
            if (suggested && suggested > next) next = suggested;
            next = await nextFreeLeadNumber(next);
          } catch { /* segue com next simples */ }
          resolvedSeq = next;
          setSeqNumber(String(next));
          (updates as any).lead_number = next;
          return trySave(attempt + 1);
        }
        throw e;
      }
    };


    try {
      await trySave(1);
      setSteps((s) => ({ ...s, save: 'done', group: 'running' }));
    } catch (e: any) {
      setSteps((s) => ({ ...s, save: 'error' }));
      toast.error('Falha ao salvar o lead', { description: e?.message });
      setRegistering(false);
      return;
    }

    // Passos 2 a 4 — criar grupo, obter link de convite e postar o resumo.
    // (nome sequencial "LEAD N | ..." vem do board_group_settings)
    const outcome = await createLeadWhatsappGroup({
      leadId: lead.id,
      leadName: form.lead_title.trim(),
      boardId: TRABALHISTA_BOARD_ID,
      creationOrigin: 'noticia_viavel',
      creatorInstanceId,
      forcedSequence: resolvedSeq > 0 ? resolvedSeq : null,
      groupNameOverride: groupNameInput.trim() || null,
      introMessage: (inviteLink) => composeGroupIntroMessage(form, inviteLink),
      onStep: (step, state) => {
        if (step === 'group') setSteps((s) => ({ ...s, group: state === 'error' ? 'error' : state }));
        if (step === 'link') setSteps((s) => ({ ...s, link: state === 'error' ? 'error' : state }));
      },
    });

    if (outcome.queued) {
      toast.info('Lead cadastrado. Instâncias offline: grupo entrou na fila e será criado automaticamente.', { duration: 8000 });
      onRegistered();
      onOpenChange(false);
      setRegistering(false);
      return;
    }
    if (outcome.groupError) {
      toast.error('Lead cadastrado, mas a criação do grupo falhou', { description: outcome.groupError, duration: 8000 });
      onRegistered();
      setRegistering(false);
      return;
    }
    if (outcome.linkError) {
      toast.warning('Grupo criado, mas não foi possível obter o link de convite agora.', { description: outcome.linkError, duration: 8000 });
    } else {
      setGroupLink(outcome.inviteLink);
      toast.success('Caso cadastrado, grupo criado e link salvo no lead.');
    }
    if (outcome.introError) {
      toast.warning('Grupo criado, mas não consegui enviar o resumo automático.', { description: outcome.introError });
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

  const selectedAuthorLabel =
    GROUP_AUTHOR_OPTIONS.find((a) => a.instanceId === authorInstanceId)?.label ||
    connList.find((r) => r.id === authorInstanceId)?.instance_name ||
    'Instância selecionada';
  const connectedInstances = connList.filter((r) => r.connected);

  return (
    <>
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
            <Label>Autor do grupo</Label>
            <Select value={authorInstanceId} onValueChange={setAuthorInstanceId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {GROUP_AUTHOR_OPTIONS.map((a) => {
                  const conn = connMap[a.instanceId];
                  return (
                    <SelectItem key={a.instanceId} value={a.instanceId}>
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            conn === true ? 'bg-emerald-500' : conn === false ? 'bg-red-500' : 'bg-muted-foreground/40'
                          }`}
                          title={conn === true ? 'Conectada' : conn === false ? 'Desconectada' : 'Status desconhecido'}
                        />
                        {a.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {connMap[authorInstanceId] === false && (
              <p className="text-xs text-red-600 mt-1">
                Instância desconectada — ao cadastrar você escolhe outra criadora do grupo.
              </p>
            )}
          </div>
          <div>
            <Label>Acolhedor</Label>
            {/* O valor do item é o user_id, nunca o nome. Antes era
                `p.full_name || p.email || p.id`, e esse || em cascata gravava
                três formatos diferentes na mesma coluna conforme o que o perfil
                tivesse preenchido — foi o que espalhou 56 grafias para ~25
                pessoas, incluindo e-mails e um UUID cru. O texto agora é só
                rótulo derivado da escolha. */}
            {allowedProfiles.length > 0 ? (
              <Select
                value={form.acolhedor_user_id}
                onValueChange={(uid) => {
                  const p = allowedProfiles.find((x) => x.user_id === uid);
                  set({ acolhedor_user_id: uid, acolhedor: p?.full_name || p?.email || '' });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {allowedProfiles.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              // Sem campo livre de propósito: texto digitado à mão é exatamente o
              // que sujava a coluna.
              <p className="text-xs text-muted-foreground border rounded-md px-3 py-2">
                Nenhum acolhedor disponível para seleção. Cadastre a pessoa em
                Gestão de Equipe antes de registrar o caso.
              </p>
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
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Nome do grupo (editável)</Label>
            <Input
              value={groupNameInput}
              onChange={(e) => { groupNameTouched.current = true; setGroupNameInput(e.target.value); }}
              placeholder="Nome exato do grupo do WhatsApp"
            />
            <p className="text-[11px] text-muted-foreground">
              Este é o único parâmetro usado ao criar o grupo. Pré-preenchido com os dados do lead — edite se quiser.
            </p>
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

    {/* Seletor de instância criadora — abre quando o autor escolhido está offline */}
    <Dialog open={showCreatorPicker} onOpenChange={(v) => !registering && setShowCreatorPicker(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WifiOff className="h-5 w-5 text-red-500" />
            Instância criadora offline
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{selectedAuthorLabel}</span> está desconectada e não pode
            criar o grupo. Escolha outra instância conectada para ser a criadora/dona do grupo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {connLoading ? 'Verificando conexões...' : `${connectedInstances.length} instância(s) conectada(s)`}
          </span>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => fetchConnStatus()} disabled={connLoading}>
            <RefreshCw className={`h-3 w-3 ${connLoading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>

        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {connectedInstances.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={registering}
              onClick={() => { setAuthorInstanceId(r.id); setShowCreatorPicker(false); proceedRegister(r.id); }}
              className="w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              {r.instance_name}
            </button>
          ))}
          {connectedInstances.length === 0 && !connLoading && (
            <p className="text-sm text-muted-foreground">
              Nenhuma instância conectada no momento. Ao cadastrar mesmo assim, o grupo entra na fila
              e é criado automaticamente quando uma instância reconectar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreatorPicker(false)} disabled={registering}>Cancelar</Button>
          <Button
            variant="secondary"
            disabled={registering}
            onClick={() => { setShowCreatorPicker(false); proceedRegister(authorInstanceId); }}
          >
            Cadastrar mesmo assim (fila)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

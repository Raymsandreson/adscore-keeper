import { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef, lazy, Suspense } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { DashboardChatPreview } from '@/components/whatsapp/DashboardChatPreview';
import { WhatsAppAvatar } from '@/components/whatsapp/WhatsAppAvatar';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import type { Lead } from '@/hooks/useLeads';
import { useContacts, Contact } from '@/hooks/useContacts';
import { ContactDetailSheet } from './ContactDetailSheet';
import { CreateContactDialog } from './CreateContactDialog';
import { DuplicateContactsScanDialog } from './DuplicateContactsScanDialog';
import { ContactPendencyBadge } from './ContactPendencyBadge';
import { ContactActivityBadge } from './ContactActivityBadge';
import { ContactsDistributionDonuts } from './ContactsDistributionDonuts';
import { ContactsCreationTrendBars, type CreationPeriodSelection } from './ContactsCreationTrendBars';
import { ClassificationFilterSelect, type ClassificationFilterMode } from './ClassificationFilterSelect';
import { ClassificationContactsSheet } from './ClassificationContactsSheet';
import { useContactsPendencies } from '@/hooks/useContactsPendencies';
import { useContactsActivities } from '@/hooks/useContactsActivities';
import { useContactsLinks, EMPTY_CONTACT_LINKS } from '@/hooks/useContactsLinks';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { useBroadcastLists, BroadcastList, BroadcastListMember } from '@/hooks/useBroadcastLists';
import { supabase } from '@/integrations/supabase/client';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { invalidateGroupLeadCache } from '@/integrations/supabase/group-lead-links';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
// (Removido Tabs do Radix — usando renderização condicional simples)
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Search, Users, Send, Plus, Trash2, Radio, UserPlus,
  Phone, Loader2, X, ImagePlus, Bot, BotOff, Filter, UsersRound, Wand2, Info,
  SlidersHorizontal, ArrowDownAZ, ArrowUpAZ, AlertTriangle, CheckCircle2, ClipboardCheck, MessageCircle, MapPin, Pencil, Link2, RefreshCw,
  Briefcase, Scale, CalendarDays
} from 'lucide-react';

import { cloudFunctions } from '@/lib/functionRouter';

// O caso vinculado abre por cima da lista, e a tela de processo é das mais
// pesadas do sistema — só carrega quando alguém clica na etiqueta.
const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));

/**
 * Teto das etiquetas por linha (pendências, atividades, lead/caso). A lista
 * carrega até 5.000 contatos de uma vez; consultar tudo isso a cada filtro
 * derrubaria a tela. Acima do teto as primeiras linhas continuam etiquetadas e
 * um aviso explica que as demais não estão.
 */
const ENRICH_LIMIT = 300;

const PARTY_ROLE_LABELS: Record<string, string> = {
  autor: 'Autor',
  reu: 'Réu',
  advogado: 'Advogado',
};

/**
 * Processo de cada grupo do WhatsApp, vindo de `vw_grupo_processo_conciliacao`
 * (Supabase externo). O nome do grupo carrega o nº do caso ("Caso 88 - ...") e é
 * por ele que a jurimetria acha o CNJ — os grupos são a única ponte que existe
 * hoje para os processos que não têm lead nem caso cadastrado.
 *
 * Casa SÓ PELO INTEIRO (decisão do Raym, 17/08/2026): "Caso 10.1" e "Caso 11.1"
 * usam o sufixo para OUTRA parte/processo do mesmo caso, então casar com o
 * sufixo juntaria pessoas diferentes.
 *
 * `cnj_do_lead`   → o grupo já tem lead com processo cadastrado (ficha existe).
 * `cnj_sugerido`  → a jurimetria tem processo com esse nº de caso e NINGUÉM
 *                   cadastrou ficha ainda. É sugestão, não vínculo.
 * `qtd_sugerida>1`→ ambíguo: o mesmo nº de caso aponta para mais de um CNJ.
 *                   Nunca vincular automático — precisa de gente decidindo.
 */
interface GrupoProcesso {
  group_jid: string;
  cnj_do_lead: string | null;
  cnj_sugerido: string | null;
  sugestao_detalhe: string | null;
  qtd_sugerida: number;
  so_na_jurimetria: boolean;
}

/** Só os dígitos: CNJ é escrito com e sem pontuação em todo lugar. */
const soDigitos = (s: string | null | undefined) => (s || '').replace(/\D/g, '');

export function ContactsListPage() {
  const navigate = useNavigate();
  const [chatPreview, setChatPreview] = useState<{ phone: string; instance_name: string | null; contact_name: string | null } | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [loadingLeadForGroup, setLoadingLeadForGroup] = useState<string | null>(null);
  const [showDuplicatesScan, setShowDuplicatesScan] = useState(false);
  const [editCaseDialog, setEditCaseDialog] = useState<{ leadId: string; groupJid: string; currentNumber: string; currentName: string } | null>(null);
  const [editCaseValue, setEditCaseValue] = useState('');
  const [editCaseSaving, setEditCaseSaving] = useState(false);
  // Vincular lead a um grupo "sem vínculo".
  // `cnjPendente`: quando o vínculo veio pelo botão de processo da coluna
  // Processo, o CNJ fica guardado aqui e a ficha é cadastrada logo depois que o
  // lead entra — todos os 131 processos que a jurimetria acha por nº de caso
  // estão em grupo SEM lead, então "vincular processo" sem passar pelo lead
  // antes não existe na prática.
  const [linkDialog, setLinkDialog] = useState<{ groupJid: string; groupName: string | null; cnjPendente?: string } | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkResults, setLinkResults] = useState<Array<{ id: string; lead_name: string | null; case_number: string | null; lead_number: number | null; lead_status: string | null }>>([]);
  const [linking, setLinking] = useState<string | null>(null);

  // Auto-busca de leads no diálogo de vínculo (com debounce + busca por telefone via contatos)
  useEffect(() => {
    if (!linkDialog) return;
    const q = linkQuery.trim();
    if (q.length < 2) { setLinkResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLinkSearching(true);
      try {
        const digits = q.replace(/\D/g, '');
        const isNum = /^\d+$/.test(q);
        const acc = new Map<string, any>();

        // 1) Busca direta em leads (nome, nº lead, nº caso, telefone)
        {
          let query = externalSupabase
            .from('leads')
            .select('id, lead_name, case_number, lead_number, lead_status, lead_phone')
            .limit(20);
          if (isNum) {
            query = query.or(`case_number.eq.${q},lead_number.eq.${q},lead_phone.ilike.%${q}%`);
          } else if (digits.length >= 4) {
            query = query.or(`lead_name.ilike.%${q}%,lead_phone.ilike.%${digits}%`);
          } else {
            query = query.ilike('lead_name', `%${q}%`);
          }
          const { data } = await query;
          (data || []).forEach((l: any) => acc.set(l.id, l));
        }

        // 2) Se parece telefone, procura contatos por phone e puxa os leads vinculados
        if (digits.length >= 4) {
          const { data: cts } = await externalSupabase
            .from('contacts')
            .select('lead_id, phone, full_name')
            .ilike('phone', `%${digits}%`)
            .not('lead_id', 'is', null)
            .limit(20);
          const ids = Array.from(new Set((cts || []).map((c: any) => c.lead_id).filter(Boolean)));
          if (ids.length) {
            const { data: extra } = await externalSupabase
              .from('leads')
              .select('id, lead_name, case_number, lead_number, lead_status, lead_phone')
              .in('id', ids);
            (extra || []).forEach((l: any) => { if (!acc.has(l.id)) acc.set(l.id, l); });
          }
        }

        if (!cancelled) setLinkResults(Array.from(acc.values()) as any);
      } catch (err: any) {
        if (!cancelled) toast.error('Erro na busca: ' + err.message);
      } finally {
        if (!cancelled) setLinkSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [linkQuery, linkDialog]);

  const handleDeleteGroup = async (jid: string, name: string | null) => {
    if (!jid) return;
    const ok = window.confirm(`Excluir o grupo "${name || jid}" da lista?\n\nIsso remove o cache do grupo e o vínculo com lead (se houver). A conversa no WhatsApp não é afetada.`);
    if (!ok) return;
    try {
      await externalSupabase.from('lead_whatsapp_groups').delete().eq('group_jid', jid);
      invalidateGroupLeadCache(jid);
      await externalSupabase.from('whatsapp_groups_cache').delete().eq('group_jid', jid);
      setGroups(prev => prev.filter(g => g.group_jid !== jid));
      toast.success('Grupo removido da lista');
    } catch (err: any) {
      console.error('handleDeleteGroup error:', err);
      toast.error('Falha ao excluir: ' + (err?.message || 'erro'));
    }
  };

  const [refreshingDateFor, setRefreshingDateFor] = useState<Set<string>>(new Set());
  const instancePhoneMapRef = useRef<Map<string, string>>(new Map());
  const normalizeOwnerPhone = (value: unknown): string | null => {
    const digits = String(value || '').split('@')[0].replace(/\D/g, '');
    return digits || null;
  };

  const resolveInstanceNameByPhone = (phone: string | null): string | null => {
    if (!phone) return null;
    const map = instancePhoneMapRef.current;
    if (map.has(phone)) return map.get(phone) || null;
    // Fallback por últimos 8 dígitos (DDI/9º dígito podem divergir entre fontes).
    const tail = phone.slice(-8);
    if (tail.length >= 8) {
      for (const [ph, nm] of map.entries()) {
        if (ph.slice(-8) === tail) return nm;
      }
    }
    return null;
  };

  const applyGroupCreationPayload = (jid: string, data: any) => {
    const iso: string | null = data?.creation_iso || data?.creation_date || null;
    const ownerPhone = normalizeOwnerPhone(data?.owner_pn);
    const creatorInstance: string | null =
      (data?.creator_instance_name ? String(data.creator_instance_name) : null)
      || resolveInstanceNameByPhone(ownerPhone);
    setGroups(prev => prev.map(g => g.group_jid === jid ? {
      ...g,
      ...(iso ? { created_at: iso } : {}),
      ...(ownerPhone ? { owner_phone: ownerPhone } : {}),
      ...(creatorInstance ? { creator_instance_name: creatorInstance } : {}),
    } : g));
    return { iso, ownerPhone, creatorInstance };
  };

  const handleRefreshCreationDate = async (jid: string, instanceName?: string | null) => {
    if (!jid) return;
    setRefreshingDateFor(prev => { const n = new Set(prev); n.add(jid); return n; });
    try {
      const { data, error } = await cloudFunctions.invoke<any>('fetch-group-creation-date', {
        body: { group_jid: jid, instance_name: instanceName || undefined },
      });
      if (error) throw error;
      if (!data?.success) {
        toast.error(data?.error || 'Não foi possível buscar a data');
        return;
      }
      const { iso, ownerPhone } = applyGroupCreationPayload(jid, data);
      if (!iso && !ownerPhone) {
        toast.warning('Grupo encontrado, mas a UazAPI não retornou data nem criador');
        return;
      }
      fetchGroups({ silent: true });
      toast.success(ownerPhone ? 'Data/criador atualizados' : 'Data atualizada');
    } catch (err: any) {
      console.error('handleRefreshCreationDate error:', err);
      toast.error('Falha: ' + (err?.message || 'erro'));
    } finally {
      setRefreshingDateFor(prev => { const n = new Set(prev); n.delete(jid); return n; });
    }
  };

  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; ok: number; fail: number } | null>(null);
  const bulkCancelRef = useRef(false);
  const handleBulkRefreshCreationDates = async (jids: string[]) => {
    if (!jids.length) { toast.info('Nenhum grupo sem data ou criador para atualizar'); return; }
    if (!confirm(`Atualizar data/criador de ${jids.length} grupo(s)? Pode levar alguns minutos.`)) return;
    bulkCancelRef.current = false;
    setBulkRefreshing(true);
    setBulkProgress({ done: 0, total: jids.length, ok: 0, fail: 0 });
    const CONCURRENCY = 3;
    let idx = 0; let ok = 0; let fail = 0; let missingInstance = 0;
    const worker = async () => {
      while (idx < jids.length && !bulkCancelRef.current) {
        const my = idx++;
        const jid = jids[my];
        setRefreshingDateFor(prev => { const n = new Set(prev); n.add(jid); return n; });
        try {
          const group = groups.find(g => g.group_jid === jid);
          const { data, error } = await cloudFunctions.invoke<any>('fetch-group-creation-date', { body: { group_jid: jid, instance_name: group?.instance_name || undefined } });
          if (error || !data?.success) { fail++; }
          else {
            const { iso, ownerPhone, creatorInstance } = applyGroupCreationPayload(jid, data);
            if (iso || ownerPhone) {
              ok++;
              // Validação: criador identificado mas instância não foi resolvida
              // (telefone fora do mapa atual de instâncias). Contabiliza pra avisar.
              if (ownerPhone && !creatorInstance) missingInstance++;
            }
            else { fail++; }
          }
        } catch { fail++; }
        finally {
          setRefreshingDateFor(prev => { const n = new Set(prev); n.delete(jid); return n; });
          setBulkProgress({ done: my + 1, total: jids.length, ok, fail });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jids.length) }, worker));
    setBulkRefreshing(false);
    fetchGroups({ silent: true });
    if (bulkCancelRef.current) toast.warning(`Cancelado: ${ok} atualizados, ${fail} falharam`);
    else {
      toast.success(`Concluído: ${ok} atualizados, ${fail} falharam`);
      if (missingInstance > 0) {
        toast.warning(`${missingInstance} grupo(s) com criador fora do mapa de instâncias atuais (exibido só o telefone).`);
      }
    }
    setTimeout(() => setBulkProgress(null), 4000);
  };

  const openGroupChat = (jid: string) => {
    if (!jid) return;
    const g = groups.find(x => x.group_jid === jid);
    setChatPreview({
      phone: jid,
      // Não filtrar por instance_name: o JID do grupo é global e algumas
      // instâncias registram o mesmo grupo com case diferente. Filtrar
      // estava escondendo conversas inteiras (ex.: Prev 06).
      instance_name: null,
      contact_name: g?.group_name || null,
    });
  };
  const openGroupLead = async (jid: string) => {
    if (!jid) return;
    const g = groups.find(x => x.group_jid === jid);
    if (!g?.lead_id) {
      // Sem lead vinculado → cai para a conversa do grupo.
      openGroupChat(jid);
      return;
    }
    setLoadingLeadForGroup(jid);
    try {
      const { data, error } = await externalSupabase
        .from('leads')
        .select('*')
        .eq('id', g.lead_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error('Lead vinculado não encontrado.');
        return;
      }
      setEditingLead(data as Lead);
    } catch (err: any) {
      console.error('openGroupLead error:', err);
      toast.error('Falha ao carregar lead: ' + (err?.message || 'erro'));
    } finally {
      setLoadingLeadForGroup(null);
    }
  };
  const { contacts, loading: contactsLoading, fetchContacts, totalCount, stats } = useContacts();
  const {
    lists, loading: listsLoading, createList, deleteList,
    fetchMembers, addMembers, removeMember, sendBroadcast,
  } = useBroadcastLists();

  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  /** Aba em que a ficha abre — o atalho de atividades cai direto na certa. */
  const [detailTab, setDetailTab] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('contacts');

  // Atalhos disparados de dentro da linha do contato. Tudo abre POR CIMA da
  // lista: quem clicou está no meio de uma triagem e perderia os filtros se
  // fosse mandado para outra página.
  const [classificationSheet, setClassificationSheet] = useState<{ name: string; color?: string } | null>(null);
  const [processToOpen, setProcessToOpen] = useState<any | null>(null);
  /** Qual etiqueta está buscando o registro completo (trava só aquele botão). */
  const [loadingShortcut, setLoadingShortcut] = useState<string | null>(null);
  /** Profissão em foco (clique na rosca). `undefined` = sem filtro, `null` = sem profissão. */
  const [professionFilter, setProfessionFilter] = useState<string | null | undefined>(undefined);

  const { classificationConfig, classifications: classificationOptions } = useContactClassifications();

  // Filter states
  const [cityFilter, setCityFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [createdByFilter, setCreatedByFilter] = useState('all');
  /** Vazio = todos. Vários relacionamentos ao mesmo tempo; `mode` diz se é união ou interseção. */
  const [classificationFilter, setClassificationFilter] = useState<string[]>([]);
  const [classificationMode, setClassificationMode] = useState<ClassificationFilterMode>('any');
  const [groupFilter, setGroupFilter] = useState<'all' | 'with_group' | 'without_group'>('all');
  const [leadLinkedFilter, setLeadLinkedFilter] = useState<'all' | 'linked' | 'not_linked'>('all');
  // Recorte vindo do clique numa barra de "Cadastros por período".
  const [periodFilter, setPeriodFilter] = useState<CreationPeriodSelection | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  
  // Filter options loaded from DB
  const [filterOptions, setFilterOptions] = useState<{
    states: string[];
    cities: string[];
    creators: { id: string; name: string }[];
  }>({ states: [], cities: [], creators: [] });
  
  // Broadcast list dialogs
  const [showCreateList, setShowCreateList] = useState(false);
  const [showCreateContact, setShowCreateContact] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [viewingList, setViewingList] = useState<BroadcastList | null>(null);
  const [listMembers, setListMembers] = useState<BroadcastListMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Send dialog
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [sendInstanceId, setSendInstanceId] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFromList, setSendFromList] = useState<BroadcastList | null>(null);
  const [sendMediaFile, setSendMediaFile] = useState<File | null>(null);
  const [sendMediaPreview, setSendMediaPreview] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Agent assignment state
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [listAgentMap, setListAgentMap] = useState<Record<string, { agent_id: string; agent_name: string; is_active: boolean }>>({});
  const [classifyingClients, setClassifyingClients] = useState(false);

  // Groups data
  const [groups, setGroups] = useState<{ group_jid: string; group_name: string; lead_name: string; lead_status: string; lead_id: string | null; contact_count: number; instance_name: string | null; created_at: string | null; lead_created_at: string | null; board_id: string | null; board_name: string | null; case_number: string | null; lead_number: number | null; product_case_prefix: string | null; product_service_id: string | null; owner_phone: string | null; creator_instance_name: string | null }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsLastUpdatedAt, setGroupsLastUpdatedAt] = useState<Date | null>(null);
  const [groupsRefreshingSilently, setGroupsRefreshingSilently] = useState(false);
  // Fallback lookups para nome do criador do grupo (cascata: lead → push_name)
  // Chave de leadNameByPhoneTail = últimos 8 dígitos do telefone (cobre +55/0/sem DDI)
  // Chave de pushNameByPhone = telefone completo (formato igual a whatsapp_messages.phone)
  const [creatorLeadNameByPhoneTail, setCreatorLeadNameByPhoneTail] = useState<Map<string, string>>(new Map());
  const [creatorPushNameByPhone, setCreatorPushNameByPhone] = useState<Map<string, string>>(new Map());
  const [groupSearch, setGroupSearch] = useState('');
  const deferredGroupSearch = useDeferredValue(groupSearch);
  const [groupSort, setGroupSort] = useState<'alpha' | 'number' | 'prefix' | 'date'>('date');
  const [groupSortDir, setGroupSortDir] = useState<'asc' | 'desc'>('desc');
  const [groupSearchScope, setGroupSearchScope] = useState<'group' | 'lead'>('group');
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set());
  const [showGroupFilters, setShowGroupFilters] = useState(false);
  const [auditMode, setAuditMode] = useState(true);
  const [auditOnlyMismatch, setAuditOnlyMismatch] = useState(false);
  /** Só os grupos cujo processo existe na jurimetria e ainda não tem ficha. */
  const [auditOnlySemFicha, setAuditOnlySemFicha] = useState(false);
  const [leadStatusFilter, setLeadStatusFilter] = useState<Set<string>>(new Set());
  const [leadLinkFilter, setLeadLinkFilter] = useState<'all' | 'with' | 'without'>('all');
  const [boardFilter, setBoardFilter] = useState<Set<string>>(new Set());
  const [availableBoards, setAvailableBoards] = useState<{ id: string; name: string }[]>([]);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [creatorFilter, setCreatorFilter] = useState<string>('all');
  // Larguras das colunas do modo auditoria (estilo planilha — usuário arrasta o limite direito)
  const [auditColW, setAuditColW] = useState<Record<string, number>>({
    check: 36, leadN: 90, caseN: 70, groupName: 280, leadName: 220, processo: 190, createdAt: 130, createdBy: 220, actions: 60,
  });
  // Filtros por coluna (texto livre, "contém") — estilo Google Sheets
  const [auditColFilter, setAuditColFilter] = useState<Record<string, string>>({
    leadN: '', caseN: '', groupName: '', leadName: '', processo: '', createdAt: '', createdBy: '',
  });
  /** group_jid → processo (ver GrupoProcesso). Vazio até a aba Grupos abrir. */
  const [grupoProcesso, setGrupoProcesso] = useState<Map<string, GrupoProcesso>>(new Map());
  /** Confirmação de "cadastrar a ficha deste processo" — nunca automático. */
  const [vincProcesso, setVincProcesso] = useState<{
    groupJid: string; groupName: string | null; leadId: string; cnj: string; detalhe: string | null;
  } | null>(null);
  const [vinculandoProcesso, setVinculandoProcesso] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupContacts, setGroupContacts] = useState<Contact[]>([]);
  const [groupContactsLoading, setGroupContactsLoading] = useState(false);

  useEffect(() => {
    fetchAgentsAndAssignments();
    fetchGroups();
  }, []);

  // Processo de cada grupo. Carrega uma vez, quando a aba Grupos abre: são 224
  // linhas (uma por grupo com "Caso N" no nome), não vale carregar junto com a
  // lista de contatos. A view já entrega o grão certo — um grupo por linha.
  useEffect(() => {
    if (activeTab !== 'groups' || grupoProcesso.size > 0) return;
    let cancelado = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data, error } = await (db as any)
          .from('vw_grupo_processo_conciliacao')
          .select('group_jid, cnj_do_lead, cnj_sugerido, sugestao_detalhe, qtd_sugerida, so_na_jurimetria');
        if (cancelado || error || !data) return;
        setGrupoProcesso(new Map((data as GrupoProcesso[]).map(r => [r.group_jid, r])));
      } catch (e) {
        // Falha aqui não pode derrubar a aba: a coluna simplesmente fica vazia.
        console.error('[ContactsListPage] conciliação grupo→processo falhou', e);
      }
    })();
    return () => { cancelado = true; };
  }, [activeTab, grupoProcesso.size]);

  /**
   * Cadastra a ficha em `lead_processes` a partir do processo da jurimetria.
   * Escreve em produção e propaga para caso/partes — por isso nunca roda sozinha:
   * quem chama é o diálogo de confirmação, uma linha por vez, e o botão fica
   * bloqueado quando o nº do caso aponta para mais de um CNJ.
   *
   * Só copia o que a jurimetria realmente sabe. Classe, assunto, valor da causa e
   * envolvidos ficam vazios de propósito: quem preenche isso é o Escavador,
   * depois, e chutar aqui viraria dado errado com cara de dado bom.
   */
  const cadastrarProcessoDoGrupo = useCallback(async (leadId: string, cnj: string): Promise<boolean> => {
    const numero = cnj.split(',')[0].trim();
    // Corrida: entre a view ter sido carregada e o clique, alguém pode ter
    // cadastrado. Confere no momento da escrita, não no da leitura.
    const { data: jaTem } = await db
      .from('lead_processes').select('id').eq('process_number', numero)
      .is('deleted_at', null).limit(1).maybeSingle();
    if (jaTem) { toast.error('Este processo já tem ficha cadastrada.'); return false; }

    const { data: jm } = await (db as any)
      .from('jm_processos')
      .select('processo_cnj, caso, empresa, uf_proc, cidade_proc, data_protocolo, natureza')
      .eq('processo_cnj', numero).maybeSingle();

    const j = jm as {
      caso?: string | null; empresa?: string | null; uf_proc?: string | null;
      cidade_proc?: string | null; data_protocolo?: string | null; natureza?: string | null;
    } | null;
    const titulo = j?.empresa
      ? `${j.caso ? `Caso ${j.caso} — ` : ''}${j.empresa}`
      : `Processo ${numero}`;
    // Ano vem do próprio CNJ (posições 10-13 do padrão NNNNNNN-DD.AAAA.J.TR.OOOO),
    // que é mais confiável que a data de protocolo da planilha.
    const ano = Number(numero.replace(/\D/g, '').slice(9, 13)) || null;

    const { error } = await db.from('lead_processes').insert({
      lead_id: leadId,
      process_type: 'judicial',
      process_number: numero,
      title: titulo,
      status: 'em_andamento',
      polo_passivo: j?.empresa || null,
      estado_origem_sigla: j?.uf_proc || null,
      unidade_origem_cidade: j?.cidade_proc || null,
      ano_inicio: ano,
      started_at: j?.data_protocolo || null,
      notes: 'Ficha criada pela conciliação de grupos do WhatsApp (nº do caso no nome do grupo × jurimetria).',
    } as any);
    if (error) { toast.error('Falha ao cadastrar o processo: ' + error.message); return false; }

    toast.success(`Processo ${numero} cadastrado no lead.`);
    // A sugestão morreu: agora o processo tem ficha e passa a ser cnj_do_lead.
    setGrupoProcesso(prev => {
      const next = new Map(prev);
      for (const [jid, p] of next) {
        if (p.cnj_sugerido === cnj) {
          next.set(jid, { ...p, cnj_do_lead: numero, cnj_sugerido: null, so_na_jurimetria: false });
        }
      }
      return next;
    });
    return true;
  }, []);

  /**
   * Abre a ficha do processo por CNJ, por cima da lista (nunca redireciona).
   * Só funciona para processo que TEM ficha em `lead_processes` — o que só
   * existe na jurimetria não tem o que abrir ainda, e a coluna sinaliza isso.
   */
  const openProcessoPorCnj = useCallback(async (cnj: string) => {
    const primeiro = cnj.split(',')[0].trim();
    setLoadingShortcut(`cnj:${primeiro}`);
    try {
      const { data, error } = await db
        .from('lead_processes')
        .select('*')
        .eq('process_number', primeiro)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) { toast.error('Este processo ainda não tem ficha cadastrada.'); return; }
      setProcessToOpen(data);
    } catch (e) {
      console.error('Erro ao abrir processo por CNJ:', e);
      toast.error('Não consegui abrir este processo.');
    } finally {
      setLoadingShortcut(null);
    }
  }, []);

  // Enquanto a sync em massa estiver rodando, ela faz milhares de upserts nos
  // snapshots → realtime dispararia refetch a cada ~800ms e a lista "pisca".
  // Esta ref silencia o refetch do realtime durante a janela da sync.
  const syncingRef = useRef(false);

  // Auto-sync silencioso ao abrir a aba "Grupos".
  // Antes era 1x por sessão (sessionStorage) — isso fazia perder grupos
  // criados após o usuário já ter aberto a aba uma vez no dia. Agora usamos
  // um throttle por tempo (90s) gravado em localStorage: se a última sync
  // foi há mais de 90s, dispara de novo. Continua silencioso (sem spinner).
  useEffect(() => {
    if (activeTab !== 'groups') return;
    const FLAG = 'wa_groups_auto_sync_at';
    const last = Number(localStorage.getItem(FLAG) || '0');
    const THROTTLE_MS = 90_000;
    if (Date.now() - last < THROTTLE_MS) return;
    localStorage.setItem(FLAG, String(Date.now()));
    (async () => {
      syncingRef.current = true;
      setGroupsRefreshingSilently(true);
      try {
        const { error } = await supabase.functions.invoke('sync-all-whatsapp-groups', { body: {} });
        if (error) { console.warn('auto sync-all-whatsapp-groups error:', error); return; }
      } catch (e) {
        console.warn('auto sync-all-whatsapp-groups failed:', e);
      } finally {
        // Silencia +3s pra absorver realtimes atrasados, depois UM refetch
        // silencioso (sem trocar a lista por spinner).
        setTimeout(() => {
          syncingRef.current = false;
          fetchGroups({ silent: true }).finally(() => setGroupsRefreshingSilently(false));
        }, 3000);
      }
    })();
  }, [activeTab]);

  const fetchGroups = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setGroupsLoading(true);
    else setGroupsRefreshingSilently(true);
    try {
      await ensureExternalSession();
      const pageSize = 1000;
      const groupMap = new Map<string, any>();

      // 1) Fonte primária: whatsapp_groups_index (TODOS os grupos do WhatsApp
      //    capturados pela sync diária — ~4.8k grupos). Antes a tela lia só
      //    de lead_whatsapp_groups (~532), por isso aparecia bem menos.
      for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const { data: page, error } = await (externalSupabase as any)
          .from('whatsapp_groups_index')
          .select('group_jid, contact_name, last_seen, instance_name')
          .order('last_seen', { ascending: false })
          .range(from, to);
        if (error) { console.error('fetchGroups index page error:', error); break; }
        const rows = (page as any[]) || [];
        for (const r of rows) {
          if (!groupMap.has(r.group_jid)) {
          groupMap.set(r.group_jid, {
              group_jid: r.group_jid,
              group_name: r.contact_name ? String(r.contact_name).trim() : '',
              lead_name: '',
              lead_status: '',
              lead_id: null,
              contact_count: 0,
              instance_name: r.instance_name || null,
              created_at: null,
              lead_created_at: null,
              board_id: null,
              board_name: null,
              case_number: null,
              lead_number: null,
              product_case_prefix: null,
              product_service_id: null,
              owner_phone: null,
              creator_instance_name: null,
            });
          }
        }
        if (rows.length < pageSize) break;
      }

      // 2) Enriquecimento: vínculo com lead (nome + status + board). LEFT JOIN feito em JS.
      //    Também garante grupos que existem só em lead_whatsapp_groups e não no index.
      for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const { data: page, error } = await externalSupabase
          .from('lead_whatsapp_groups')
          .select('group_jid, group_name, lead_id, leads!lead_whatsapp_groups_lead_id_fkey(lead_name, lead_status, created_at, board_id, lead_number, product_service_id, case_number)')
          .order('created_at', { ascending: false })
          .range(from, to);
        if (error) { console.error('fetchGroups lwg page error:', error); break; }
        const rows = (page as any[]) || [];
        for (const g of rows) {
          const lead = g.leads as any;
          // Normaliza JID: lead_whatsapp_groups às vezes guarda sem o sufixo @g.us,
          // enquanto whatsapp_groups_index/snapshot sempre usa com sufixo.
          // Sem normalizar, o mesmo grupo aparecia duplicado na listagem.
          const rawJid = String(g.group_jid || '');
          const normJid = rawJid.includes('@') ? rawJid : `${rawJid}@g.us`;
          const existing = groupMap.get(normJid);
          if (existing) {
            if (!existing.group_name && g.group_name) existing.group_name = g.group_name;
            if (!existing.lead_name && lead?.lead_name) existing.lead_name = lead.lead_name;
            if (!existing.lead_status && lead?.lead_status) existing.lead_status = lead.lead_status;
            if (!existing.lead_id && g.lead_id) existing.lead_id = g.lead_id;
            if (!existing.lead_created_at && lead?.created_at) existing.lead_created_at = lead.created_at;
            if (!existing.board_id && lead?.board_id) existing.board_id = lead.board_id;
            if (existing.lead_number == null && lead?.lead_number != null) existing.lead_number = lead.lead_number;
            if (!existing.product_service_id && lead?.product_service_id) existing.product_service_id = lead.product_service_id;
            if (!existing.case_number && lead?.case_number) existing.case_number = String(lead.case_number);
          } else {
            groupMap.set(normJid, {
              group_jid: normJid,
              group_name: g.group_name || '',
              lead_name: lead?.lead_name || '',
              lead_status: lead?.lead_status || '',
              lead_id: g.lead_id || null,
              contact_count: 0,
              instance_name: null,
              created_at: null,
              lead_created_at: lead?.created_at || null,
              board_id: lead?.board_id || null,
              board_name: null,
              case_number: lead?.case_number ? String(lead.case_number) : null,
              lead_number: lead?.lead_number ?? null,
              product_case_prefix: null,
              product_service_id: lead?.product_service_id || null,
              owner_phone: null,
              creator_instance_name: null,
            });
          }
        }
        if (rows.length < pageSize) break;
      }

      // 2.b) Fallback: se o join veio sem lead_name (cache de FK falhando), buscar leads
      //      diretamente por IN(lead_id) para garantir que o nome aparece na auditoria.
      const leadIdsNeeded = Array.from(groupMap.values())
        .filter(g => g.lead_id && (!g.lead_name || !g.board_id || !g.case_number))
        .map(g => g.lead_id as string);
      if (leadIdsNeeded.length > 0) {
        const uniq = Array.from(new Set(leadIdsNeeded));
        const chunkSize = 200;
        for (let i = 0; i < uniq.length; i += chunkSize) {
          const chunk = uniq.slice(i, i + chunkSize);
          const { data: leadsData } = await externalSupabase
            .from('leads')
            .select('id, lead_name, lead_status, created_at, board_id, lead_number, product_service_id, case_number')
            .in('id', chunk);
          const leadMap = new Map<string, any>();
          (leadsData || []).forEach((l: any) => leadMap.set(l.id, l));
          groupMap.forEach((g) => {
            if (g.lead_id && leadMap.has(g.lead_id)) {
              const l = leadMap.get(g.lead_id);
              if (!g.lead_name && l.lead_name) g.lead_name = l.lead_name;
              if (!g.lead_status && l.lead_status) g.lead_status = l.lead_status;
              if (!g.lead_created_at && l.created_at) g.lead_created_at = l.created_at;
              if (!g.board_id && l.board_id) g.board_id = l.board_id;
              if (g.lead_number == null && l.lead_number != null) g.lead_number = l.lead_number;
              if (!g.product_service_id && l.product_service_id) g.product_service_id = l.product_service_id;
              if (!g.case_number && l.case_number) g.case_number = String(l.case_number);
            }
          });
        }
      }

      // 2.b.2) Buscar case_prefix dos produtos para montar LEAD-N(PFX)
      const productIds = Array.from(new Set(
        Array.from(groupMap.values()).filter(g => g.product_service_id).map(g => g.product_service_id as string)
      ));
      if (productIds.length > 0) {
        const { data: prods } = await externalSupabase
          .from('products_services')
          .select('id, case_prefix')
          .in('id', productIds);
        const prefixById = new Map<string, string>();
        (prods || []).forEach((p: any) => {
          if (p.case_prefix) prefixById.set(p.id, String(p.case_prefix).trim().toUpperCase());
        });
        groupMap.forEach((g) => {
          if (g.product_service_id && prefixById.has(g.product_service_id)) {
            g.product_case_prefix = prefixById.get(g.product_service_id) || null;
          }
        });
      }

      // 2.c) Nº do caso agora vem de leads.case_number (sequência do funil fechado),
      //      preenchido nos blocos 2 e 2.b acima. legal_cases.case_number é outra
      //      coisa (nº do processo jurídico) e não deve aparecer aqui.



      // 2.d) Resolver nome dos boards (no Cloud) para os board_ids encontrados
      const boardIds = Array.from(new Set(
        Array.from(groupMap.values()).filter(g => g.board_id).map(g => g.board_id as string)
      ));
      if (boardIds.length > 0) {
        const { data: boardsData } = await externalSupabase
          .from('kanban_boards')
          .select('id, name')
          .in('id', boardIds);
        const boardMap = new Map<string, string>();
        (boardsData || []).forEach((b: any) => boardMap.set(b.id, b.name));
        groupMap.forEach((g) => {
          if (g.board_id && boardMap.has(g.board_id)) {
            g.board_name = boardMap.get(g.board_id) || null;
          }
        });
        setAvailableBoards(
          Array.from(boardMap.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        );
      }

      // 3) Fallback de nome via whatsapp_messages para os que ainda não têm nome
      const stillMissing = Array.from(groupMap.values())
        .filter((g) => !g.group_name)
        .map((g) => g.group_jid);
      if (stillMissing.length > 0) {
        // chunk pra não estourar URL no .in()
        const chunkSize = 200;
        for (let i = 0; i < stillMissing.length; i += chunkSize) {
          const chunk = stillMissing.slice(i, i + chunkSize);
          const { data: msgs } = await externalSupabase
            .from('whatsapp_messages')
            .select('phone, contact_name, created_at')
            .in('phone', chunk)
            .not('contact_name', 'is', null)
            .order('created_at', { ascending: false })
            .limit(chunk.length * 5);
          const nameByJid = new Map<string, string>();
          msgs?.forEach((m: any) => {
            if (m.phone && m.contact_name && !nameByJid.has(m.phone)) {
              nameByJid.set(m.phone, String(m.contact_name).trim());
            }
          });
          nameByJid.forEach((name, jid) => {
            const g = groupMap.get(jid);
            if (g) g.group_name = name;
          });
        }
      }

      // Fallback final: rótulo curto em vez do JID inteiro
      groupMap.forEach((g) => {
        if (!g.group_name) g.group_name = `Grupo ${String(g.group_jid).slice(-6)}`;
      });

      // 4) Contagem de contatos por grupo (paginado também)
      for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const { data: page, error } = await externalSupabase
          .from('contacts')
          .select('whatsapp_group_id')
          .not('whatsapp_group_id', 'is', null)
          .is('deleted_at', null)
          .range(from, to);
        if (error) { console.error('fetchGroups counts page error:', error); break; }
        const rows = (page as any[]) || [];
        for (const c of rows) {
          const g = groupMap.get(c.whatsapp_group_id as string);
          if (g) g.contact_count++;
        }
        if (rows.length < pageSize) break;
      }

      // 5) Data de criação do grupo + criador via snapshot UazAPI.
      //    owner_jid vem como @lid (id opaco) — quem é "pessoa" mesmo é o
      //    owner_pn (phone number). seen_in_instances dá a lista de instâncias
      //    que enxergaram o grupo, com o telefone do dono de cada instância.
      //    Se o telefone do criador bater com o de alguma instância nossa,
      //    rotulamos como a própria instância.
      // Primeiro passe: agrega TODAS as instâncias vistas em qualquer snapshot
      // para construir um mapa global { telefone -> nome_da_instancia }.
      // Assim, mesmo grupos cujo "seen_in_instances" não contém a instância dona
      // ainda conseguem ser rotulados como "Instância X" se o owner_pn bater.
      const instancePhoneToName = new Map<string, string>();

      // Seed do mapa direto da tabela whatsapp_instances (fonte primária).
      // seen_in_instances só lista instâncias que ENXERGARAM cada grupo, então
      // muitos criadores nunca apareciam ali. A tabela tem TODAS as instâncias.
      try {
        const { data: instRows } = await (externalSupabase as any)
          .from('whatsapp_instances')
          .select('instance_name, owner_phone');
        for (const r of (instRows as any[]) || []) {
          const ph = String(r?.owner_phone || '').replace(/\D/g, '');
          const nm = r?.instance_name ? String(r.instance_name) : '';
          if (ph && nm) instancePhoneToName.set(ph, nm);
        }
        console.log('[ContactsListPage] instances seeded:', instancePhoneToName.size);
      } catch (e) {
        console.warn('fetchGroups whatsapp_instances seed failed:', e);
      }

      const snapshotRows: any[] = [];
      for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const { data: page, error } = await (externalSupabase as any)
          .from('whatsapp_groups_uazapi_snapshot')
          .select('jid, group_created_at, owner_pn, seen_in_instances, creator_instance_name')
          .order('jid', { ascending: true })
          .range(from, to);
        if (error) { console.error('fetchGroups snapshot page error:', error); break; }
        const rows = (page as any[]) || [];
        for (const s of rows) {
          const seen = Array.isArray(s.seen_in_instances) ? s.seen_in_instances : [];
          for (const inst of seen) {
            const ph = String(inst?.owner_phone || '').replace(/\D/g, '');
            const nm = inst?.name ? String(inst.name) : '';
            if (ph && nm) instancePhoneToName.set(ph, nm);
          }
          snapshotRows.push(s);
        }
        if (rows.length < pageSize) break;
      }

      // Segundo passe: aplica aos grupos usando o mapa global.
      // Híbrido: 1) tenta resolver AO VIVO pelo mapa de instâncias atuais
      //          2) cai no creator_instance_name gravado se o telefone não bater
      for (const s of snapshotRows) {
        const g = groupMap.get(s.jid);
        if (!g) continue;
        if (s.group_created_at) g.created_at = s.group_created_at;
        const ownerPnRaw = String(s.owner_pn || '').split('@')[0].replace(/\D/g, '');
        if (ownerPnRaw) {
          g.owner_phone = ownerPnRaw;
          // 1) Resolução ao vivo (mapa atual de instâncias)
          let instName = instancePhoneToName.get(ownerPnRaw);
          // 1b) Fallback por últimos 8 dígitos
          if (!instName) {
            const tail = ownerPnRaw.slice(-8);
            if (tail.length >= 8) {
              for (const [ph, nm] of instancePhoneToName.entries()) {
                if (ph.slice(-8) === tail) { instName = nm; break; }
              }
            }
          }
          // 2) Fallback no gravado (instância pode ter sido removida/renomeada)
          if (!instName && s.creator_instance_name) instName = String(s.creator_instance_name);
          if (instName) g.creator_instance_name = instName;
        } else if (s.creator_instance_name) {
          // Sem owner_pn mas com instância gravada (raro) — usa direto.
          g.creator_instance_name = String(s.creator_instance_name);
        }
      }

      // Espelha o mapa em ref pra que o lote/handler individual consigam resolver
      // creator_instance_name mesmo quando o backend não retornar.
      instancePhoneMapRef.current = instancePhoneToName;

      // Cascata extra: para grupos cujo criador não é instância nossa,
      // tenta achar nome em (a) leads.lead_phone, (b) whatsapp_messages.contact_name.
      // Metáfora: se o crachá não existe, procuro o nome na lista do RH (leads)
      // e, por último, no que o porteiro anotou na entrada (push_name das mensagens).
      try {
        const unresolved = new Set<string>();
        for (const g of groupMap.values()) {
          if (g.owner_phone && !g.creator_instance_name) unresolved.add(g.owner_phone as string);
        }
        const leadNameTailMap = new Map<string, string>();
        const pushNameMap = new Map<string, string>();
        if (unresolved.size > 0) {
          const tails = new Set<string>();
          for (const p of unresolved) tails.add(p.slice(-8));
          // (a) leads paginado — match por últimos 8 dígitos
          try {
            for (let from = 0; ; from += pageSize) {
              const to = from + pageSize - 1;
              const { data: leadPage, error } = await externalSupabase
                .from('leads')
                .select('lead_name, lead_phone')
                .not('lead_phone', 'is', null)
                .range(from, to);
              if (error) { console.warn('fetchGroups leads fallback page error:', error); break; }
              const rows = (leadPage as any[]) || [];
              for (const l of rows) {
                const d = String(l.lead_phone || '').replace(/\D/g, '');
                if (!d || !l.lead_name) continue;
                const tail = d.slice(-8);
                if (tails.has(tail) && !leadNameTailMap.has(tail)) {
                  leadNameTailMap.set(tail, String(l.lead_name).trim());
                }
              }
              if (rows.length < pageSize) break;
            }
          } catch (e) { console.warn('fetchGroups leads fallback failed:', e); }
          // (b) whatsapp_messages.contact_name — chunked .in()
          try {
            const phones = Array.from(unresolved);
            const chunkSize = 200;
            for (let i = 0; i < phones.length; i += chunkSize) {
              const slice = phones.slice(i, i + chunkSize);
              const { data: msgs } = await externalSupabase
                .from('whatsapp_messages')
                .select('phone, contact_name, created_at')
                .in('phone', slice)
                .not('contact_name', 'is', null)
                .order('created_at', { ascending: false })
                .limit(slice.length * 3);
              for (const m of (msgs as any[]) || []) {
                const d = String(m.phone || '').replace(/\D/g, '');
                if (d && m.contact_name && !pushNameMap.has(d)) {
                  pushNameMap.set(d, String(m.contact_name).trim());
                }
              }
            }
          } catch (e) { console.warn('fetchGroups messages fallback failed:', e); }
        }
        setCreatorLeadNameByPhoneTail(leadNameTailMap);
        setCreatorPushNameByPhone(pushNameMap);
        console.log('[ContactsListPage] creator fallback maps:', { leads: leadNameTailMap.size, messages: pushNameMap.size, unresolved: unresolved.size });
      } catch (e) {
        console.warn('fetchGroups creator fallback failed:', e);
      }

      setGroups(Array.from(groupMap.values()));
      setGroupsLastUpdatedAt(new Date());
    } catch (err) {
      console.error('Error fetching groups:', err);
    } finally {
      if (!silent) setGroupsLoading(false);
      setGroupsRefreshingSilently(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof externalSupabase.channel> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleGroupsRefresh = () => {
      if (cancelled) return;
      if (syncingRef.current) return; // silencia durante sync em massa
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        // Refresh em segundo plano — sem trocar a lista por spinner, evita o
        // "piscar" que acontecia a cada upsert do snapshot.
        fetchGroups({ silent: true });
      }, 2500);
    };

    ensureExternalSession()
      .catch((err) => {
        console.warn('[ContactsListPage] external realtime session failed:', err?.message || err);
      })
      .finally(() => {
        if (cancelled) return;
        channel = externalSupabase
          .channel('contacts-groups-realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_groups_index' }, scheduleGroupsRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_whatsapp_groups' }, scheduleGroupsRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_groups_uazapi_snapshot' }, scheduleGroupsRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'legal_cases' }, scheduleGroupsRefresh)
          .subscribe();
      });

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) externalSupabase.removeChannel(channel);
    };
  }, []);

  const handleSelectGroup = async (groupJid: string) => {
    setSelectedGroup(groupJid);
    setGroupContactsLoading(true);
    try {
      const { data } = await externalSupabase
        .from('contacts')
        .select('*')
        .eq('whatsapp_group_id', groupJid)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      setGroupContacts((data || []) as Contact[]);
    } catch (err) {
      console.error(err);
    } finally {
      setGroupContactsLoading(false);
    }
  };

  const handleClassifyClosedAsClients = async () => {
    setClassifyingClients(true);
    try {
      // Get group JIDs from closed leads
      const { data: closedGroups } = await externalSupabase
        .from('lead_whatsapp_groups')
        .select('group_jid, leads!lead_whatsapp_groups_lead_id_fkey(lead_status)')
        .not('group_jid', 'is', null);

      if (!closedGroups) { setClassifyingClients(false); return; }

      const closedJids = closedGroups
        .filter((g: any) => g.leads?.lead_status === 'closed')
        .map(g => g.group_jid);

      if (closedJids.length === 0) {
        toast.info('Nenhum grupo de lead fechado encontrado');
        setClassifyingClients(false);
        return;
      }

      const { data: updated, error } = await externalSupabase
        .from('contacts')
        .update({ classification: 'client', updated_at: new Date().toISOString() } as any)
        .in('whatsapp_group_id', closedJids)
        .neq('classification', 'client')
        .is('deleted_at', null)
        .select('id');

      toast.success(`${updated?.length || 0} contatos atualizados para 'Cliente'`);
      fetchContacts(1, 5000, {
        ...(stateFilter !== 'all' ? { state: stateFilter } : {}),
        ...(cityFilter !== 'all' ? { city: cityFilter } : {}),
        ...(sourceFilter !== 'all' ? { actionSource: sourceFilter } : {}),
        ...(createdByFilter !== 'all' ? { createdBy: createdByFilter } : {}),
        ...(classificationFilter.length > 0 ? { classification: classificationFilter, classificationMode } : {}),
        ...(groupFilter !== 'all' ? { groupFilter } : {}),
      });
    } catch (err) {
      console.error(err);
      toast.error('Erro ao classificar contatos');
    } finally {
      setClassifyingClients(false);
    }
  };

  const fetchAgentsAndAssignments = async () => {
    const [{ data: agentsData }, { data: assignmentsData }] = await Promise.all([
      db.from('whatsapp_ai_agents').select('id, name').eq('is_active', true).order('name'),
      db.from('broadcast_list_agents').select('broadcast_list_id, agent_id, is_active, whatsapp_ai_agents(name)') as any,
    ]);
    setAgents((agentsData || []) as any);
    const map: Record<string, any> = {};
    (assignmentsData || []).forEach((a: any) => {
      map[a.broadcast_list_id] = {
        agent_id: a.agent_id,
        agent_name: a.whatsapp_ai_agents?.name || '',
        is_active: a.is_active,
      };
    });
    setListAgentMap(map);
  };

  const handleAssignAgentToList = async (listId: string, agentId: string | null) => {
    if (!agentId) {
      await db.from('broadcast_list_agents').delete().eq('broadcast_list_id', listId);
      setListAgentMap(prev => { const n = { ...prev }; delete n[listId]; return n; });
      toast.success('Agente removido da lista');
      return;
    }
    const { error } = await (db.from('broadcast_list_agents') as any).upsert({
      broadcast_list_id: listId,
      agent_id: agentId,
      is_active: true,
    }, { onConflict: 'broadcast_list_id' });
    if (error) { toast.error('Erro: ' + error.message); return; }
    const agent = agents.find(a => a.id === agentId);
    setListAgentMap(prev => ({
      ...prev,
      [listId]: { agent_id: agentId, agent_name: agent?.name || '', is_active: true },
    }));
    toast.success(`🤖 Agente "${agent?.name}" ativado para esta lista`);
  };

  // Instances
  const [instances, setInstances] = useState<{ id: string; instance_name: string }[]>([]);

  useEffect(() => {
    fetchContacts(1, 5000, {
      ...(stateFilter !== 'all' ? { state: stateFilter } : {}),
      ...(cityFilter !== 'all' ? { city: cityFilter } : {}),
      ...(sourceFilter !== 'all' ? { actionSource: sourceFilter } : {}),
      ...(createdByFilter !== 'all' ? { createdBy: createdByFilter } : {}),
      ...(classificationFilter.length > 0 ? { classification: classificationFilter, classificationMode } : {}),
      groupFilter: groupFilter !== 'all' ? groupFilter : 'without_group',
      ...(leadLinkedFilter !== 'all' ? { leadLinked: leadLinkedFilter } : {}),
      ...(periodFilter ? { createdFrom: periodFilter.from, createdTo: periodFilter.to } : {}),
    });
  }, [fetchContacts, stateFilter, cityFilter, sourceFilter, createdByFilter, classificationFilter, classificationMode, groupFilter, leadLinkedFilter, periodFilter]);

  // Load filter options and instances on mount
  useEffect(() => {
    const loadExtras = async () => {
      const [instancesRes, creatorsRes] = await Promise.all([
        db.from('whatsapp_instances').select('id, instance_name').eq('is_active', true),
        supabase.from('profiles').select('user_id, full_name').order('full_name'),
      ]);
      setInstances(instancesRes.data || []);
      if (instancesRes.data?.length) setSendInstanceId(instancesRes.data[0].id);
      setFilterOptions(prev => ({
        ...prev,
        creators: (creatorsRes.data || []).map((p: any) => ({ id: p.user_id, name: p.full_name })),
      }));
    };
    loadExtras();
  }, []);

  // Rebuild filter options when contacts change
  useEffect(() => {
    if (contacts.length > 0) {
      const uniqueStates = [...new Set(contacts.map(c => c.state).filter(Boolean))] as string[];
      const uniqueCities = [...new Set(contacts.map(c => c.city).filter(Boolean))] as string[];
      setFilterOptions(prev => ({
        ...prev,
        states: uniqueStates.sort(),
        cities: uniqueCities.sort(),
      }));
    }
  }, [contacts]);

  // Memoizado porque as consultas em lote das etiquetas dependem desta lista:
  // recriada a cada render, elas se refariam sem parar.
  const filteredContacts = useMemo(() => contacts.filter(c => {
    if (professionFilter !== undefined) {
      const prof = (c.profession || '').trim();
      if (professionFilter === null ? prof !== '' : prof !== professionFilter) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.full_name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.city && c.city.toLowerCase().includes(q)) ||
      (c.state && c.state.toLowerCase().includes(q)) ||
      (c.neighborhood && c.neighborhood.toLowerCase().includes(q))
    );
  }), [contacts, search, professionFilter]);

  const selectableContacts = filteredContacts.filter(c => c.phone);

  /** Relacionamento conta como UM filtro mesmo com vários marcados. */
  const activeFilterCount = useMemo(() => (
    [stateFilter, cityFilter, sourceFilter, createdByFilter, groupFilter, leadLinkedFilter].filter(v => v !== 'all').length
    + (classificationFilter.length > 0 ? 1 : 0)
    + (periodFilter ? 1 : 0)
  ), [stateFilter, cityFilter, sourceFilter, createdByFilter, groupFilter, leadLinkedFilter, classificationFilter, periodFilter]);
  const hasActiveFilters = activeFilterCount > 0;

  // O card de cadastros por período conta no banco (a lista aqui é só a 1ª
  // página), então precisa dos filtros — inclusive busca e profissão, que são
  // aplicados no cliente logo acima.
  const creationSeriesFilters = useMemo(() => ({
    state: stateFilter,
    city: cityFilter,
    actionSource: sourceFilter,
    createdBy: createdByFilter,
    classifications: classificationFilter,
    classificationMode,
    groupFilter: (groupFilter !== 'all' ? groupFilter : 'without_group') as 'with_group' | 'without_group',
    // Com um período escolhido no próprio gráfico, o filtro de lead veio do
    // clique: devolvê-lo ao gráfico zeraria a metade não escolhida de TODAS as
    // barras e apagaria a comparação que fez a pessoa clicar.
    leadLinked: periodFilter ? 'all' as const : leadLinkedFilter,
    profession: professionFilter,
    search,
  }), [stateFilter, cityFilter, sourceFilter, createdByFilter, classificationFilter, classificationMode, groupFilter, leadLinkedFilter, periodFilter, professionFilter, search]);

  // Etiquetas só das linhas de cima quando a lista é enorme (ver ENRICH_LIMIT),
  // e só na aba de contatos — nas outras nada disso está em tela.
  const enrichedContacts = useMemo(
    () => (activeTab === 'contacts' ? filteredContacts.slice(0, ENRICH_LIMIT) : []),
    [filteredContacts, activeTab]
  );
  const enrichedIds = useMemo(() => enrichedContacts.map(c => c.id), [enrichedContacts]);
  const enrichedSet = useMemo(() => new Set(enrichedIds), [enrichedIds]);
  const pendencyTargets = useMemo(
    () => enrichedContacts.map(c => ({ id: c.id, phone: c.phone })),
    [enrichedContacts]
  );

  const { byContact: pendencies, loading: loadingPendencies } = useContactsPendencies(pendencyTargets);
  const { byContact: activities, loading: loadingActivities } = useContactsActivities(enrichedIds);
  const { byContact: contactLinks } = useContactsLinks(enrichedIds);

  /**
   * Conversa do WhatsApp do contato — abre no fim, nas mensagens mais recentes.
   * O número vai com DDI: é assim que a conversa está gravada em
   * `whatsapp_messages`, e sem o 55 a busca volta vazia.
   */
  const openContactChat = useCallback((contact: Contact) => {
    let digits = (contact.phone || '').replace(/\D/g, '');
    if (!digits) {
      toast.error('Este contato não tem telefone cadastrado.');
      return;
    }
    if (digits.length <= 11) digits = `55${digits}`;
    setChatPreview({
      phone: digits,
      instance_name: null,
      contact_name: contact.full_name,
    });
  }, []);

  const openLinkedLead = useCallback(async (leadId: string) => {
    setLoadingShortcut(`lead:${leadId}`);
    try {
      const { data, error } = await externalSupabase.from('leads').select('*').eq('id', leadId).maybeSingle();
      if (error || !data) throw error || new Error('lead não encontrado');
      setEditingLead(data as any);
    } catch (e) {
      console.error('Erro ao abrir lead vinculado:', e);
      toast.error('Não consegui abrir este lead.');
    } finally {
      setLoadingShortcut(null);
    }
  }, []);

  const openLinkedCase = useCallback(async (processId: string) => {
    setLoadingShortcut(`case:${processId}`);
    try {
      const { data, error } = await externalSupabase.from('lead_processes').select('*').eq('id', processId).maybeSingle();
      if (error || !data) throw error || new Error('processo não encontrado');
      setProcessToOpen(data);
    } catch (e) {
      console.error('Erro ao abrir caso vinculado:', e);
      toast.error('Não consegui abrir este caso.');
    } finally {
      setLoadingShortcut(null);
    }
  }, []);

  const toggleContact = (id: string) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedContacts.size === selectableContacts.length && selectableContacts.length > 0) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(selectableContacts.map(c => c.id)));
    }
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    const list = await createList(newListName.trim(), newListDesc.trim() || undefined);
    if (list && selectedContacts.size > 0) {
      await addMembers(list.id, Array.from(selectedContacts));
    }
    setShowCreateList(false);
    setNewListName('');
    setNewListDesc('');
  };

  const handleViewList = async (list: BroadcastList) => {
    setViewingList(list);
    setLoadingMembers(true);
    const members = await fetchMembers(list.id);
    setListMembers(members);
    setLoadingMembers(false);
  };

  const handleAddSelectedToList = async (listId: string) => {
    if (selectedContacts.size === 0) {
      toast.info('Selecione contatos primeiro');
      return;
    }
    await addMembers(listId, Array.from(selectedContacts));
    if (viewingList?.id === listId) {
      const members = await fetchMembers(listId);
      setListMembers(members);
    }
  };

  const handleOpenSend = (list?: BroadcastList) => {
    if (list) {
      setSendFromList(list);
    } else if (selectedContacts.size === 0) {
      toast.info('Selecione contatos ou use uma lista');
      return;
    }
    setShowSendDialog(true);
  };

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSendMediaFile(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setSendMediaPreview(url);
    } else {
      setSendMediaPreview(null);
    }
  };

  const handleRemoveMedia = () => {
    setSendMediaFile(null);
    if (sendMediaPreview) {
      URL.revokeObjectURL(sendMediaPreview);
      setSendMediaPreview(null);
    }
  };

  const handleSend = async () => {
    if ((!sendMessage.trim() && !sendMediaFile) || !sendInstanceId) return;
    setSending(true);
    try {
      let contactIds: string[];
      if (sendFromList) {
        const members = await fetchMembers(sendFromList.id);
        contactIds = members.map(m => m.contact_id);
      } else {
        contactIds = Array.from(selectedContacts);
      }

      let mediaUrl: string | undefined;
      let mediaType: string | undefined;

      if (sendMediaFile) {
        setUploadingMedia(true);
        const ext = sendMediaFile.name.split('.').pop() || 'bin';
        const path = `broadcast/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('whatsapp-media')
          .upload(path, sendMediaFile, { contentType: sendMediaFile.type, cacheControl: '31536000' });
        setUploadingMedia(false);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(uploadData.path);
        mediaUrl = urlData.publicUrl;
        mediaType = sendMediaFile.type;
      }

      await sendBroadcast({
        listId: sendFromList?.id,
        contactIds,
        message: sendMessage.trim(),
        instanceId: sendInstanceId,
        mediaUrl,
        mediaType,
      });
      setShowSendDialog(false);
      setSendMessage('');
      setSendFromList(null);
      handleRemoveMedia();
    } catch {
      // handled in hook
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 p-4 border-b bg-card shrink-0">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-lg font-semibold">Contatos & Transmissão</h1>
        <Badge variant="secondary" className="text-xs">{totalCount}</Badge>
        <Button variant="outline" size="sm" onClick={handleClassifyClosedAsClients} disabled={classifyingClients} title="Classificar contatos em grupos fechados como Cliente">
          {classifyingClients ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
          Classificar Clientes
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowDuplicatesScan(true)} title="Buscar e mesclar contatos duplicados">
          <Users className="h-3.5 w-3.5 mr-1" />
          Resolver duplicados
        </Button>
        <Button size="sm" onClick={() => setShowCreateContact(true)}>
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Novo Contato
        </Button>
        <Link to="/mapa-leads">
          <Button variant="outline" size="sm" className="gap-1">
            <MapPin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Mapa</span>
          </Button>
        </Link>
        <div className="ml-auto flex gap-2">
          {selectedContacts.size > 0 && (
            <>
              <Badge variant="default">{selectedContacts.size} selecionados</Badge>
              <Button size="sm" variant="outline" onClick={() => setShowCreateList(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nova Lista
              </Button>
              <Button size="sm" onClick={() => handleOpenSend()}>
                <Send className="h-3.5 w-3.5 mr-1" />
                Enviar
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 pt-3 shrink-0">
          <div className="grid w-full max-w-lg grid-cols-3 h-10 items-center rounded-md bg-muted p-1 text-muted-foreground">
            <button
              type="button"
              onClick={() => setActiveTab('contacts')}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'contacts' ? 'bg-background text-foreground shadow-sm' : ''}`}
            >
              <Users className="h-4 w-4 mr-1.5" />
              Contatos ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('groups')}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'groups' ? 'bg-background text-foreground shadow-sm' : ''}`}
            >
              <UsersRound className="h-4 w-4 mr-1.5" />
              Grupos ({groups.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('lists')}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'lists' ? 'bg-background text-foreground shadow-sm' : ''}`}
            >
              <Radio className="h-4 w-4 mr-1.5" />
              Listas ({lists.length})
            </button>
          </div>
        </div>

        {activeTab === 'contacts' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 mt-2 px-4 pb-4">
          <div className="flex items-center gap-2 py-3 shrink-0">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone, cidade, estado..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowFilters(v => !v)}>
              <Filter className="h-3.5 w-3.5 mr-1" />
              Filtros
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={toggleAll}>
              {selectedContacts.size === selectableContacts.length && selectableContacts.length > 0 ? 'Desmarcar' : 'Selecionar'} todos
            </Button>
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-2 pb-3 shrink-0">
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Estados</SelectItem>
                  {filterOptions.states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Cidade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Cidades</SelectItem>
                  {filterOptions.cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Origem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Origens</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="system">Automático (IA)</SelectItem>
                  <SelectItem value="group_creation">Criação de Grupo</SelectItem>
                  <SelectItem value="whatsapp_group">Grupo WhatsApp</SelectItem>
                </SelectContent>
              </Select>

              <Select value={createdByFilter} onValueChange={setCreatedByFilter}>
                <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue placeholder="Criado por" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Membros</SelectItem>
                  {filterOptions.creators.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <ClassificationFilterSelect
                value={classificationFilter}
                onChange={setClassificationFilter}
                mode={classificationMode}
                onModeChange={setClassificationMode}
                options={classificationOptions.map(c => ({ name: c.name, color: c.color }))}
              />

              <Select value={groupFilter} onValueChange={(v) => setGroupFilter(v as any)}>
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Grupo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="with_group">Com Grupo</SelectItem>
                  <SelectItem value="without_group">Sem Grupo</SelectItem>
                </SelectContent>
              </Select>

              <Select value={leadLinkedFilter} onValueChange={(v) => setLeadLinkedFilter(v as any)}>
                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Lead" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos (Lead)</SelectItem>
                  <SelectItem value="linked">Com Lead</SelectItem>
                  <SelectItem value="not_linked">Sem Lead</SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  setStateFilter('all');
                  setCityFilter('all');
                  setSourceFilter('all');
                  setCreatedByFilter('all');
                  setClassificationFilter([]);
                  setClassificationMode('any');
                  setGroupFilter('all');
                  setLeadLinkedFilter('all');
                  setPeriodFilter(null);
                }}>
                  <X className="h-3 w-3 mr-1" />
                  Limpar
                </Button>
              )}
            </div>
          )}

          {!contactsLoading && filteredContacts.length > 0 && (
            <ContactsDistributionDonuts
              contacts={filteredContacts}
              classificationConfig={classificationConfig}
              onSelectClassification={(name) =>
                setClassificationSheet({ name, color: classificationConfig[name]?.color })
              }
              // classificationFilter é string[] (o seletor do topo é múltiplo).
              // Clicar na fatia filtra só por ela; clicar de novo na mesma
              // limpa. Antes gravava a string crua no state do array: o filtro
              // ia pro fetch como `classification: "Cliente"` em vez de lista.
              onFilterClassification={(name) =>
                setClassificationFilter(prev =>
                  prev.length === 1 && prev[0] === name ? [] : [name]
                )
              }
              selectedClassification={
                classificationFilter.length === 1 ? classificationFilter[0] : undefined
              }
              onSelectProfession={(prof) =>
                setProfessionFilter(prev =>
                  prev !== undefined && prev === prof ? undefined : prof
                )
              }
              selectedProfession={professionFilter}
              trendSlot={
                <ContactsCreationTrendBars
                  filters={creationSeriesFilters}
                  selected={periodFilter}
                  onSelectPeriod={(sel) => {
                    setPeriodFilter(sel);
                    // O pedaço clicado JÁ diz a situação de lead — o filtro da
                    // barra de cima acompanha, senão a lista mostraria os dois.
                    setLeadLinkedFilter(sel ? sel.lead : 'all');
                  }}
                />
              }
              className="pb-3"
            />
          )}

          {(professionFilter !== undefined || periodFilter) && (
            <div className="flex items-center gap-1.5 pb-2 shrink-0 flex-wrap">
              {professionFilter !== undefined && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Briefcase className="h-3 w-3" />
                  {professionFilter === null ? 'Sem profissão' : professionFilter}
                  <button type="button" onClick={() => setProfessionFilter(undefined)} className="shrink-0">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {periodFilter && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {periodFilter.label} · {periodFilter.lead === 'linked' ? 'com lead' : 'sem lead'}
                  <button
                    type="button"
                    onClick={() => { setPeriodFilter(null); setLeadLinkedFilter('all'); }}
                    className="shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}

          {filteredContacts.length > ENRICH_LIMIT && (
            <p className="text-[11px] text-muted-foreground pb-2 shrink-0">
              Pendências, atividades e vínculos carregados nos {ENRICH_LIMIT} primeiros contatos — refine os filtros para ver o resto.
            </p>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-1">
              {contactsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : filteredContacts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhum contato encontrado</p>
              ) : (
                filteredContacts.map(contact => {
                  const enriched = enrichedSet.has(contact.id);
                  const linked = contactLinks[contact.id] || EMPTY_CONTACT_LINKS;
                  const rels = contact.classifications?.length
                    ? contact.classifications
                    : (contact.classification ? [contact.classification] : []);
                  return (
                  <div
                    key={contact.id}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                    onClick={() => { setDetailTab(undefined); setDetailContact(contact); }}
                  >
                    <Checkbox
                      className="mt-1"
                      checked={selectedContacts.has(contact.id)}
                      onCheckedChange={() => toggleContact(contact.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {/* Foto do WhatsApp. `autoFetch` segue o mesmo teto das
                        etiquetas (ENRICH_LIMIT): abaixo dele a foto só aparece
                        se já estiver em cache — rolar 36 mil contatos buscando
                        foto seria uma consulta à UazAPI por linha. */}
                    {contact.phone && (
                      <WhatsAppAvatar
                        phone={contact.phone}
                        autoFetch={enriched}
                        className="h-9 w-9 mt-0.5"
                        iconClassName="h-4 w-4"
                      />
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="font-medium text-sm truncate">{contact.full_name}</p>
                      {/* Telefone, lugar e profissão na mesma linha: são o que
                          identifica a pessoa antes de abrir qualquer coisa. A
                          profissão vem do próprio registro, então aparece em
                          toda linha — não depende do teto das etiquetas. */}
                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                        <span className="flex items-center gap-1 min-w-0">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span className="truncate">{contact.phone || 'Sem telefone'}</span>
                        </span>
                        {(contact.city || contact.state) && (
                          <span className="flex items-center gap-1 min-w-0 text-muted-foreground/70">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {[contact.city, contact.state].filter(Boolean).join(', ')}
                            </span>
                          </span>
                        )}
                        {contact.profession && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProfessionFilter(prev => prev === contact.profession ? undefined : contact.profession);
                            }}
                            title={`Filtrar a lista por ${contact.profession}`}
                            className={`flex items-center gap-1 min-w-0 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              professionFilter === contact.profession ? 'text-primary font-medium' : 'text-muted-foreground/70'
                            }`}
                          >
                            <Briefcase className="h-3 w-3 shrink-0" />
                            <span className="truncate">{contact.profession}</span>
                          </button>
                        )}
                      </div>

                      {/* Etiquetas com atalho: o que está em aberto com essa
                          pessoa e de onde ela veio, sem precisar abrir a ficha. */}
                      {enriched && (
                        <div className="flex flex-wrap items-center gap-1">
                          <ContactPendencyBadge
                            summary={pendencies[contact.id]}
                            loading={loadingPendencies}
                            onClick={contact.phone ? () => openContactChat(contact) : undefined}
                          />
                          <ContactActivityBadge
                            summary={activities[contact.id]}
                            loading={loadingActivities}
                            onClick={() => { setDetailTab('activities'); setDetailContact(contact); }}
                          />
                          {linked.leads.map(l => (
                            <button
                              key={l.id}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openLinkedLead(l.id); }}
                              disabled={loadingShortcut === `lead:${l.id}`}
                              title={`Abrir o lead ${l.name}`}
                              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                            >
                              <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 font-normal max-w-[180px]">
                                {loadingShortcut === `lead:${l.id}`
                                  ? <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                                  : <Link2 className="h-3 w-3 shrink-0" />}
                                <span className="truncate">{l.name}</span>
                              </Badge>
                            </button>
                          ))}
                          {linked.cases.map(cs => (
                            <button
                              key={cs.processId}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openLinkedCase(cs.processId); }}
                              disabled={loadingShortcut === `case:${cs.processId}`}
                              title={`Abrir o caso ${cs.label}${cs.role ? ` (${PARTY_ROLE_LABELS[cs.role] || cs.role})` : ''}`}
                              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                            >
                              <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 font-normal max-w-[180px]">
                                {loadingShortcut === `case:${cs.processId}`
                                  ? <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                                  : <Scale className="h-3 w-3 shrink-0" />}
                                <span className="truncate">{cs.label}</span>
                              </Badge>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {rels.map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setClassificationSheet({ name: r, color: classificationConfig[r]?.color });
                          }}
                          title={`Ver todos os contatos com esse relacionamento`}
                          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 font-normal">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${classificationConfig[r]?.color || 'bg-slate-500'}`}
                            />
                            {classificationConfig[r]?.label || r}
                          </Badge>
                        </button>
                      ))}
                      {contact.phone && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={(e) => { e.stopPropagation(); openContactChat(contact); }}
                        >
                          <MessageCircle className="h-3 w-3 text-green-600" />
                          WhatsApp
                        </Button>
                      )}
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        )}

        {/* Groups Tab */}
        {activeTab === 'groups' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 mt-2 px-4 pb-4">
          <div className="flex items-center gap-2 py-3 shrink-0 flex-wrap">
            <div className="relative flex-1 max-w-md min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={groupSearchScope === 'group' ? 'Buscar grupo por nome...' : 'Buscar pelo nome do lead...'}
                value={groupSearch}
                onChange={e => setGroupSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-2"
              disabled={bulkRefreshing}
              onClick={() => {
                const missing = groups.filter(g => !g.created_at || !g.owner_phone).map(g => g.group_jid);
                handleBulkRefreshCreationDates(missing);
              }}
              title="Buscar na UazAPI a data de criação e o criador dos grupos incompletos"
            >
              {bulkRefreshing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              {bulkRefreshing && bulkProgress
                ? `Atualizando ${bulkProgress.done}/${bulkProgress.total}`
                : `Atualizar dados em lote${groups.filter(g => !g.created_at || !g.owner_phone).length ? ` (${groups.filter(g => !g.created_at || !g.owner_phone).length})` : ''}`}
            </Button>
            {bulkRefreshing && (
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => { bulkCancelRef.current = true; }}>
                Cancelar
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-2"
              onClick={() => fetchGroups({ silent: true })}
              disabled={groupsRefreshingSilently}
              title="Atualizar a lista agora (em segundo plano)"
            >
              {groupsRefreshingSilently
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="text-xs text-muted-foreground">
                {groupsLastUpdatedAt
                  ? `Atualizado às ${groupsLastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                  : 'Atualizar'}
              </span>
            </Button>
            <Sheet open={showGroupFilters} onOpenChange={setShowGroupFilters}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0 gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtrar e ordenar
                  {(excludedGroups.size > 0 || groupSort !== 'date' || groupSortDir !== 'desc' || groupSearchScope !== 'group' || auditMode || leadStatusFilter.size > 0 || leadLinkFilter !== 'all' || boardFilter.size > 0 || dateFrom || dateTo) && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] rounded-full">
                      {[
                        groupSearchScope !== 'group',
                        groupSort !== 'date',
                        groupSortDir !== 'desc',
                        excludedGroups.size > 0,
                        auditMode,
                        leadStatusFilter.size > 0,
                        leadLinkFilter !== 'all',
                        boardFilter.size > 0,
                        !!(dateFrom || dateTo),
                      ].filter(Boolean).length}
                    </Badge>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Filtrar e ordenar grupos</SheetTitle>
                  <SheetDescription>
                    Funciona como o filtro do Google Planilhas: escolha onde buscar, como ordenar e em qual direção.
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-6 space-y-6">
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Buscar e ordenar por</Label>
                    <RadioGroup value={groupSearchScope} onValueChange={(v) => setGroupSearchScope(v as any)} className="space-y-2">
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="group" id="scope-group" />
                        <Label htmlFor="scope-group" className="flex-1 cursor-pointer">
                          <p className="text-sm font-medium">Nome do grupo</p>
                          <p className="text-xs text-muted-foreground">Padrão. O lead aparece apenas como detalhe.</p>
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="lead" id="scope-lead" />
                        <Label htmlFor="scope-lead" className="flex-1 cursor-pointer">
                          <p className="text-sm font-medium">Nome do lead vinculado</p>
                          <p className="text-xs text-muted-foreground">Útil pra conferir se o nome do grupo bate com o do lead.</p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-2 block">Ordenar por</Label>
                    <RadioGroup value={groupSort} onValueChange={(v) => setGroupSort(v as any)} className="space-y-2">
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="alpha" id="sort-alpha" />
                        <Label htmlFor="sort-alpha" className="flex-1 cursor-pointer text-sm">Ordem alfabética</Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="number" id="sort-number" />
                        <Label htmlFor="sort-number" className="flex-1 cursor-pointer text-sm">
                          <p>Por numeração</p>
                          <p className="text-xs text-muted-foreground">Ex.: "Caso 12" antes de "Caso 100".</p>
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="prefix" id="sort-prefix" />
                        <Label htmlFor="sort-prefix" className="flex-1 cursor-pointer text-sm">
                          <p>Por prefixo</p>
                          <p className="text-xs text-muted-foreground">Agrupa pelo início do nome (letras antes do número).</p>
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="date" id="sort-date" />
                        <Label htmlFor="sort-date" className="flex-1 cursor-pointer text-sm">
                          <p>Data de criação</p>
                          <p className="text-xs text-muted-foreground">Ordena pela data em que o grupo foi criado no WhatsApp.</p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-2 block">Direção</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={groupSortDir === 'asc' ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => setGroupSortDir('asc')}
                      >
                        <ArrowDownAZ className="h-4 w-4" />
                        Crescente (A→Z / 1→9)
                      </Button>
                      <Button
                        variant={groupSortDir === 'desc' ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => setGroupSortDir('desc')}
                      >
                        <ArrowUpAZ className="h-4 w-4" />
                        Decrescente (Z→A / 9→1)
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-2 block">Vínculo com lead</Label>
                    <RadioGroup value={leadLinkFilter} onValueChange={(v) => setLeadLinkFilter(v as any)} className="space-y-2">
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="all" id="link-all" />
                        <Label htmlFor="link-all" className="flex-1 cursor-pointer text-sm">Todos os grupos</Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="with" id="link-with" />
                        <Label htmlFor="link-with" className="flex-1 cursor-pointer text-sm">Somente com lead vinculado</Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="without" id="link-without" />
                        <Label htmlFor="link-without" className="flex-1 cursor-pointer text-sm">Somente sem lead vinculado</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {(() => {
                    const statuses = Array.from(new Set(groups.map(g => g.lead_status).filter(Boolean))).sort();
                    if (statuses.length === 0) return null;
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium">Status do lead</Label>
                          {leadStatusFilter.size > 0 && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLeadStatusFilter(new Set())}>
                              Limpar
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {leadStatusFilter.size === 0 ? 'Mostrando todos os status.' : `Mostrando: ${Array.from(leadStatusFilter).join(', ')}`}
                        </p>
                        <div className="space-y-1">
                          {statuses.map(st => (
                            <div key={st} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50">
                              <Checkbox
                                id={`status-${st}`}
                                checked={leadStatusFilter.has(st)}
                                onCheckedChange={(v) => {
                                  setLeadStatusFilter(prev => {
                                    const next = new Set(prev);
                                    if (v) next.add(st); else next.delete(st);
                                    return next;
                                  });
                                }}
                              />
                              <Label htmlFor={`status-${st}`} className="flex-1 cursor-pointer text-sm capitalize">{st}</Label>
                              <Badge variant="outline" className="text-[10px]">
                                {groups.filter(g => g.lead_status === st).length}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {availableBoards.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">Funil (board do lead)</Label>
                        {boardFilter.size > 0 && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setBoardFilter(new Set())}>
                            Limpar
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {boardFilter.size === 0
                          ? 'Mostrando todos os funis.'
                          : `Mostrando ${boardFilter.size} funil(is) selecionado(s).`}
                      </p>
                      <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                        {availableBoards.map(b => {
                          const count = groups.filter(g => g.board_id === b.id).length;
                          return (
                            <div key={b.id} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50">
                              <Checkbox
                                id={`board-${b.id}`}
                                checked={boardFilter.has(b.id)}
                                onCheckedChange={(v) => {
                                  setBoardFilter(prev => {
                                    const next = new Set(prev);
                                    if (v) next.add(b.id); else next.delete(b.id);
                                    return next;
                                  });
                                }}
                              />
                              <Label htmlFor={`board-${b.id}`} className="flex-1 cursor-pointer text-sm truncate">{b.name}</Label>
                              <Badge variant="outline" className="text-[10px]">{count}</Badge>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}


                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-medium">Data de criação do grupo</Label>
                      {(dateFrom || dateTo) && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                          Limpar
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Filtra pelo dia em que o grupo foi criado no WhatsApp. Grupos sem data são ocultados quando o filtro está ativo.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="date-from" className="text-xs text-muted-foreground">De</Label>
                        <Input id="date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
                      </div>
                      <div>
                        <Label htmlFor="date-to" className="text-xs text-muted-foreground">Até</Label>
                        <Input id="date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[
                        { label: 'Hoje', days: 0 },
                        { label: '7 dias', days: 7 },
                        { label: '30 dias', days: 30 },
                        { label: '90 dias', days: 90 },
                      ].map(p => (
                        <Button
                          key={p.label}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            const to = new Date();
                            const from = new Date();
                            from.setDate(from.getDate() - p.days);
                            const fmt = (d: Date) => d.toISOString().slice(0, 10);
                            setDateFrom(fmt(from));
                            setDateTo(fmt(to));
                          }}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {excludedGroups.size > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">Grupos ocultos manualmente</Label>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExcludedGroups(new Set())}>
                          Restaurar todos
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {excludedGroups.size} grupo(s) ocultos. Desmarque na lista para esconder mais.
                      </p>
                    </div>
                  )}

                  <div className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <ClipboardCheck className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                      <div className="flex-1">
                        <Label htmlFor="audit-mode" className="text-sm font-medium cursor-pointer">
                          Modo auditoria
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Ordena pelo nº do caso e destaca quando o nome do grupo não bate com o nome do lead. Não filtra por status.
                        </p>
                      </div>
                      <Checkbox
                        id="audit-mode"
                        checked={auditMode}
                        onCheckedChange={(v) => setAuditMode(!!v)}
                      />
                    </div>
                    {auditMode && (
                      <div className="flex items-center gap-2 pl-6">
                        <Checkbox
                          id="audit-only-mismatch"
                          checked={auditOnlyMismatch}
                          onCheckedChange={(v) => setAuditOnlyMismatch(!!v)}
                        />
                        <Label htmlFor="audit-only-mismatch" className="text-xs cursor-pointer">
                          Mostrar só os divergentes
                        </Label>
                      </div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setGroupSearchScope('group');
                      setGroupSort('date');
                      setGroupSortDir('desc');
                      setExcludedGroups(new Set());
                      setAuditMode(false);
                      setAuditOnlyMismatch(false);
                      setLeadStatusFilter(new Set());
                      setLeadLinkFilter('all');
                      setBoardFilter(new Set());
                      setDateFrom('');
                      setDateTo('');
                    }}
                  >
                    Limpar filtros
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
            {selectedGroup && (
              <Button variant="outline" size="sm" onClick={() => { setSelectedGroup(null); setGroupContacts([]); }}>
                <X className="h-3.5 w-3.5 mr-1" />
                Voltar à lista
              </Button>
            )}
          </div>

          {/* Contadores com lead / sem lead */}
          {!selectedGroup && groups.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pb-2 shrink-0">
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Com lead: {groups.filter(g => g.lead_id).length}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                Sem lead: {groups.filter(g => !g.lead_id).length}
              </Badge>
              <span className="text-[11px] text-muted-foreground">de {groups.length} grupos</span>
            </div>
          )}

          {/* Chips de critério ativo */}
          {!selectedGroup && (
            <div className="flex items-center gap-2 flex-wrap pb-2 shrink-0">
              <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                Busca: {groupSearchScope === 'group' ? 'Grupo' : 'Lead'}
                {groupSearchScope !== 'group' && (
                  <button
                    onClick={() => setGroupSearchScope('group')}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Voltar para busca por grupo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
              <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                Ordem: {groupSort === 'alpha' ? 'Alfabética' : groupSort === 'number' ? 'Numérica' : groupSort === 'date' ? 'Data de criação' : 'Prefixo'} ·
                {groupSortDir === 'asc' ? ' ↑' : ' ↓'}
                {(groupSort !== 'date' || groupSortDir !== 'desc') && (
                  <button
                    onClick={() => { setGroupSort('date'); setGroupSortDir('desc'); }}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Restaurar ordem padrão"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
              {groupSearch && (
                <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                  Termo: "{groupSearch}"
                  <button
                    onClick={() => setGroupSearch('')}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Limpar termo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {excludedGroups.size > 0 && (
                <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                  {excludedGroups.size} oculto(s)
                  <button
                    onClick={() => setExcludedGroups(new Set())}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Restaurar grupos ocultos"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {auditMode && (
                <Badge variant="default" className="gap-1 pl-2 pr-1">
                  <ClipboardCheck className="h-3 w-3" />
                  Auditoria{auditOnlyMismatch ? ' · só divergentes' : ''}
                  <button
                    onClick={() => { setAuditMode(false); setAuditOnlyMismatch(false); }}
                    className="ml-1 rounded-full hover:bg-primary-foreground/20 p-0.5"
                    aria-label="Sair do modo auditoria"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {leadLinkFilter !== 'all' && (
                <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                  {leadLinkFilter === 'with' ? 'Com lead' : 'Sem lead'}
                  <button
                    onClick={() => setLeadLinkFilter('all')}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Limpar filtro de vínculo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {boardFilter.size > 0 && (
                <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                  Funil: {boardFilter.size === 1
                    ? (availableBoards.find(b => b.id === Array.from(boardFilter)[0])?.name || '1')
                    : `${boardFilter.size} selecionados`}
                  <button
                    onClick={() => setBoardFilter(new Set())}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Limpar filtro de funil"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {Array.from(leadStatusFilter).map(st => (
                <Badge key={st} variant="secondary" className="gap-1 pl-2 pr-1 capitalize">
                  Status: {st}
                  <button
                    onClick={() => setLeadStatusFilter(prev => {
                      const next = new Set(prev);
                      next.delete(st);
                      return next;
                    })}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label={`Remover filtro ${st}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {selectedGroup ? (
              <div className="space-y-1">
                <div className="p-3 mb-2 rounded-lg bg-muted/50 border flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{groups.find(g => g.group_jid === selectedGroup)?.group_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Lead: {groups.find(g => g.group_jid === selectedGroup)?.lead_name} •
                      Status: <Badge variant="outline" className="text-[10px] ml-1">{groups.find(g => g.group_jid === selectedGroup)?.lead_status || 'N/A'}</Badge>
                    </p>
                  </div>
                  <Button size="sm" variant="default" className="shrink-0" onClick={() => openGroupChat(selectedGroup!)}>
                    <MessageCircle className="h-4 w-4 mr-1" /> Abrir conversa
                  </Button>
                </div>
                {groupContactsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : groupContacts.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nenhum contato neste grupo</p>
                ) : (
                  groupContacts.map(contact => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => setDetailContact(contact)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{contact.full_name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.phone || 'Sem telefone'}
                        </p>
                      </div>
                      {contact.classification && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {contact.classification}
                        </Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (() => {
              const extractCaseNum = (s: string | null | undefined): number | null => {
                if (!s) return null;
                const m = String(s).match(/caso\s*0*(\d+)/i) || String(s).match(/\b0*(\d{1,6})\b/);
                if (!m) return null;
                const n = parseInt(m[1], 10);
                return isNaN(n) ? null : n;
              };
              const normalizeName = (s: string | null | undefined) =>
                (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

              const jidToPhone = (jid: string | null | undefined): string => {
                if (!jid) return '';
                return String(jid).split('@')[0].replace(/\D/g, '');
              };
              const formatPhoneBR = (digits: string): string => {
                if (!digits) return '';
                if (digits.length === 13 && digits.startsWith('55')) {
                  return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
                }
                if (digits.length === 12 && digits.startsWith('55')) {
                  return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
                }
                return `+${digits}`;
              };
              const contactNameByPhone = new Map<string, string>();
              for (const c of contacts) {
                const d = String((c as any).phone || '').replace(/\D/g, '');
                if (d && (c as any).full_name) contactNameByPhone.set(d, (c as any).full_name);
              }
              const creatorDisplay = (g: { owner_phone: string | null; creator_instance_name: string | null }): string => {
                if (g.creator_instance_name) return `Instância ${g.creator_instance_name}`;
                if (g.owner_phone) {
                  const direct = contactNameByPhone.get(g.owner_phone);
                  if (direct) return direct;
                  const leadName = creatorLeadNameByPhoneTail.get(g.owner_phone.slice(-8));
                  if (leadName) return `${leadName} (lead)`;
                  const pushName = creatorPushNameByPhone.get(g.owner_phone);
                  if (pushName) return pushName;
                  return formatPhoneBR(g.owner_phone);
                }
                return '—';
              };
              const creatorTooltip = (g: { owner_phone: string | null; creator_instance_name: string | null }): string => {
                const parts: string[] = [];
                if (g.creator_instance_name) parts.push(`Instância: ${g.creator_instance_name}`);
                if (g.owner_phone) {
                  parts.push(`Telefone: ${formatPhoneBR(g.owner_phone)}`);
                  const leadName = creatorLeadNameByPhoneTail.get(g.owner_phone.slice(-8));
                  if (leadName) parts.push(`Lead: ${leadName}`);
                  const pushName = creatorPushNameByPhone.get(g.owner_phone);
                  if (pushName && !contactNameByPhone.get(g.owner_phone)) parts.push(`WhatsApp: ${pushName}`);
                }
                return parts.length ? parts.join(' · ') : 'Criador do grupo desconhecido';
              };
              // Compat: usado em filtro e ordenação (texto único pesquisável)
              const creatorLabel = (g: { owner_phone: string | null; creator_instance_name: string | null }): string => {
                const disp = creatorDisplay(g);
                if (g.owner_phone && !g.creator_instance_name && disp !== formatPhoneBR(g.owner_phone)) {
                  return `${disp} (${formatPhoneBR(g.owner_phone)})`;
                }
                return disp;
              };

              const matchesSearch = (g: typeof groups[number]) => {
                if (!deferredGroupSearch) return true;
                const norm = (s: string) => normalizeName(s);
                const rawQuery = deferredGroupSearch.toLowerCase().trim();
                const normQuery = norm(deferredGroupSearch);
                const tokens = normQuery.split(/\s+/).filter(Boolean);
                const queryDigits = rawQuery.replace(/\D/g, '');
                if (groupSearchScope === 'lead') {
                  const leadText = norm(g.lead_name || '');
                  const tokenMatch = tokens.length > 0 && tokens.every(t => leadText.includes(t));
                  return tokenMatch || (!!queryDigits && leadText.replace(/\D/g, '').includes(queryDigits));
                }
                const caseDigits = g.case_number ? String(g.case_number).replace(/\D/g, '') : '';
                const groupDigits = (g.group_name || '').replace(/\D/g, '');
                const leadDigits = g.lead_number != null ? String(g.lead_number) : '';
                const leadLabel = g.lead_number != null
                  ? `lead ${g.lead_number} lead-${g.lead_number} ${g.product_case_prefix ? `lead-${g.lead_number}(${g.product_case_prefix})` : ''}`
                  : '';
                const caseLabel = caseDigits
                  ? `caso ${caseDigits} ${g.product_case_prefix ? `${g.product_case_prefix}-${caseDigits}` : ''}`
                  : '';
                // O CNJ entra na busca geral: colar um nº de processo no campo tem
                // que achar o grupo, com ou sem pontuação. Vale tanto o processo já
                // cadastrado quanto o sugerido pela jurimetria — quem procura o
                // processo quer justamente achar o grupo que ainda não tem ficha.
                // Só a partir de 6 dígitos: "88" aparece dentro de quase todo CNJ
                // (são 20 dígitos), e buscar caso 88 traria a base inteira.
                const proc = grupoProcesso.get(g.group_jid);
                const procDigits = soDigitos(`${proc?.cnj_do_lead || ''} ${proc?.cnj_sugerido || ''}`);
                const haystack = norm([g.group_name, leadLabel, caseLabel].join(' '));
                const textMatch = tokens.length > 0 && tokens.every(t => haystack.includes(t));
                const numberMatch = !!queryDigits
                  && (queryDigits.length >= 6
                    ? [groupDigits, caseDigits, leadDigits, procDigits].some(value => value.includes(queryDigits))
                    : [groupDigits, caseDigits, leadDigits].some(value => value.includes(queryDigits)));
                return textMatch || numberMatch;
              };


              let visible = [...groups].filter(g => {
                if (excludedGroups.has(g.group_jid)) return false;
                if (!matchesSearch(g)) return false;
                if (leadLinkFilter === 'with' && !g.lead_name) return false;
                if (leadLinkFilter === 'without' && g.lead_name) return false;
                if (leadStatusFilter.size > 0 && !leadStatusFilter.has(g.lead_status)) return false;
                if (boardFilter.size > 0 && (!g.board_id || !boardFilter.has(g.board_id))) return false;
                if (dateFrom || dateTo) {
                  const t = g.created_at ? new Date(g.created_at).getTime() : null;
                  if (t === null) return false;
                  if (dateFrom && t < new Date(dateFrom + 'T00:00:00').getTime()) return false;
                  if (dateTo && t > new Date(dateTo + 'T23:59:59').getTime()) return false;
                }
                if (creatorFilter !== 'all') {
                  if (creatorFilter === '__none__') {
                    if (g.owner_phone) return false;
                  } else if ((g.owner_phone || '') !== creatorFilter) {
                    return false;
                  }
                }
                return true;
              });

              if (auditMode && auditOnlySemFicha) {
                visible = visible.filter(g => grupoProcesso.get(g.group_jid)?.so_na_jurimetria);
              }

              if (auditMode && auditOnlyMismatch) {
                visible = visible.filter(g => {
                  const ng = normalizeName(g.group_name);
                  const nl = normalizeName(g.lead_name);
                  if (!ng || !nl) return true;
                  return !ng.includes(nl) && !nl.includes(ng);
                });
              }

              visible.sort((a, b) => {
                const sortField = groupSearchScope === 'lead' ? 'lead_name' : 'group_name';
                const na = ((a as any)[sortField] || '').trim();
                const nb = ((b as any)[sortField] || '').trim();
                let cmp = 0;
                if (groupSort === 'date') {
                  const ta = a.created_at ? new Date(a.created_at).getTime() : (a.lead_created_at ? new Date(a.lead_created_at).getTime() : null);
                  const tb = b.created_at ? new Date(b.created_at).getTime() : (b.lead_created_at ? new Date(b.lead_created_at).getTime() : null);
                  // Nulos sempre no fim, independente da direção
                  if (ta == null && tb == null) return 0;
                  if (ta == null) return 1;
                  if (tb == null) return -1;
                  cmp = ta - tb;
                } else if (groupSort === 'number') {
                  const numA = parseInt(na.match(/\d+/)?.[0] || '', 10);
                  const numB = parseInt(nb.match(/\d+/)?.[0] || '', 10);
                  const aHas = !isNaN(numA);
                  const bHas = !isNaN(numB);
                  if (aHas && bHas && numA !== numB) cmp = numA - numB;
                  else if (aHas && !bHas) cmp = -1;
                  else if (!aHas && bHas) cmp = 1;
                  else cmp = na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
                } else if (groupSort === 'prefix') {
                  const pa = (na.match(/^[^\s\d]+/)?.[0] || na).toLowerCase();
                  const pb = (nb.match(/^[^\s\d]+/)?.[0] || nb).toLowerCase();
                  cmp = pa.localeCompare(pb, 'pt-BR', { sensitivity: 'base' });
                  if (cmp === 0) cmp = na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
                } else {
                  cmp = na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
                }
                return groupSortDir === 'desc' ? -cmp : cmp;
              });


              const highlight = (text: string | null | undefined, shouldHighlight: boolean) => {
                const value = text || '';
                if (!groupSearch || !shouldHighlight) return value;
                const escaped = groupSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const parts = value.split(new RegExp(`(${escaped})`, 'ig'));
                return parts.map((p, i) =>
                  p.toLowerCase() === groupSearch.toLowerCase()
                    ? <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">{p}</mark>
                    : <span key={i}>{p}</span>
                );
              };

              if (groupsLoading) {
                return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
              }
              if (visible.length === 0) {
                return <p className="text-center text-muted-foreground py-8">
                  {'Nenhum grupo encontrado'}
                </p>;
              }

              // Renderizar 4.8k linhas de uma vez trava a UI. Quando NÃO há
              // busca/filtro ativo, limitamos a 300. Quando o usuário busca ou
              // filtra, mostramos todos os matches (até 2000 como teto duro).
              const hasActiveFilter =
                !!groupSearch.trim() ||
                leadLinkFilter !== 'all' ||
                leadStatusFilter.size > 0 ||
                (auditMode && (auditOnlyMismatch || auditOnlySemFicha));
              // Performance: com busca textual ativa, limitar render a 150
              // (renderizar 2000 linhas a cada tecla trava o mobile).
              const RENDER_CAP = deferredGroupSearch.trim()
                ? 150
                : hasActiveFilter ? 800 : 300;
              const totalAll = visible.length;
              const capped = visible.slice(0, RENDER_CAP);
              const truncatedNotice = totalAll > RENDER_CAP ? (
                <div className="text-[11px] text-center text-muted-foreground py-2 border-t mt-2">
                  Mostrando {RENDER_CAP} de {totalAll} grupos. Refine a busca para ver mais.
                </div>
              ) : (!hasActiveFilter && totalAll > 0 ? (
                <div className="text-[11px] text-center text-muted-foreground py-2 border-t mt-2">
                  Mostrando {totalAll} grupos. Use a busca para encontrar grupos específicos.
                </div>
              ) : null);

              if (auditMode) {
                const total = visible.length;
                const mismatched = visible.filter(g => {
                  const ng = normalizeName(g.group_name);
                  const nl = normalizeName(g.lead_name);
                  if (!ng || !nl) return true;
                  return !ng.includes(nl) && !nl.includes(ng);
                }).length;
                const semFicha = visible.filter(g => grupoProcesso.get(g.group_jid)?.so_na_jurimetria).length;
                // Lista única de criadores (a partir dos grupos atualmente filtrados, antes do recorte por criador)
                const creatorMap = new Map<string, string>();
                for (const g of groups) {
                  const digits = g.owner_phone;
                  if (!digits) continue;
                  if (!creatorMap.has(digits)) creatorMap.set(digits, creatorDisplay(g));
                }
                const creatorOptions = Array.from(creatorMap.entries())
                  .map(([value, label]) => ({ value, label }))
                  .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

                // Filtro por coluna (substring case-insensitive, igual planilha)
                const colFilterActive = Object.values(auditColFilter).some(v => v.trim() !== '');
                const cellText = (g: typeof groups[number], col: string): string => {
                  switch (col) {
                    case 'leadN': return g.lead_number != null ? `LEAD-${g.lead_number}${g.product_case_prefix ? `(${g.product_case_prefix})` : ''}` : '';
                    case 'caseN': return g.case_number || '';
                    case 'groupName': return g.group_name || '';
                    case 'leadName': return g.lead_name || '';
                    // Filtrar por processo tem que achar tanto "0000892-33.2016..."
                    // quanto "000089233" — ninguém digita o CNJ pontuado.
                    case 'processo': {
                      const p = grupoProcesso.get(g.group_jid);
                      if (!p) return '';
                      const cnj = p.cnj_do_lead || p.cnj_sugerido || '';
                      return `${cnj} ${soDigitos(cnj)}`;
                    }
                    case 'createdAt': return g.created_at ? new Date(g.created_at).toLocaleString('pt-BR') : '';
                    case 'createdBy': return (g.owner_phone || g.creator_instance_name) ? creatorLabel(g) : '';
                    default: return '';
                  }
                };
                if (colFilterActive) {
                  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                  visible = visible.filter(g =>
                    Object.entries(auditColFilter).every(([col, q]) => {
                      const query = norm(q.trim());
                      if (!query) return true;
                      return norm(cellText(g, col)).includes(query);
                    })
                  );
                }
                const visibleAfterCols = visible;
                const cappedAfterCols = colFilterActive ? visibleAfterCols.slice(0, RENDER_CAP) : capped;

                // Grid template a partir das larguras (px). Última coluna em 1fr seria ruim aqui — manter px.
                const cols = ['check', 'leadN', 'caseN', 'groupName', 'leadName', 'processo', 'createdAt', 'createdBy', 'actions'] as const;
                const gridTemplate = cols.map(c => `${auditColW[c]}px`).join(' ');
                const startResize = (col: string, e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startW = auditColW[col];
                  const onMove = (ev: MouseEvent) => {
                    const dx = ev.clientX - startX;
                    const next = Math.max(40, Math.min(800, startW + dx));
                    setAuditColW(prev => ({ ...prev, [col]: next }));
                  };
                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                  };
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                };
                // ATENÇÃO: estes são helpers que retornam JSX e são CHAMADOS como
                // função (headerCell({...})), não instanciados como <HeaderCell />.
                // Como estão definidos dentro do render, usá-los como componente
                // cria um tipo novo a cada render, o React remonta a subárvore e o
                // <Input> do filtro perde o foco a cada tecla digitada.
                const resizeHandle = (col: string) => (
                  <span
                    onMouseDown={(e) => startResize(col, e)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                    aria-label={`Redimensionar ${col}`}
                  />
                );
                const headerCell = ({ col, label, title, align }: { col: string; label: string; title?: string; align?: 'left'|'center' }) => (
                  <div className="relative pr-2" style={{ textAlign: align || 'left' }}>
                    <div className="text-[11px] font-medium text-muted-foreground truncate" title={title || label}>{label}</div>
                    {auditColFilter[col] !== undefined && (
                      <Input
                        value={auditColFilter[col]}
                        onChange={(e) => setAuditColFilter(prev => ({ ...prev, [col]: e.target.value }))}
                        placeholder="filtrar…"
                        className="h-6 text-[11px] mt-1 px-1.5"
                      />
                    )}
                    {resizeHandle(col)}
                  </div>
                );

                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3 px-1 text-xs text-muted-foreground">
                      <span>{visibleAfterCols.length} caso(s) fechado(s)</span>
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        {mismatched} divergente(s)
                      </span>
                      {/* O trabalho de conciliação em uma linha: grupo cujo nº de
                          caso acha processo na jurimetria e ninguém cadastrou ficha. */}
                      {semFicha > 0 && (
                        <button
                          type="button"
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${auditOnlySemFicha ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'hover:bg-accent'}`}
                          onClick={() => setAuditOnlySemFicha(v => !v)}
                          title="Grupos cujo processo existe na jurimetria mas ainda não tem ficha cadastrada. Clique para ver só eles."
                        >
                          <Scale className="h-3.5 w-3.5" />
                          {semFicha} sem ficha de processo
                        </button>
                      )}
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-[11px]">Criado por:</span>
                        <Select value={creatorFilter} onValueChange={setCreatorFilter}>
                          <SelectTrigger className="h-7 w-[240px] text-xs">
                            <SelectValue placeholder="Todos" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="__none__">Sem criador identificado</SelectItem>
                            {creatorOptions.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {creatorFilter !== 'all' && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setCreatorFilter('all')}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                        {colFilterActive && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAuditColFilter({ leadN: '', caseN: '', groupName: '', leadName: '', processo: '', createdAt: '', createdBy: '' })}>
                            Limpar filtros de coluna
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-2 px-3 py-2 border-b items-start" style={{ gridTemplateColumns: gridTemplate }}>
                      <div className="relative"><span></span></div>
                      {headerCell({ col: 'leadN', label: 'Nº lead', title: 'Sequência do lead (LEAD-N(PFX))' })}
                      {headerCell({ col: 'caseN', label: 'Nº caso', title: 'Sequência de leads fechados (leads.case_number) — ex: PREV 1448. Editável pelo lápis.' })}
                      {headerCell({ col: 'groupName', label: 'Nome do grupo' })}
                      {headerCell({ col: 'leadName', label: 'Nome do lead', align: 'center' })}
                      {headerCell({ col: 'processo', label: 'Processo', title: 'CNJ do processo do grupo. Vem do lead quando já existe ficha; em âmbar é sugestão da jurimetria pelo nº do caso no nome do grupo (ainda sem ficha). Filtre com ou sem pontuação.' })}
                      {headerCell({ col: 'createdAt', label: 'Criado em', title: 'Data e hora de criação do grupo no WhatsApp' })}
                      {headerCell({ col: 'createdBy', label: 'Criado por', title: 'Telefone/instância de quem criou o grupo' })}
                      <div className="relative"><span></span></div>
                    </div>
                    {cappedAfterCols.map(group => {
                      const caseNum = group.case_number;
                      const ng = normalizeName(group.group_name);
                      const nl = normalizeName(group.lead_name);
                      const hasBoth = !!ng && !!nl;
                      const nameMatches = hasBoth && (ng.includes(nl) || nl.includes(ng));
                      // Confere se o nº do lead (sequência oficial) aparece no nome do grupo
                      const numericLead = group.lead_number != null ? String(group.lead_number) : null;
                      const numericCase = caseNum ? caseNum.replace(/\D/g, '').replace(/^0+/, '') : null;
                      const groupDigits = (group.group_name || '').replace(/\D/g, '');
                      const numberMatches =
                        numericCase
                          ? groupDigits.includes(numericCase)
                          : numericLead
                            ? groupDigits.includes(numericLead)
                            : true;
                      const matches = nameMatches && numberMatches;
                      return (
                        <div
                          key={group.group_jid}
                          className={`grid gap-2 items-center p-3 rounded-lg border transition-colors hover:bg-accent/50 ${!matches ? 'border-amber-500/40 bg-amber-500/5' : ''}`}
                          style={{ gridTemplateColumns: gridTemplate }}
                        >
                          <Checkbox
                            checked={!excludedGroups.has(group.group_jid)}
                            onCheckedChange={(checked) => {
                              setExcludedGroups(prev => {
                                const next = new Set(prev);
                                if (checked) next.delete(group.group_jid);
                                else next.add(group.group_jid);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Incluir grupo no filtro"
                          />
                          <span
                            className={`text-xs font-mono font-semibold tabular-nums ${group.lead_number != null ? 'text-foreground' : 'text-muted-foreground'}`}
                            title={group.lead_number != null ? `Lead nº ${group.lead_number}${group.product_case_prefix ? ` (${group.product_case_prefix})` : ''}` : 'Lead sem sequência'}
                          >
                            {group.lead_number != null
                              ? `LEAD-${group.lead_number}${group.product_case_prefix ? `(${group.product_case_prefix})` : ''}`
                              : '—'}
                          </span>
                          <span
                            className={`text-xs font-mono tabular-nums ${caseNum ? 'text-foreground' : 'text-muted-foreground'}`}
                            title={caseNum ? `Nº de caso fechado: ${caseNum}` : 'Lead ainda sem nº de caso fechado (use o lápis para definir)'}
                          >
                            {caseNum || '—'}
                          </span>
                          <span
                            className="text-sm truncate cursor-pointer hover:underline pr-3"
                            title="Abrir conversa do grupo"
                            onClick={() => openGroupChat(group.group_jid)}
                          >
                            {highlight(group.group_name, groupSearchScope === 'group')}
                          </span>
                          <span
                            className={`relative text-sm truncate pl-3 text-center before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-3/5 before:w-px before:bg-border/50 cursor-pointer hover:underline ${group.lead_id ? '' : 'text-emerald-600 italic font-medium'}`}
                            title={group.lead_id ? 'Abrir lead' : 'Clique para vincular ou criar um lead'}
                            onClick={() => {
                              if (group.lead_id) {
                                openGroupLead(group.group_jid);
                              } else {
                                setLinkDialog({ groupJid: group.group_jid, groupName: group.group_name || null });
                                setLinkQuery('');
                                setLinkResults([]);
                              }
                            }}
                          >
                            {group.lead_name
                              ? highlight(group.lead_name, groupSearchScope === 'lead')
                              : (group.lead_id ? '(sem nome)' : '+ vincular lead')}
                          </span>
                          {(() => {
                            const p = grupoProcesso.get(group.group_jid);
                            if (!p) {
                              return <span className="text-[11px] text-muted-foreground">—</span>;
                            }
                            // Processo com ficha: clicável, abre por cima da lista.
                            if (p.cnj_do_lead) {
                              const varios = p.cnj_do_lead.includes(',');
                              return (
                                <span
                                  className="text-[11px] font-mono truncate cursor-pointer hover:underline"
                                  title={`Abrir processo${varios ? ` (${p.cnj_do_lead})` : ''}`}
                                  onClick={(e) => { e.stopPropagation(); void openProcessoPorCnj(p.cnj_do_lead!); }}
                                >
                                  {p.cnj_do_lead.split(',')[0].trim()}
                                  {varios && <span className="text-muted-foreground"> +{p.cnj_do_lead.split(',').length - 1}</span>}
                                </span>
                              );
                            }
                            // Só na jurimetria: não há ficha para abrir. Mostrar como
                            // sugestão é o ponto da tela — é o trabalho que falta fazer.
                            const ambiguo = p.qtd_sugerida > 1;
                            return (
                              <span
                                className={`text-[11px] font-mono truncate flex items-center gap-1 ${ambiguo ? 'text-amber-600' : 'text-emerald-700 dark:text-emerald-400'}`}
                                title={
                                  (ambiguo
                                    ? `AMBÍGUO — o nº do caso aponta para ${p.qtd_sugerida} processos. Não dá para vincular sozinho:\n`
                                    : 'Sugestão da jurimetria pelo nº do caso no nome do grupo — ainda sem ficha cadastrada:\n')
                                  + (p.sugestao_detalhe || p.cnj_sugerido || '')
                                }
                              >
                                {ambiguo && <AlertTriangle className="h-3 w-3 shrink-0" />}
                                <span className="truncate">{(p.cnj_sugerido || '').split(',')[0].trim()}</span>
                                {ambiguo && <span className="shrink-0">+{p.qtd_sugerida - 1}</span>}
                                {/* Ambíguo não vincula: escolher um dos dois CNJs no
                                    chute cadastraria a ficha da pessoa errada. */}
                                {!ambiguo && (
                                  <Button
                                    size="icon" variant="ghost"
                                    className="h-5 w-5 shrink-0 opacity-70 hover:opacity-100"
                                    title="Cadastrar a ficha deste processo no lead do grupo"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const cnj = (p.cnj_sugerido || '').trim();
                                      if (!cnj) return;
                                      if (group.lead_id) {
                                        setVincProcesso({
                                          groupJid: group.group_jid, groupName: group.group_name,
                                          leadId: group.lead_id, cnj, detalhe: p.sugestao_detalhe,
                                        });
                                      } else {
                                        // Sem lead não há onde pendurar a ficha. Manda
                                        // para o vínculo do lead levando o CNJ na mão.
                                        setLinkDialog({
                                          groupJid: group.group_jid, groupName: group.group_name, cnjPendente: cnj,
                                        });
                                        setLinkQuery('');
                                        setLinkResults([]);
                                      }
                                    }}
                                  >
                                    <Link2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </span>
                            );
                          })()}
                          <span
                            className={`text-[11px] tabular-nums flex items-center gap-1 ${group.created_at ? 'text-foreground' : 'text-muted-foreground italic'}`}
                            title={group.created_at ? new Date(group.created_at).toLocaleString('pt-BR') : 'Data de criação do grupo desconhecida — clique no botão para buscar na UazAPI'}
                          >
                            <span>
                              {group.created_at
                                ? new Date(group.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0 opacity-60 hover:opacity-100"
                              title={group.created_at ? 'Atualizar data deste grupo (UazAPI)' : 'Buscar data de criação na UazAPI'}
                              disabled={refreshingDateFor.has(group.group_jid)}
                              onClick={(e) => { e.stopPropagation(); handleRefreshCreationDate(group.group_jid, group.instance_name); }}
                            >
                              {refreshingDateFor.has(group.group_jid)
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <RefreshCw className="h-3 w-3" />}
                            </Button>
                          </span>
                          <span
                            className={`text-[11px] truncate ${(group.owner_phone || group.creator_instance_name) ? 'text-foreground' : 'text-muted-foreground italic'}`}
                            title={creatorTooltip(group)}
                            data-n-ignore="true"
                            data-callface-ignore="true"
                          >
                            {creatorDisplay(group)}
                          </span>
                          <div className="flex items-center gap-1">
                            {matches ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Bate" />
                            ) : (
                              <AlertTriangle
                                className="h-4 w-4 text-amber-500"
                                aria-label={hasBoth ? 'Divergente' : 'Faltando dados'}
                              />
                            )}
                            {group.lead_id && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                title="Editar nº do funil (renomeia o grupo)"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  // Busca o case_number atual do lead (funil)
                                  const { data } = await externalSupabase
                                    .from('leads')
                                    .select('case_number, lead_name')
                                    .eq('id', group.lead_id!)
                                    .maybeSingle();
                                  const current = (data as any)?.case_number || '';
                                  setEditCaseValue(String(current));
                                  setEditCaseDialog({
                                    leadId: group.lead_id!,
                                    groupJid: group.group_jid,
                                    currentNumber: String(current),
                                    currentName: (data as any)?.lead_name || group.lead_name || group.group_name || '',
                                  });
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {!group.lead_id && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
                                title="Vincular ou criar lead para este grupo"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLinkDialog({ groupJid: group.group_jid, groupName: group.group_name || null });
                                  setLinkQuery('');
                                  setLinkResults([]);
                                }}
                              >
                                <Link2 className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            <Button size="icon" variant="ghost" className="h-6 w-6" title="Ver contatos do grupo" onClick={(e) => { e.stopPropagation(); handleSelectGroup(group.group_jid); }}>
                              <Users className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              title="Excluir grupo da lista"
                              onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.group_jid, group.group_name); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {truncatedNotice}
                  </div>
                );
              }

              return (
                <div className="space-y-1">
                  {capped.map(group => (
                    <div
                      key={group.group_jid}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors border"
                    >
                      <Checkbox
                        checked={!excludedGroups.has(group.group_jid)}
                        onCheckedChange={(checked) => {
                          setExcludedGroups(prev => {
                            const next = new Set(prev);
                            if (checked) next.delete(group.group_jid);
                            else next.add(group.group_jid);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Incluir grupo no filtro"
                      />
                      <UsersRound className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p
                          className="font-medium text-sm truncate cursor-pointer hover:underline"
                          title="Abrir conversa do grupo"
                          onClick={() => openGroupChat(group.group_jid)}
                        >
                          {highlight(group.group_name, groupSearchScope === 'group')}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          Lead:{' '}
                          {group.lead_id ? (
                            <span
                              className="cursor-pointer hover:underline text-foreground"
                              title="Abrir lead"
                              onClick={(e) => { e.stopPropagation(); openGroupLead(group.group_jid); }}
                            >
                              {highlight(group.lead_name, groupSearchScope === 'lead')}
                              {loadingLeadForGroup === group.group_jid && (
                                <Loader2 className="h-3 w-3 ml-1 inline animate-spin" />
                              )}
                            </span>
                          ) : (
                            <span
                              className="cursor-pointer hover:underline text-emerald-600 italic font-medium"
                              title="Clique para vincular ou criar um lead"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLinkDialog({ groupJid: group.group_jid, groupName: group.group_name || null });
                                setLinkQuery('');
                                setLinkResults([]);
                              }}
                            >+ vincular lead</span>
                          )}{' '}
                          • {group.contact_count} contato(s)
                          {group.created_at && (
                            <> • Grupo: {new Date(group.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                          )}
                          {group.lead_created_at && (
                            <> • Lead: {new Date(group.lead_created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                          )}
                        </p>

                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Abrir conversa do grupo" onClick={(e) => { e.stopPropagation(); openGroupChat(group.group_jid); }}>
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Ver contatos do grupo" onClick={(e) => { e.stopPropagation(); handleSelectGroup(group.group_jid); }}>
                        <Users className="h-4 w-4" />
                      </Button>
                      {!group.lead_id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-emerald-600 hover:text-emerald-700"
                          title="Vincular ou criar lead para este grupo"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLinkDialog({ groupJid: group.group_jid, groupName: group.group_name || null });
                            setLinkQuery('');
                            setLinkResults([]);
                          }}
                        >
                          <Link2 className="h-4 w-4" />
                        </Button>
                      )}

                      <Badge variant={group.lead_status === 'closed' ? 'default' : 'outline'} className="text-[10px] shrink-0">
                        {group.lead_status || 'N/A'}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                        title="Excluir grupo da lista"
                        onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.group_jid, group.group_name); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {truncatedNotice}
                </div>
              );
            })()}
          </div>
        </div>
        )}

        {activeTab === 'lists' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 mt-2 px-4 pb-4">
          <div className="flex items-center gap-2 py-3 shrink-0">
            <Button size="sm" onClick={() => setShowCreateList(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova Lista
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-2">
              {listsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : lists.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhuma lista criada</p>
              ) : (
                lists.map(list => {
                  const listAgent = listAgentMap[list.id];
                  return (
                    <div
                      key={list.id}
                      className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                    >
                      <Radio className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleViewList(list)}>
                        <p className="font-medium text-sm">{list.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {list.member_count || 0} contatos
                          {list.description && ` • ${list.description}`}
                        </p>
                        {listAgent && (
                          <p className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                            <Bot className="h-3 w-3" />
                            {listAgent.agent_name}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {/* Agent selector */}
                        <Select
                          value={listAgent?.agent_id || ''}
                          onValueChange={(val) => handleAssignAgentToList(list.id, val === '__remove__' ? null : val)}
                        >
                          <SelectTrigger className="h-8 w-8 p-0 border-0 bg-transparent [&>svg.lucide-chevron-down]:hidden justify-center" title="Agente IA">
                            {listAgent ? (
                              <Bot className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <BotOff className="h-4 w-4 text-muted-foreground" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {agents.map(agent => (
                              <SelectItem key={agent.id} value={agent.id}>
                                🤖 {agent.name}
                              </SelectItem>
                            ))}
                            {listAgent && (
                              <SelectItem value="__remove__" className="text-destructive">
                                Remover agente
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => handleAddSelectedToList(list.id)}
                          title="Adicionar selecionados"
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => handleOpenSend(list)}
                          title="Enviar transmissão"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          onClick={() => deleteList(list.id)}
                          title="Excluir lista"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Create List Dialog */}
      <Dialog open={showCreateList} onOpenChange={setShowCreateList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Lista de Transmissão</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome da lista</Label>
              <Input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Ex: Clientes VIP" />
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Input value={newListDesc} onChange={e => setNewListDesc(e.target.value)} placeholder="Descrição da lista" />
            </div>
            {selectedContacts.size > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedContacts.size} contato(s) selecionado(s) serão adicionados à lista
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateList(false)}>Cancelar</Button>
            <Button onClick={handleCreateList} disabled={!newListName.trim()}>Criar Lista</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View List Members Dialog */}
      <Dialog open={!!viewingList} onOpenChange={open => !open && setViewingList(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              {viewingList?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-96">
            {loadingMembers ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : listMembers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nenhum contato nesta lista</p>
            ) : (
              <div className="space-y-1">
                {listMembers.map(member => (
                  <div key={member.id} className="flex items-center gap-3 p-2 rounded hover:bg-accent/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{member.contact?.full_name || 'Contato'}</p>
                      <p className="text-xs text-muted-foreground">{member.contact?.phone || 'Sem telefone'}</p>
                    </div>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={async () => {
                        await removeMember(member.id);
                        const updated = await fetchMembers(viewingList!.id);
                        setListMembers(updated);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingList(null)}>Fechar</Button>
            <Button onClick={() => { setViewingList(null); handleOpenSend(viewingList!); }}>
              <Send className="h-4 w-4 mr-1.5" />
              Enviar para lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Broadcast Dialog */}
      <Dialog open={showSendDialog} onOpenChange={open => { if (!open) { setShowSendDialog(false); setSendFromList(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Enviar Transmissão
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-sm text-muted-foreground">
              {sendFromList
                ? `Enviando para lista "${sendFromList.name}" (${sendFromList.member_count} contatos)`
                : `Enviando para ${selectedContacts.size} contato(s) selecionado(s)`
              }
            </p>

            <div>
              <Label>Instância WhatsApp</Label>
              <Select value={sendInstanceId} onValueChange={setSendInstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a instância" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map(inst => (
                    <SelectItem key={inst.id} value={inst.id}>{inst.instance_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="flex items-center gap-1.5">
                <ImagePlus className="h-4 w-4" />
                Foto / Mídia (opcional)
              </Label>
              {sendMediaFile ? (
                <div className="mt-1.5 flex items-center gap-3 p-2 border rounded-md bg-muted/50">
                  {sendMediaPreview ? (
                    <img src={sendMediaPreview} alt="Preview" className="h-14 w-14 rounded object-cover" />
                  ) : (
                    <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                      {sendMediaFile.name.split('.').pop()?.toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm truncate flex-1">{sendMediaFile.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleRemoveMedia}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label className="mt-1.5 flex items-center gap-2 p-2.5 border border-dashed rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Clique para adicionar imagem ou arquivo</span>
                  <input type="file" accept="image/*,video/*,application/pdf" className="hidden" onChange={handleMediaSelect} />
                </label>
              )}
            </div>

            <div>
              <Label>Mensagem</Label>
              <Textarea
                value={sendMessage}
                onChange={e => setSendMessage(e.target.value)}
                placeholder="Digite a mensagem para todos os contatos..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowSendDialog(false); setSendFromList(null); handleRemoveMedia(); }}>
              Cancelar
            </Button>
            <Button onClick={handleSend} disabled={(!sendMessage.trim() && !sendMediaFile) || !sendInstanceId || sending || uploadingMedia}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
              {uploadingMedia ? 'Enviando mídia...' : sending ? 'Enviando...' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContactDetailSheet
        contact={detailContact}
        open={!!detailContact}
        initialTab={detailTab}
        onOpenChange={(open) => { if (!open) { setDetailContact(null); setDetailTab(undefined); } }}
        onContactUpdated={() => {
          fetchContacts(1, 5000, {
            ...(stateFilter !== 'all' ? { state: stateFilter } : {}),
            ...(cityFilter !== 'all' ? { city: cityFilter } : {}),
            ...(sourceFilter !== 'all' ? { actionSource: sourceFilter } : {}),
            ...(createdByFilter !== 'all' ? { createdBy: createdByFilter } : {}),
            ...(classificationFilter.length > 0 ? { classification: classificationFilter, classificationMode } : {}),
            groupFilter: groupFilter !== 'all' ? groupFilter : 'without_group',
          });
        }}
      />

      <CreateContactDialog
        open={showCreateContact}
        onOpenChange={setShowCreateContact}
        onContactCreated={() => {
          setShowCreateContact(false);
          fetchContacts();
        }}
      />

      <DuplicateContactsScanDialog
        open={showDuplicatesScan}
        onOpenChange={setShowDuplicatesScan}
        onFinished={() => fetchContacts()}
      />

      <DashboardChatPreview
        open={!!chatPreview}
        onOpenChange={(open) => { if (!open) setChatPreview(null); }}
        phone={chatPreview?.phone || null}
        contactName={chatPreview?.contact_name || null}
        instanceName={chatPreview?.instance_name || null}
        hasLead={false}
        hasContact={false}
        wasResponded={false}
        responseTimeMinutes={null}
      />

      {/* Painel do relacionamento (fatia da rosca ou etiqueta da linha) e caso
          vinculado — ambos por cima da lista, que continua filtrada atrás. */}
      <ClassificationContactsSheet
        classification={classificationSheet?.name || null}
        color={classificationSheet?.color}
        open={!!classificationSheet}
        onOpenChange={(open) => { if (!open) setClassificationSheet(null); }}
      />

      {processToOpen && (
        <Suspense fallback={null}>
          <ProcessDetailSheet
            open={!!processToOpen}
            onOpenChange={(open: boolean) => { if (!open) setProcessToOpen(null); }}
            process={processToOpen}
          />
        </Suspense>
      )}

      <LeadEditDialog
        open={!!editingLead}
        onOpenChange={(open) => { if (!open) { setEditingLead(null); fetchGroups({ silent: true }); } }}
        lead={editingLead}
        onSave={async (leadId, updates) => {
          const { error } = await externalSupabase.from('leads').update(updates as any).eq('id', leadId);
          if (error) throw error;
        }}
        mode="sheet"
      />

      <Dialog open={!!editCaseDialog} onOpenChange={(o) => { if (!o && !editCaseSaving) setEditCaseDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar nº do funil</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Lead: <span className="font-medium text-foreground">{editCaseDialog?.currentName}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Salva em <code>leads.case_number</code>, regenera o nome do lead e renomeia o grupo no WhatsApp.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Novo nº (ex: 1448)</Label>
              <Input
                autoFocus
                value={editCaseValue}
                onChange={(e) => setEditCaseValue(e.target.value)}
                placeholder="1448"
                disabled={editCaseSaving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditCaseDialog(null)} disabled={editCaseSaving}>Cancelar</Button>
            <Button
              disabled={editCaseSaving || !editCaseValue.trim() || editCaseValue.trim() === editCaseDialog?.currentNumber}
              onClick={async () => {
                if (!editCaseDialog) return;
                const newNumber = editCaseValue.trim();
                setEditCaseSaving(true);
                try {
                  const { error: upErr } = await externalSupabase
                    .from('leads')
                    .update({ case_number: newNumber })
                    .eq('id', editCaseDialog.leadId);
                  if (upErr) {
                    toast.error('Falha ao salvar: ' + upErr.message);
                    return;
                  }
                  const { data, error } = await cloudFunctions.invoke<any>('regenerate-lead-name', {
                    body: { lead_id: editCaseDialog.leadId },
                  });
                  if (error || data?.success === false) {
                    toast.warning('Nº salvo, mas falhou ao renomear grupo: ' + (data?.error || error?.message || ''));
                  } else {
                    toast.success(
                      `Atualizado para ${data?.lead_name || newNumber}` +
                        (data?.group_renamed ? ' (grupo renomeado)' : ''),
                    );
                  }
                  // Atualiza row localmente
                  setGroups((prev) => prev.map((g) =>
                    g.group_jid === editCaseDialog.groupJid
                      ? {
                          ...g,
                          lead_name: data?.lead_name || g.lead_name,
                          group_name: data?.group_renamed && data?.lead_name ? data.lead_name : g.group_name,
                        }
                      : g,
                  ));
                  setEditCaseDialog(null);
                } finally {
                  setEditCaseSaving(false);
                }
              }}
            >
              {editCaseSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Salvar e renomear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkDialog} onOpenChange={(o) => { if (!o && !linking) { setLinkDialog(null); setLinkQuery(''); setLinkResults([]); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular lead ao grupo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Grupo: <span className="font-medium text-foreground">{linkDialog?.groupName || linkDialog?.groupJid}</span>
            </p>
            {linkDialog?.cnjPendente && (
              <p className="rounded border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs">
                A ficha do processo <span className="font-mono">{linkDialog.cnjPendente}</span> será cadastrada
                assim que o lead for vinculado. Sem lead não há onde pendurar o processo.
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Buscar lead existente (nome, telefone, nº lead, nº caso)</Label>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  placeholder="Digite nome ou telefone…"
                  disabled={!!linking}
                />
                {linkSearching && <Loader2 className="h-4 w-4 animate-spin self-center" />}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Busca automática — também procura pelo telefone dos contatos do grupo.
              </p>
            </div>
            {linkResults.length > 0 && (
              <ScrollArea className="max-h-64 border rounded-md">
                <div className="divide-y">
                  {linkResults.map((l) => (
                    <button
                      key={l.id}
                      disabled={!!linking}
                      onClick={async () => {
                        if (!linkDialog) return;
                        setLinking(l.id);
                        try {
                          const { error } = await externalSupabase
                            .from('lead_whatsapp_groups')
                            .insert({
                              lead_id: l.id,
                              group_jid: linkDialog.groupJid,
                              group_name: linkDialog.groupName,
                            } as any);
                          if (error) throw error;
                          // Sidebar do WhatsApp resolve o lead do grupo por esta tabela
                          invalidateGroupLeadCache(linkDialog.groupJid);
                          toast.success('Lead vinculado ao grupo!');
                          // Atualiza a linha localmente
                          setGroups((prev) => prev.map((g) => g.group_jid === linkDialog.groupJid
                            ? { ...g, lead_id: l.id, lead_name: l.lead_name, lead_status: l.lead_status, lead_number: l.lead_number, case_number: l.case_number } as any
                            : g));
                          // Regenera o nome do grupo no WhatsApp
                          cloudFunctions.invoke('regenerate-lead-name', { body: { lead_id: l.id } }).catch(() => {});
                          // Veio da coluna Processo: agora que existe lead, cadastra
                          // a ficha do CNJ que a jurimetria apontou.
                          if (linkDialog.cnjPendente) {
                            await cadastrarProcessoDoGrupo(l.id, linkDialog.cnjPendente);
                          }
                          setLinkDialog(null);
                          setLinkQuery('');
                          setLinkResults([]);
                        } catch (err: any) {
                          toast.error('Falha ao vincular: ' + err.message);
                        } finally {
                          setLinking(null);
                        }
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-accent disabled:opacity-50 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{l.lead_name || '(sem nome)'}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {l.lead_number ? `LEAD-${l.lead_number}` : '—'} • Nº caso: {l.case_number || '—'} • {l.lead_status || 'N/A'}{(l as any).lead_phone ? ` • 📞 ${(l as any).lead_phone}` : ''}
                        </div>
                      </div>
                      {linking === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
            {linkQuery && !linkSearching && linkResults.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nenhum resultado. Tecle Enter para buscar ou crie um lead novo abaixo.</p>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2">
            <Button
              variant="outline"
              disabled={!!linking}
              onClick={() => {
                if (!linkDialog) return;
                const params = new URLSearchParams({
                  newLead: 'true',
                  linkGroupJid: linkDialog.groupJid,
                  linkGroupName: linkDialog.groupName || '',
                });
                navigate(`/leads?${params.toString()}`);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Criar novo lead vinculado
            </Button>
            <Button variant="ghost" onClick={() => setLinkDialog(null)} disabled={!!linking}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação do vínculo processo→lead. Uma linha por vez, de propósito:
          cadastrar ficha propaga para caso, partes e contatos, e desfazer isso
          depois é trabalho manual. */}
      <Dialog open={!!vincProcesso} onOpenChange={(o) => { if (!o && !vinculandoProcesso) setVincProcesso(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cadastrar a ficha deste processo?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1 text-xs">
            <p className="text-muted-foreground">
              Grupo: <span className="font-medium text-foreground">{vincProcesso?.groupName || vincProcesso?.groupJid}</span>
            </p>
            <div className="rounded border p-2">
              <div className="font-mono text-sm">{vincProcesso?.cnj}</div>
              {vincProcesso?.detalhe && (
                <div className="mt-1 whitespace-pre-line text-muted-foreground">{vincProcesso.detalhe}</div>
              )}
            </div>
            <p className="text-muted-foreground">
              Cria a ficha em <span className="font-mono">lead_processes</span> ligada ao lead deste grupo, com
              empresa, cidade/UF e data de protocolo da jurimetria. Classe, assunto e valor da causa ficam
              vazios — quem preenche isso é o Escavador depois.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVincProcesso(null)} disabled={vinculandoProcesso}>
              Cancelar
            </Button>
            <Button
              disabled={vinculandoProcesso}
              onClick={async () => {
                if (!vincProcesso) return;
                setVinculandoProcesso(true);
                try {
                  const ok = await cadastrarProcessoDoGrupo(vincProcesso.leadId, vincProcesso.cnj);
                  if (ok) setVincProcesso(null);
                } finally {
                  setVinculandoProcesso(false);
                }
              }}
            >
              {vinculandoProcesso ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
              Cadastrar processo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}

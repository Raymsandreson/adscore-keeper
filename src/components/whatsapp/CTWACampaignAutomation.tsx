import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Megaphone, Target, Sparkles, FolderKanban, Plus, X, Loader2, RefreshCw, Phone, 
  Pause, Play, MessageSquare, Users, UserPlus, Brain, ExternalLink, Zap 
} from 'lucide-react';
import { DashboardChatPreview } from './DashboardChatPreview';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface CampaignLink {
  id: string;
  agent_id: string;
  campaign_id: string;
  campaign_name: string;
  auto_create_lead?: boolean;
  board_id?: string | null;
  stage_id?: string | null;
  instance_id?: string | null;
  is_active?: boolean;
}

interface Instance {
  id: string;
  instance_name: string;
  owner_phone?: string;
}

interface Agent {
  id: string;
  shortcut_name: string;
  description: string | null;
}

interface Board {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

interface MetaCampaign {
  campaign_id: string;
  campaign_name: string;
  status?: string;
  destination_phone?: string | null;
}

interface ConversationInfo {
  phone: string;
  contact_name: string | null;
  last_message_at: string | null;
  first_message_at: string | null;
  is_agent_active: boolean;
  has_lead: boolean;
  has_contact: boolean;
  lead_status: string | null;
  lead_name: string | null;
  instance_name: string | null;
  was_responded: boolean;
  response_time_minutes: number | null;
  message_count: number;
}

type ConvResponseFilter = 'all' | 'responded' | 'waiting';
type ConvLeadFilter = 'all' | 'has_lead' | 'no_lead' | 'closed' | 'refused' | 'funnel';

export function CTWACampaignAutomation() {
  const [links, setLinks] = useState<CampaignLink[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [addingAgent, setAddingAgent] = useState('');
  const [addingCampaign, setAddingCampaign] = useState('');
  const [addingInstance, setAddingInstance] = useState('');
  const [addingBoard, setAddingBoard] = useState('');
  const [addingStage, setAddingStage] = useState('');
  const [manualCampaignId, setManualCampaignId] = useState('');
  const [manualCampaignName, setManualCampaignName] = useState('');
  const [useManualInput, setUseManualInput] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const [applyToExisting, setApplyToExisting] = useState(false);
  
  const [linkConversations, setLinkConversations] = useState<Record<string, ConversationInfo[]>>({});
  const [conversationCounts, setConversationCounts] = useState<Record<string, number>>({});
  const [loadingConversations, setLoadingConversations] = useState<string | null>(null);
  const [bulkCreating, setBulkCreating] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; created: number } | null>(null);
  const [bulkFollowup, setBulkFollowup] = useState<{ running: boolean; current: number; total: number; success: number; failed: number }>({ running: false, current: 0, total: 0, success: 0, failed: 0 });
  const [sheetLink, setSheetLink] = useState<CampaignLink | null>(null);
  const [convResponseFilter, setConvResponseFilter] = useState<ConvResponseFilter>('all');
  const [convLeadFilter, setConvLeadFilter] = useState<ConvLeadFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [chatPreviewPhone, setChatPreviewPhone] = useState<string | null>(null);
  const [chatPreviewConv, setChatPreviewConv] = useState<ConversationInfo | null>(null);

  const getMetaCredentials = () => {
    const savedAccounts = localStorage.getItem('meta_saved_accounts');
    if (savedAccounts) {
      try {
        const accounts = JSON.parse(savedAccounts);
        const selectedIds = localStorage.getItem('meta_selected_account_ids');
        const selectedId = selectedIds ? JSON.parse(selectedIds)?.[0] : localStorage.getItem('meta_selected_account');
        const selected = accounts.find((a: any) => a.id === selectedId) || accounts[0];
        if (selected) {
          const adAccountId = selected.accountId || selected.adAccountId || selected.ad_account_id;
          return { accessToken: selected.accessToken, adAccountId };
        }
      } catch (e) { console.error('CTWA: Error parsing saved accounts:', e); }
    }
    return {
      accessToken: localStorage.getItem('meta_access_token'),
      adAccountId: localStorage.getItem('meta_ad_account_id'),
    };
  };

  const fetchMetaCampaigns = async () => {
    const { accessToken, adAccountId } = getMetaCredentials();
    console.log('CTWA: credentials check', { hasToken: !!accessToken, hasAccount: !!adAccountId });
    if (!accessToken || !adAccountId) {
      console.warn('CTWA: No Meta credentials found in localStorage. Keys present:', 
        Object.keys(localStorage).filter(k => k.includes('meta')));
      setUseManualInput(true);
      return;
    }
    setLoadingCampaigns(true);
    try {
      const formattedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      console.log('CTWA: Fetching campaigns for', formattedAdAccountId);
      const { data, error } = await cloudFunctions.invoke('list-meta-ads', {
        body: { accessToken, adAccountId: formattedAdAccountId, limit: 100, status: ['ACTIVE', 'PAUSED'] },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const campaigns: MetaCampaign[] = (data?.campaigns || []).map((c: any) => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        status: c.status || 'ACTIVE',
        destination_phone: c.destination_phone || null,
      }));
      console.log('CTWA: Found', campaigns.length, 'campaigns');
      setMetaCampaigns(campaigns);
      if (campaigns.length === 0) setUseManualInput(true);
      else setUseManualInput(false);
    } catch (err) {
      console.error('CTWA: Error fetching campaigns:', err);
      setUseManualInput(true);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const [linksRes, agentsRes, boardsRes, instancesRes]: any[] = await Promise.all([
      supabase.from('whatsapp_agent_campaign_links' as any).select('*'),
      supabase.from('wjia_command_shortcuts').select('id, shortcut_name, description').eq('is_active', true).order('shortcut_name'),
      supabase.from('kanban_boards' as any).select('id, name, stages'),
      supabase.from('whatsapp_instances').select('id, instance_name, owner_phone').eq('is_active', true).order('instance_name'),
    ]);

    setLinks((linksRes.data as any[]) || []);
    setAgents((agentsRes.data as Agent[]) || []);
    setBoards((boardsRes.data as Board[]) || []);
    setInstances((instancesRes.data as Instance[]) || []);
    setLoading(false);

    // Fetch conversation counts for each link
    if (linksRes.data?.length) {
      fetchConversationCounts(linksRes.data as CampaignLink[]);
    }
  };

  const fetchConversationCounts = async (currentLinks: CampaignLink[]) => {
    const counts: Record<string, number> = {};
    for (const link of currentLinks) {
      // Only count conversations that came from THIS campaign (not all agent conversations)
      const { data: campaignLeads } = await supabase
        .from('leads')
        .select('lead_phone')
        .eq('campaign_id', link.campaign_id);
      
      if (!campaignLeads?.length) {
        counts[link.id] = 0;
        continue;
      }

      const campaignPhones = campaignLeads
        .map(l => l.lead_phone?.replace(/\D/g, ''))
        .filter(Boolean);

      if (!campaignPhones.length) {
        counts[link.id] = 0;
        continue;
      }

      const { count } = await supabase
        .from('whatsapp_conversation_agents' as any)
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', link.agent_id)
        .in('phone', campaignPhones);
      counts[link.id] = count || 0;
    }
    setConversationCounts(counts);
  };

   const fetchLinkConversations = async (link: CampaignLink) => {
    setLoadingConversations(link.id);
    try {
      // Resolve instance_name for this link
      const linkedInstance = instances.find(i => i.id === (link as any).instance_id);
      const instanceName = linkedInstance?.instance_name;

      // Get unique phones ONLY from messages tagged with this exact campaign_id
      // No need for instance or group filters — if campaign_id is set, it came from this ad
      // Fetch ALL campaign messages using pagination to bypass the 1000-row limit
      let campaignMessages: any[] = [];
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page } = await supabase
          .from('whatsapp_messages')
          .select('phone, contact_name, instance_name')
          .eq('campaign_id', link.campaign_id)
          .range(offset, offset + pageSize - 1);
        if (!page || page.length === 0) break;
        campaignMessages = campaignMessages.concat(page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      // Deduplicate by phone+instance
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; instance_name: string; normalized_phone: string }>();
      (campaignMessages || []).forEach((m: any) => {
        const norm = m.phone?.replace(/\D/g, '');
        if (!norm) return;
        // Exclude WhatsApp groups (phone starts with 120363 or contains @g.us)
        if (norm.startsWith('120363') || m.phone?.includes('@g.us')) return;
        const key = `${norm}_${m.instance_name}`;
        if (!phoneMap.has(key)) {
          phoneMap.set(key, { phone: m.phone, contact_name: m.contact_name, instance_name: m.instance_name, normalized_phone: norm });
        }
      });

      if (!phoneMap.size) {
        setLinkConversations(prev => ({ ...prev, [link.id]: [] }));
        return;
      }

      // Build conversations list with enriched data
      const conversations: ConversationInfo[] = [];
      const rawPhones = Array.from(new Set(Array.from(phoneMap.values()).map(conv => conv.phone)));
      
      // Check agent assignment
      const { data: convAgents } = await supabase
        .from('whatsapp_conversation_agents' as any)
        .select('phone, instance_name, is_active')
        .eq('agent_id', link.agent_id);

      const agentMap = new Map<string, boolean>();
      (convAgents as any[] || []).forEach((ca: any) => {
        const normalizedAgentPhone = ca.phone?.replace(/\D/g, '');
        if (!normalizedAgentPhone) return;
        agentMap.set(`${normalizedAgentPhone}_${ca.instance_name || ''}`, !!ca.is_active);
      });

      // Check leads for these phones
      const { data: leads } = await supabase
        .from('leads')
        .select('id, lead_name, lead_phone, lead_status')
        .eq('campaign_id', link.campaign_id);

      const leadMap = new Map<string, { name: string; status: string }>();
      (leads || []).forEach((l: any) => {
        const norm = l.lead_phone?.replace(/\D/g, '');
        if (norm) leadMap.set(norm, { name: l.lead_name, status: l.lead_status || 'active' });
      });

      // Check contacts
      const { data: contacts } = rawPhones.length
        ? await supabase
            .from('contacts')
            .select('phone')
            .in('phone', rawPhones)
        : { data: [] as any[] };

      const contactSet = new Set<string>();
      (contacts || []).forEach((c: any) => {
        const norm = c.phone?.replace(/\D/g, '');
        if (norm) contactSet.add(norm);
      });

      // BATCH: Get last message + response info for ALL phones in one query per instance
      const instanceGroups = new Map<string, string[]>();
      for (const [, info] of phoneMap) {
        const key = info.instance_name || '__none__';
        if (!instanceGroups.has(key)) instanceGroups.set(key, []);
        instanceGroups.get(key)!.push(info.phone);
      }

      // Fetch ALL campaign messages with direction info using pagination
      let allCampaignMsgs: any[] = [];
      let msgOffset = 0;
      while (true) {
        const { data: msgPage } = await supabase
          .from('whatsapp_messages')
          .select('phone, contact_name, created_at, direction, instance_name')
          .eq('campaign_id', link.campaign_id)
          .order('created_at', { ascending: false })
          .range(msgOffset, msgOffset + pageSize - 1);
        if (!msgPage || msgPage.length === 0) break;
        allCampaignMsgs = allCampaignMsgs.concat(msgPage);
        if (msgPage.length < pageSize) break;
        msgOffset += pageSize;
      }

      // Group messages by phone+instance
      const msgsByKey = new Map<string, any[]>();
      (allCampaignMsgs || []).forEach((m: any) => {
        const norm = m.phone?.replace(/\D/g, '');
        if (!norm || norm.startsWith('120363') || m.phone?.includes('@g.us')) return;
        const key = `${norm}_${m.instance_name}`;
        if (!msgsByKey.has(key)) msgsByKey.set(key, []);
        msgsByKey.get(key)!.push(m);
      });

      for (const [, info] of phoneMap) {
        const conversationKey = `${info.normalized_phone}_${info.instance_name || ''}`;
        const msgs = msgsByKey.get(conversationKey) || [];

        const msgCount = msgs.length;
        const reversed = [...msgs].reverse();
        const firstInbound = reversed.find(m => m.direction === 'inbound');
        const firstOutbound = reversed.find(m => m.direction === 'outbound');
        
        let wasResponded = false;
        let responseTimeMins: number | null = null;
        if (firstInbound && firstOutbound) {
          const inTime = new Date(firstInbound.created_at).getTime();
          const outTime = new Date(firstOutbound.created_at).getTime();
          if (outTime > inTime) {
            wasResponded = true;
            responseTimeMins = Math.floor((outTime - inTime) / 60000);
          }
        }

        const leadInfo = leadMap.get(info.normalized_phone);

        conversations.push({
          phone: info.phone,
          contact_name: msgs[0]?.contact_name || info.contact_name || info.phone,
          last_message_at: msgs[0]?.created_at || null,
          is_agent_active: agentMap.get(conversationKey) ?? false,
          has_lead: !!leadInfo,
          has_contact: contactSet.has(info.normalized_phone),
          lead_status: leadInfo?.status || null,
          lead_name: leadInfo?.name || null,
          instance_name: msgs[0]?.instance_name || info.instance_name,
          was_responded: wasResponded,
          response_time_minutes: responseTimeMins,
          message_count: msgCount,
        });
      }

      conversations.sort((a, b) => {
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });

      setLinkConversations(prev => ({ ...prev, [link.id]: conversations }));
    } catch (err) {
      console.error('Error fetching conversations:', err);
    } finally {
      setLoadingConversations(null);
    }
  };

  const normalizePhone = (phone: string) => phone.replace(/\D/g, '').slice(-8);
  
  const findInstanceByPhone = (destPhone: string): Instance | undefined => {
    if (!destPhone) return undefined;
    const normDest = normalizePhone(destPhone);
    return instances.find(inst => {
      if (!inst.owner_phone) return false;
      return normalizePhone(inst.owner_phone) === normDest;
    });
  };

  useEffect(() => {
    if (metaCampaigns.length === 0 || instances.length === 0 || links.length === 0) return;
    links.forEach(link => {
      const linkAny = link as any;
      if (linkAny.instance_id) return;
      const camp = metaCampaigns.find(c => c.campaign_id === link.campaign_id);
      if (!camp?.destination_phone) return;
      const matchedInst = findInstanceByPhone(camp.destination_phone);
      if (matchedInst) {
        handleUpdate(link.id, { instance_id: matchedInst.id } as any);
      }
    });
  }, [metaCampaigns, instances, links.length]);

  useEffect(() => {
    fetchData();
    fetchMetaCampaigns();
  }, []);

  const handleOpenConversations = (link: CampaignLink) => {
    setSheetLink(link);
    setConvResponseFilter('all');
    setConvLeadFilter('all');
    if (!linkConversations[link.id]) {
      fetchLinkConversations(link);
    }
  };

  const handleBulkFollowup = async () => {
    if (!sheetLink || bulkFollowup.running) return;
    
    const allConvs = linkConversations[sheetLink.id] || [];
    const filtered = allConvs.filter(conv => {
      if (convResponseFilter === 'responded' && !conv.was_responded) return false;
      if (convResponseFilter === 'waiting' && conv.was_responded) return false;
      if (convLeadFilter === 'has_lead' && !conv.has_lead) return false;
      if (convLeadFilter === 'no_lead' && conv.has_lead) return false;
      if (convLeadFilter === 'funnel' && !(conv.has_lead && conv.lead_status === 'active')) return false;
      if (convLeadFilter === 'closed' && !(conv.has_lead && conv.lead_status === 'closed')) return false;
      if (convLeadFilter === 'refused' && !(conv.has_lead && conv.lead_status === 'refused')) return false;
      return true;
    });

    if (filtered.length === 0) {
      toast.error('Nenhuma conversa no filtro atual');
      return;
    }

    const confirmMsg = `Disparar agente IA para ${filtered.length} conversa(s) filtrada(s)?`;
    if (!confirm(confirmMsg)) return;

    setBulkFollowup({ running: true, current: 0, total: filtered.length, success: 0, failed: 0 });

    let success = 0;
    let failed = 0;

    let skipped = 0;

    for (let i = 0; i < filtered.length; i++) {
      const conv = filtered[i];
      setBulkFollowup(prev => ({ ...prev, current: i + 1 }));

      try {
        // Fetch last inbound message to use as context
        const { data: lastMsg } = await supabase
          .from('whatsapp_messages')
          .select('message_text, message_type')
          .eq('phone', conv.phone)
          .eq('instance_name', conv.instance_name)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const messageText = (lastMsg as any)?.message_text || 'Olá';
        const messageType = (lastMsg as any)?.message_type || 'text';

        const { data, error } = await cloudFunctions.invoke('whatsapp-ai-agent-reply', {
          body: {
            phone: conv.phone,
            instance_name: conv.instance_name,
            message_text: messageText,
            message_type: messageType,
            is_group: false,
            contact_name: conv.contact_name || conv.lead_name || null,
            is_followup: true,
          },
        });

        if (error) {
          console.error(`Followup error for ${conv.phone}:`, error);
          failed++;
        } else if (data?.skipped) {
          console.warn(`Followup skipped for ${conv.phone}: ${data.reason}`);
          skipped++;
        } else {
          console.log(`Followup sent to ${conv.phone}:`, data);
          success++;
        }
      } catch (err) {
        console.error(`Followup error for ${conv.phone}:`, err);
        failed++;
      }

      // Small delay between calls to avoid rate limiting
      if (i < filtered.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setBulkFollowup({ running: false, current: filtered.length, total: filtered.length, success, failed });
    console.log(`Bulk followup completed: ${success} sent, ${skipped} skipped, ${failed} errors`);
    if (failed > 0 || skipped > 0) {
      const parts = [];
      if (success > 0) parts.push(`${success} enviados`);
      if (skipped > 0) parts.push(`${skipped} pulados (sem agente ou pausado)`);
      if (failed > 0) parts.push(`${failed} com erro`);
      toast.warning(`Follow-up: ${parts.join(', ')}`);
    } else {
      toast.success(`Follow-up concluído: ${success} enviados com sucesso!`);
    }
    
    // Refresh conversations after a small delay
    setTimeout(() => {
      if (sheetLink) fetchLinkConversations(sheetLink);
    }, 3000);
  };


  const handleBulkCreateLeads = async (link: CampaignLink) => {
    const linkAny = link as any;
    if (!linkAny.board_id) {
      toast.error('Configure um funil de destino antes de criar leads em massa');
      return;
    }
    
    setBulkCreating(link.id);
    setBulkProgress({ current: 0, total: 0, created: 0 });
    
    let offset = 0;
    let totalCreated = 0;
    const batchSize = 5;
    
    try {
      while (true) {
        const { data, error } = await cloudFunctions.invoke('bulk-create-leads-from-campaign', {
          body: {
            campaign_id: link.campaign_id,
            board_id: linkAny.board_id,
            stage_id: linkAny.stage_id || null,
            batch_size: batchSize,
            offset,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        totalCreated += data.processed || 0;
        setBulkProgress({
          current: Math.min(offset + batchSize, data.total_new),
          total: data.total_new,
          created: totalCreated,
        });

        if (data.done) break;
        offset = data.offset;
        
        // Small delay between batches
        await new Promise(r => setTimeout(r, 500));
      }

      toast.success(`${totalCreated} leads e contatos criados com sucesso!`);
      fetchData();
    } catch (err) {
      console.error('Bulk create error:', err);
      toast.error('Erro na criação em massa: ' + String(err));
    } finally {
      setBulkCreating(null);
      setBulkProgress(null);
    }
  };

  const handleTogglePause = async (link: CampaignLink) => {
    const linkAny = link as any;
    const newActive = !(linkAny.is_active !== false);
    await supabase.from('whatsapp_agent_campaign_links').update({ is_active: newActive } as any).eq('id', link.id);
    toast.success(newActive ? 'Vínculo reativado!' : 'Vínculo pausado!');
    fetchData();
  };

  const handleAddLink = async () => {
    if (!addingAgent) return;

    let campaignId = '';
    let campaignName = '';

    if (useManualInput) {
      if (!manualCampaignId) return;
      campaignId = manualCampaignId;
      campaignName = manualCampaignName || manualCampaignId;
    } else {
      if (!addingCampaign) return;
      campaignId = addingCampaign;
      const camp = metaCampaigns.find(c => c.campaign_id === addingCampaign);
      campaignName = camp?.campaign_name || addingCampaign;
    }

    const camp = metaCampaigns.find(c => c.campaign_id === campaignId);
    const detectedInstance = camp?.destination_phone ? findInstanceByPhone(camp.destination_phone) : undefined;

    const payload: any = {
      agent_id: addingAgent,
      campaign_id: campaignId,
      campaign_name: campaignName,
    };
    if (detectedInstance) payload.instance_id = detectedInstance.id;
    else if (addingInstance) payload.instance_id = addingInstance;
    if (addingBoard) payload.board_id = addingBoard;
    if (addingStage) payload.stage_id = addingStage;

    const { error } = await supabase.from('whatsapp_agent_campaign_links').upsert(payload, { onConflict: 'campaign_id' });

    if (error) { toast.error('Erro ao vincular'); return; }

    // If apply to existing, assign agent to existing conversations from this campaign
    if (applyToExisting) {
      await applyAgentToExistingConversations(campaignId, addingAgent, detectedInstance?.id || addingInstance);
    }

    toast.success('Campanha vinculada!');
    setAddingAgent('');
    setAddingCampaign('');
    setAddingInstance('');
    setAddingBoard('');
    setAddingStage('');
    setManualCampaignId('');
    setManualCampaignName('');
    setApplyToExisting(false);
    fetchData();
  };

  const applyAgentToExistingConversations = async (campaignId: string, agentId: string, instanceId?: string) => {
    try {
      // Find leads that came from this campaign
      const { data: leads } = await supabase
        .from('leads')
        .select('lead_phone, id')
        .eq('campaign_id', campaignId);

      if (!leads?.length) return;

      // Get instance name for these conversations
      let instanceName = '';
      if (instanceId) {
        const inst = instances.find(i => i.id === instanceId);
        instanceName = inst?.instance_name || '';
      }

      let applied = 0;
      for (const lead of leads) {
        if (!lead.lead_phone) continue;
        const phone = lead.lead_phone.replace(/\D/g, '');
        
        // Check if already has agent assigned
        const { data: existing } = await supabase
          .from('whatsapp_conversation_agents' as any)
          .select('id')
          .eq('phone', phone)
          .limit(1);

        if (existing?.length) continue;

        // Assign agent
        await supabase.from('whatsapp_conversation_agents' as any).insert({
          phone,
          agent_id: agentId,
          instance_name: instanceName,
          is_active: true,
          activated_by: 'campaign_retroactive',
        });
        applied++;
      }

      if (applied > 0) {
        toast.success(`Agente aplicado a ${applied} conversa(s) existente(s)`);
      }
    } catch (err) {
      console.error('Error applying to existing:', err);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('whatsapp_agent_campaign_links').delete().eq('id', id);
    toast.success('Vínculo removido');
    fetchData();
  };

  const handleUpdate = async (id: string, updates: Partial<CampaignLink>) => {
    const { error } = await supabase.from('whatsapp_agent_campaign_links').update(updates as any).eq('id', id);
    if (error) {
      console.error('Update error:', error);
      toast.error('Erro ao atualizar: ' + error.message);
      return;
    }
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando campanhas...</span>
      </div>
    );
  }

  const linkedCampaignIds = new Set(links.map(l => l.campaign_id));
  const unlinkedCampaigns = metaCampaigns.filter(c => !linkedCampaignIds.has(c.campaign_id));
  const activeCampaigns = unlinkedCampaigns.filter(c => c.status === 'ACTIVE');
  const pausedCampaigns = unlinkedCampaigns.filter(c => c.status !== 'ACTIVE');

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}min atrás`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h atrás`;
    return `${Math.floor(hrs / 24)}d atrás`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Automação de Campanhas CTWA
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Configure a criação automática de leads e o funil de destino para cada campanha Click-to-WhatsApp.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {links.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma campanha vinculada. Adicione abaixo para configurar automações.
          </p>
        )}

        {links.map(link => {
          const linkAny = link as any;
          const selectedBoard = boards.find(b => b.id === linkAny.board_id);
          const boardStages = selectedBoard?.stages || [];
          const isActive = linkAny.is_active !== false;
          const convCount = conversationCounts[link.id] || 0;

          return (
            <div key={link.id} className={`border rounded-lg p-4 space-y-3 transition-opacity ${!isActive ? 'opacity-60 border-dashed' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate">{link.campaign_name || link.campaign_id}</span>
                    {!isActive && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Pausado</Badge>
                    )}
                  </div>
                  {(() => {
                    const camp = metaCampaigns.find(c => c.campaign_id === link.campaign_id);
                    if (!camp?.destination_phone) return null;
                    const matchedInst = findInstanceByPhone(camp.destination_phone);
                    return (
                      <div className="ml-6 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {camp.destination_phone}
                        </span>
                        {matchedInst && (
                          <span className="text-[10px] text-green-600 flex items-center gap-1">
                            ✅ Instância detectada: {matchedInst.instance_name}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Conversations button */}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 px-2 text-[10px] gap-1"
                    onClick={() => handleOpenConversations(link)}
                  >
                    <MessageSquare className="h-3 w-3" />
                    {convCount > 0 && <span>{convCount}</span>}
                  </Button>
                  {/* Pause/Resume */}
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7" 
                    onClick={() => handleTogglePause(link)}
                    title={isActive ? 'Pausar vínculo' : 'Reativar vínculo'}
                  >
                    {isActive ? <Pause className="h-3.5 w-3.5 text-amber-500" /> : <Play className="h-3.5 w-3.5 text-green-500" />}
                  </Button>
                  {/* Delete */}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(link.id)}>
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {isActive && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> Instância
                      </Label>
                      <Select value={linkAny.instance_id || ''} onValueChange={v => handleUpdate(link.id, { instance_id: v || null } as any)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {instances.map(inst => (
                            <SelectItem key={inst.id} value={inst.id}>
                              {inst.instance_name} {inst.owner_phone ? `(${inst.owner_phone})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Agente IA
                      </Label>
                      <Select value={link.agent_id} onValueChange={v => handleUpdate(link.id, { agent_id: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {agents.map(a => <SelectItem key={a.id} value={a.id}>#{a.shortcut_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Agente pós-fechamento */}
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-emerald-500" /> Agente IA pós-fechamento (lead fechado)
                    </Label>
                    <Select 
                      value={linkAny.closed_agent_id || 'none'} 
                      onValueChange={v => handleUpdate(link.id, { closed_agent_id: v === 'none' ? null : v } as any)}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Mesmo agente" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">Sem agente específico (mesmo agente)</SelectItem>
                        {agents.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">#{a.shortcut_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">
                      Quando o lead for fechado, este agente assumirá a conversa automaticamente.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <FolderKanban className="h-3 w-3" /> Funil
                      </Label>
                      <Select value={linkAny.board_id || ''} onValueChange={v => handleUpdate(link.id, { board_id: v || null, stage_id: null } as any)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Etapa inicial</Label>
                      <Select
                        value={linkAny.stage_id || ''}
                        onValueChange={v => handleUpdate(link.id, { stage_id: v || null } as any)}
                        disabled={!linkAny.board_id}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {boardStages.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      id={`auto-lead-${link.id}`}
                      checked={linkAny.auto_create_lead || false}
                      onCheckedChange={v => handleUpdate(link.id, { auto_create_lead: v } as any)}
                    />
                    <Label htmlFor={`auto-lead-${link.id}`} className="text-xs">
                      Criar lead automaticamente quando mensagem chegar desta campanha
                    </Label>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Add new link form */}
        <div className="border border-dashed rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Vincular nova campanha
          </p>
          <div className="space-y-3">
            {/* Campaign selector */}
            {useManualInput ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Campanha</Label>
                  <div className="flex items-center gap-1">
                    <button className="text-[10px] text-primary underline" onClick={() => fetchMetaCampaigns()}>
                      Buscar campanhas
                    </button>
                    {metaCampaigns.length > 0 && (
                      <button className="text-[10px] text-primary underline" onClick={() => setUseManualInput(false)}>
                        Selecionar da lista
                      </button>
                    )}
                  </div>
                </div>
                {loadingCampaigns && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground py-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Buscando campanhas...
                  </div>
                )}
                <Input
                  className="h-8 text-xs"
                  placeholder="Ex: 123456789"
                  value={manualCampaignId}
                  onChange={e => setManualCampaignId(e.target.value)}
                />
                <Input
                  className="h-8 text-xs mt-1"
                  placeholder="Nome da campanha (opcional)"
                  value={manualCampaignName}
                  onChange={e => setManualCampaignName(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Campanha</Label>
                  <div className="flex items-center gap-1">
                    <button className="text-[10px] text-primary underline" onClick={() => setUseManualInput(true)}>
                      Digitar manualmente
                    </button>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={fetchMetaCampaigns} disabled={loadingCampaigns}>
                      <RefreshCw className={`h-3 w-3 ${loadingCampaigns ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
                <Select value={addingCampaign} onValueChange={(val) => {
                  setAddingCampaign(val);
                  const camp = metaCampaigns.find(c => c.campaign_id === val);
                  if (camp?.destination_phone) {
                    const matched = findInstanceByPhone(camp.destination_phone);
                    if (matched) setAddingInstance(matched.id);
                  }
                }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar campanha..." /></SelectTrigger>
                  <SelectContent>
                    {activeCampaigns.length > 0 && (
                      <div className="px-2 py-1 text-[10px] font-semibold text-green-600 uppercase tracking-wider">🟢 Ativas</div>
                    )}
                    {activeCampaigns.map(c => (
                      <SelectItem key={c.campaign_id} value={c.campaign_id}>
                        <div className="flex flex-col">
                          <span>{c.campaign_name}</span>
                          {c.destination_phone && (
                            <span className="text-[10px] text-muted-foreground">📞 {c.destination_phone}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                    {showPaused && pausedCampaigns.length > 0 && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">⏸ Pausadas</div>
                        {pausedCampaigns.map(c => (
                          <SelectItem key={c.campaign_id} value={c.campaign_id}>
                            <div className="flex flex-col">
                              <span>{c.campaign_name}</span>
                              {c.destination_phone && (
                                <span className="text-[10px] text-muted-foreground">📞 {c.destination_phone}</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {!showPaused && pausedCampaigns.length > 0 && (
                      <div
                        className="px-2 py-1.5 text-[10px] text-primary cursor-pointer hover:bg-accent rounded"
                        onPointerDown={(e) => { e.preventDefault(); setShowPaused(true); }}
                      >
                        Mostrar {pausedCampaigns.length} campanha(s) pausada(s)
                      </div>
                    )}
                    {activeCampaigns.length === 0 && pausedCampaigns.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhuma campanha disponível
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Instance info (auto-detected) */}
            {(() => {
              const selectedCamp = metaCampaigns.find(c => c.campaign_id === addingCampaign);
              const detectedInstance = selectedCamp?.destination_phone ? findInstanceByPhone(selectedCamp.destination_phone) : undefined;
              return selectedCamp?.destination_phone ? (
                <div className="space-y-1 bg-muted/50 rounded-md p-2">
                  <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> Instância detectada
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">
                      {detectedInstance ? (
                        <span className="flex items-center gap-1 text-green-600">
                          ✅ {detectedInstance.instance_name} ({detectedInstance.owner_phone})
                        </span>
                      ) : (
                        <span className="text-amber-600 text-xs">
                          ⚠️ Nenhuma instância com o número {selectedCamp.destination_phone}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Agent selector */}
            <div className="space-y-1">
              <Label className="text-[10px]">Agente IA (exclusivo para leads desta campanha)</Label>
              <Select value={addingAgent} onValueChange={setAddingAgent}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar agente..." /></SelectTrigger>
                <SelectContent>
                  {agents.length > 0 ? (
                    agents.map(a => <SelectItem key={a.id} value={a.id}>#{a.shortcut_name}</SelectItem>)
                  ) : (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum agente ativo</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Board / Stage selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] flex items-center gap-1">
                  <FolderKanban className="h-3 w-3" /> Funil de destino
                </Label>
                <Select value={addingBoard} onValueChange={v => { setAddingBoard(v); setAddingStage(''); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar funil..." /></SelectTrigger>
                  <SelectContent>
                    {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Etapa inicial</Label>
                <Select value={addingStage} onValueChange={setAddingStage} disabled={!addingBoard}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    {(boards.find(b => b.id === addingBoard)?.stages || []).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Apply to existing conversations toggle */}
            <div className="flex items-center gap-2 bg-muted/50 rounded-md p-2">
              <Switch
                id="apply-existing"
                checked={applyToExisting}
                onCheckedChange={setApplyToExisting}
              />
              <Label htmlFor="apply-existing" className="text-xs leading-tight">
                Aplicar também às conversas antigas que vieram desta campanha
              </Label>
            </div>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!addingAgent || (useManualInput ? !manualCampaignId : !addingCampaign)}
            onClick={handleAddLink}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Vincular
          </Button>
        </div>
      </CardContent>

      {/* Conversations Sheet */}
      <Sheet open={!!sheetLink} onOpenChange={(open) => { if (!open) setSheetLink(null); }}>
        <SheetContent className="w-[400px] sm:w-[450px] p-0 flex flex-col">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-5 w-5 text-primary" />
              Conversas da Campanha
              {sheetLink && (() => {
                const convs = linkConversations[sheetLink.id] || [];
                return ` (${convs.length})`;
              })()}
            </SheetTitle>
            {sheetLink && (
              <p className="text-xs text-muted-foreground truncate">{sheetLink.campaign_name}</p>
            )}
          </SheetHeader>

          {/* Response filters */}
          <div className="px-4 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all' as ConvResponseFilter, label: 'Todas' },
                { key: 'responded' as ConvResponseFilter, label: '✓ Respondidas' },
                { key: 'waiting' as ConvResponseFilter, label: '⏳ Aguardando' },
              ].map(f => {
                const convs = sheetLink ? (linkConversations[sheetLink.id] || []) : [];
                const count = f.key === 'all' ? convs.length :
                  f.key === 'responded' ? convs.filter(c => c.was_responded).length :
                  convs.filter(c => !c.was_responded).length;
                return (
                  <button
                    key={f.key}
                    onClick={() => setConvResponseFilter(f.key)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                      convResponseFilter === f.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-accent'
                    }`}
                  >
                    {f.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Lead status filters */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all' as ConvLeadFilter, label: '📋 Todos' },
                { key: 'has_lead' as ConvLeadFilter, label: '🎯 Com Lead' },
                { key: 'no_lead' as ConvLeadFilter, label: '❌ Sem Lead' },
                { key: 'funnel' as ConvLeadFilter, label: '🔄 Em Andamento' },
                { key: 'closed' as ConvLeadFilter, label: '✅ Fechado' },
                { key: 'refused' as ConvLeadFilter, label: '🚫 Recusado' },
              ].map(f => {
                const convs = sheetLink ? (linkConversations[sheetLink.id] || []) : [];
                const count = f.key === 'all' ? convs.length :
                  f.key === 'has_lead' ? convs.filter(c => c.has_lead).length :
                  f.key === 'no_lead' ? convs.filter(c => !c.has_lead).length :
                  f.key === 'funnel' ? convs.filter(c => c.has_lead && c.lead_status === 'active').length :
                  f.key === 'closed' ? convs.filter(c => c.has_lead && c.lead_status === 'closed').length :
                  convs.filter(c => c.has_lead && c.lead_status === 'refused').length;
                return (
                  <button
                    key={f.key}
                    onClick={() => setConvLeadFilter(f.key)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      convLeadFilter === f.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-accent'
                    }`}
                  >
                    {f.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Bulk follow-up button */}
            <div className="mt-2">
              {bulkFollowup.running ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Disparando agente IA...
                    </span>
                    <span>{bulkFollowup.success} ok / {bulkFollowup.current} de {bulkFollowup.total}</span>
                  </div>
                  <Progress value={bulkFollowup.total > 0 ? (bulkFollowup.current / bulkFollowup.total) * 100 : 0} className="h-1.5" />
                </div>
              ) : bulkFollowup.total > 0 ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-green-600 font-medium">
                      ✅ Concluído: {bulkFollowup.success} enviados{bulkFollowup.failed > 0 ? `, ${bulkFollowup.failed} erros` : ''}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] px-2"
                      onClick={() => setBulkFollowup({ running: false, current: 0, total: 0, success: 0, failed: 0 })}
                    >
                      Fechar
                    </Button>
                  </div>
                  <Progress value={100} className="h-1.5" />
                </div>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5 w-full"
                  onClick={handleBulkFollowup}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Re-disparar Agente IA ({(() => {
                    const allConvs = sheetLink ? (linkConversations[sheetLink.id] || []) : [];
                    return allConvs.filter(conv => {
                      if (convResponseFilter === 'responded' && !conv.was_responded) return false;
                      if (convResponseFilter === 'waiting' && conv.was_responded) return false;
                      if (convLeadFilter === 'has_lead' && !conv.has_lead) return false;
                      if (convLeadFilter === 'no_lead' && conv.has_lead) return false;
                      if (convLeadFilter === 'funnel' && !(conv.has_lead && conv.lead_status === 'active')) return false;
                      if (convLeadFilter === 'closed' && !(conv.has_lead && conv.lead_status === 'closed')) return false;
                      if (convLeadFilter === 'refused' && !(conv.has_lead && conv.lead_status === 'refused')) return false;
                      return true;
                    }).length;
                  })()} conversas)
                </Button>
              )}
            </div>
          </div>

          {/* Conversations list */}
          <ScrollArea className="flex-1 px-4 pb-4 mt-2">
            {sheetLink && loadingConversations === sheetLink.id ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Carregando conversas...</span>
              </div>
            ) : sheetLink && (linkConversations[sheetLink.id] || []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conversa encontrada.</p>
            ) : (
              <div className="space-y-2">
                {sheetLink && (linkConversations[sheetLink.id] || [])
                  .filter(conv => {
                    if (convResponseFilter === 'responded' && !conv.was_responded) return false;
                    if (convResponseFilter === 'waiting' && conv.was_responded) return false;
                    if (convLeadFilter === 'has_lead' && !conv.has_lead) return false;
                    if (convLeadFilter === 'no_lead' && conv.has_lead) return false;
                    if (convLeadFilter === 'funnel' && !(conv.has_lead && conv.lead_status === 'active')) return false;
                    if (convLeadFilter === 'closed' && !(conv.has_lead && conv.lead_status === 'closed')) return false;
                    if (convLeadFilter === 'refused' && !(conv.has_lead && conv.lead_status === 'refused')) return false;
                    return true;
                  })
                  .map((conv, i) => {
                    const displayName = conv.lead_name || conv.contact_name || conv.phone;
                    const formatWait = (mins: number | null) => {
                      if (mins === null) return '';
                      if (mins < 60) return `${mins}min`;
                      const h = Math.floor(mins / 60);
                      const m = mins % 60;
                      return m > 0 ? `${h}h${m}min` : `${h}h`;
                    };
                    const waitingMinutes = conv.was_responded
                      ? conv.response_time_minutes
                      : conv.last_message_at ? Math.floor((Date.now() - new Date(conv.last_message_at).getTime()) / 60000) : null;
                    
                    return (
                      <div
                        key={`${conv.phone}-${i}`}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                        onClick={() => {
                          setChatPreviewConv(conv);
                          setChatPreviewPhone(conv.phone);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium truncate">{displayName}</p>
                            {conv.has_lead && conv.lead_status === 'closed' && <Badge variant="default" className="text-[8px] px-1 py-0 h-3.5 shrink-0 bg-emerald-600">Fechado</Badge>}
                            {conv.has_lead && conv.lead_status === 'refused' && <Badge variant="destructive" className="text-[8px] px-1 py-0 h-3.5 shrink-0">Recusado</Badge>}
                            {conv.has_lead && conv.lead_status === 'active' && <Badge variant="default" className="text-[8px] px-1 py-0 h-3.5 shrink-0">Lead</Badge>}
                            {conv.has_contact && !conv.has_lead && <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 shrink-0">Contato</Badge>}
                            {!conv.has_lead && !conv.has_contact && <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 shrink-0 text-muted-foreground">Sem vínculo</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground" data-callface-ignore="true">{conv.phone}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {conv.instance_name && <span className="text-[10px] text-muted-foreground">{conv.instance_name}</span>}
                            {conv.was_responded ? (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 bg-emerald-50 text-emerald-700 border-emerald-200">
                                ✓ Respondido em {formatWait(conv.response_time_minutes)}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 bg-amber-50 text-amber-700 border-amber-200">
                                ⏳ Aguardando há {formatWait(waitingMinutes)}
                              </Badge>
                            )}
                            {conv.message_count > 0 && (
                              <span className="text-[10px] text-muted-foreground">{conv.message_count} msgs</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2 flex flex-col items-end gap-1">
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(conv.last_message_at)}
                          </span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Bulk create leads button */}
            {sheetLink && (
              <div className="mt-4 pt-3 border-t border-border/50">
                {bulkCreating === sheetLink.id && bulkProgress ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Brain className="h-3 w-3 animate-pulse" /> Analisando conversas com IA...
                      </span>
                      <span>{bulkProgress.created} criados / {bulkProgress.total} total</span>
                    </div>
                    <Progress value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0} className="h-1.5" />
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 w-full"
                    onClick={() => handleBulkCreateLeads(sheetLink)}
                    disabled={!!bulkCreating}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Criar leads e contatos via IA (análise de conversas)
                  </Button>
                )}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <DashboardChatPreview
        open={!!chatPreviewPhone}
        onOpenChange={(open) => { if (!open) { setChatPreviewPhone(null); setChatPreviewConv(null); } }}
        phone={chatPreviewPhone}
        contactName={chatPreviewConv?.contact_name || chatPreviewConv?.lead_name || null}
        instanceName={chatPreviewConv?.instance_name || null}
        hasLead={chatPreviewConv?.has_lead || false}
        hasContact={chatPreviewConv?.has_contact || false}
        wasResponded={chatPreviewConv?.was_responded || false}
        responseTimeMinutes={chatPreviewConv?.response_time_minutes || null}
        campaignBoardId={(sheetLink as any)?.board_id || null}
        campaignStageId={(sheetLink as any)?.stage_id || null}
      />
    </Card>
  );
}

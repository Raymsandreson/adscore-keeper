import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Megaphone,
  Search,
  MapPin,
  Users,
  Eye,
  MousePointer,
  DollarSign,
  Heart,
  MessageCircle,
  UserPlus,
  AlertCircle,
  TrendingUp,
  Clock,
  Plus,
  Download,
  Loader2,
  Link2,
  Check,
  FileText,
  Image,
  Trash2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateBriefingDialog } from "./CreateBriefingDialog";
import { useAdBriefings } from "@/hooks/useAdBriefings";
import { toast } from "sonner";

interface LeadWithAds {
  id: string;
  lead_name: string | null;
  victim_name: string | null;
  city: string | null;
  state: string | null;
  visit_city: string | null;
  visit_state: string | null;
  status: string | null;
  source: string | null;
  created_at: string;
  ads: PromotedPostRow[];
}

interface PromotedPostRow {
  id: string;
  campaign_name: string | null;
  status: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  followers_gained: number;
  comments_count: number;
  likes_count: number;
  engagement_rate: number;
  cpm: number;
  cpc: number;
  ctr: number;
  created_at: string;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
}

interface MetaCampaign {
  campaign_id: string;
  campaign_name: string;
  status: string;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  cpm: number;
  cpc: number;
  ctr: number;
  followers_gained: number;
  comments_count: number;
  likes_count: number;
  start_time?: string;
  created_time?: string;
}

export function LeadAdsManager() {
  const [leads, setLeads] = useState<any[]>([]);
  const [promotedPosts, setPromotedPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("meta");
  const [briefingDialogOpen, setBriefingDialogOpen] = useState(false);
  const [selectedLeadForBriefing, setSelectedLeadForBriefing] = useState<any>(null);

  // Import state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaign[]>([]);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [linkingCampaign, setLinkingCampaign] = useState<MetaCampaign | null>(null);
  const [leadSearchImport, setLeadSearchImport] = useState("");
  const [leadResultsImport, setLeadResultsImport] = useState<any[]>([]);
  const [isSearchingLeadsImport, setIsSearchingLeadsImport] = useState(false);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  
  // Lead linking flow (from "Sem Anúncio" tab)
  const [linkingLeadId, setLinkingLeadId] = useState<string | null>(null);

  // Briefings
  const { briefings, isLoading: isLoadingBriefings, deleteBriefing, updateBriefingStatus } = useAdBriefings();

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-fetch Meta campaigns on mount
  useEffect(() => {
    const { accessToken, adAccountId } = getMetaCredentials();
    if (accessToken && adAccountId && metaCampaigns.length === 0) {
      fetchMetaAds();
    }
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    const [leadsRes, adsRes] = await Promise.all([
      supabase
        .from("leads")
        .select("id, lead_name, victim_name, city, state, visit_city, visit_state, status, source, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("promoted_posts")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

    setLeads(leadsRes.data || []);
    setPromotedPosts(adsRes.data || []);
    setIsLoading(false);
  };

  // --- Meta Import Functions ---
  const getMetaCredentials = () => {
    const savedAccounts = localStorage.getItem('meta_saved_accounts');
    let accessToken: string | null = null;
    let adAccountId: string | null = null;
    if (savedAccounts) {
      const accounts = JSON.parse(savedAccounts);
      const selectedId = localStorage.getItem('meta_selected_account');
      const selected = accounts.find((a: any) => a.id === selectedId) || accounts[0];
      accessToken = selected?.accessToken || null;
      adAccountId = selected?.adAccountId || null;
    } else {
      accessToken = localStorage.getItem('meta_access_token');
      adAccountId = localStorage.getItem('meta_ad_account_id');
    }
    return { accessToken, adAccountId };
  };

  const fetchMetaAds = async () => {
    const { accessToken, adAccountId } = getMetaCredentials();
    if (!accessToken || !adAccountId) {
      toast.error("Token Meta não encontrado. Conecte sua conta primeiro.");
      return;
    }

    setIsLoadingMeta(true);
    try {
      const fields = 'name,status,objective,daily_budget,lifetime_budget,start_time,stop_time';
      const insightFields = 'impressions,reach,clicks,spend,cpm,cpc,ctr,actions,cost_per_action_type';
      
      // Fetch campaigns directly from Graph API (same approach as Dashboard)
      const campaignUrl = `https://graph.facebook.com/v21.0/${adAccountId}/campaigns?fields=${fields}&limit=50&access_token=${accessToken}`;
      const campaignRes = await fetch(campaignUrl);
      const campaignData = await campaignRes.json();
      
      if (campaignData.error) {
        throw new Error(campaignData.error.message || 'Erro ao buscar campanhas');
      }

      const rawCampaigns = campaignData.data || [];
      
      // Fetch insights for each campaign
      const campaignsWithInsights = await Promise.all(
        rawCampaigns.map(async (campaign: any) => {
          try {
            const insightUrl = `https://graph.facebook.com/v21.0/${campaign.id}/insights?fields=${insightFields}&date_preset=maximum&access_token=${accessToken}`;
            const insightRes = await fetch(insightUrl);
            const insightData = await insightRes.json();
            const insights = insightData.data?.[0] || {};
            const actions = insights.actions || [];
            const followAction = actions.find((a: any) => a.action_type === 'page_engagement' || a.action_type === 'like');
            const commentAction = actions.find((a: any) => a.action_type === 'comment');
            const likeAction = actions.find((a: any) => a.action_type === 'post_reaction' || a.action_type === 'like');

            return {
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              status: campaign.status?.toLowerCase() || 'unknown',
              objective: campaign.objective,
              daily_budget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
              lifetime_budget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
              impressions: Number(insights.impressions || 0),
              reach: Number(insights.reach || 0),
              clicks: Number(insights.clicks || 0),
              spend: Number(insights.spend || 0),
              cpm: Number(insights.cpm || 0),
              cpc: Number(insights.cpc || 0),
              ctr: Number(insights.ctr || 0),
              followers_gained: Number(followAction?.value || 0),
              comments_count: Number(commentAction?.value || 0),
              likes_count: Number(likeAction?.value || 0),
            };
          } catch {
            return {
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              status: campaign.status?.toLowerCase() || 'unknown',
              objective: campaign.objective,
              daily_budget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
              lifetime_budget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
              impressions: 0, reach: 0, clicks: 0, spend: 0,
              cpm: 0, cpc: 0, ctr: 0,
              followers_gained: 0, comments_count: 0, likes_count: 0,
            };
          }
        })
      );

      setMetaCampaigns(campaignsWithInsights);
    } catch (err) {
      console.error('Meta ads fetch error:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao buscar anúncios da Meta');
    } finally {
      setIsLoadingMeta(false);
    }
  };

  const importCampaignToLead = async (campaign: MetaCampaign, leadId: string) => {
    setImportingIds(prev => new Set(prev).add(campaign.campaign_id));
    try {
      const { error } = await supabase.from('promoted_posts').insert({
        post_title: campaign.campaign_name,
        post_platform: 'instagram',
        campaign_id: campaign.campaign_id,
        campaign_name: campaign.campaign_name,
        objective: campaign.objective,
        status: campaign.status,
        daily_budget: campaign.daily_budget,
        lifetime_budget: campaign.lifetime_budget,
        impressions: campaign.impressions,
        reach: campaign.reach,
        clicks: campaign.clicks,
        spend: campaign.spend,
        cpm: campaign.cpm,
        cpc: campaign.cpc,
        ctr: campaign.ctr,
        followers_gained: campaign.followers_gained,
        comments_count: campaign.comments_count,
        likes_count: campaign.likes_count,
        lead_id: leadId,
      });
      if (error) throw error;
      toast.success(`Campanha "${campaign.campaign_name}" vinculada ao lead!`);
      setLinkingCampaign(null);
      setLeadSearchImport("");
      await fetchData();
    } catch (err) {
      toast.error('Erro ao importar campanha');
      console.error(err);
    } finally {
      setImportingIds(prev => {
        const next = new Set(prev);
        next.delete(campaign.campaign_id);
        return next;
      });
    }
  };

  // Lead search for import linking
  useEffect(() => {
    if (!leadSearchImport.trim() || leadSearchImport.length < 2) {
      setLeadResultsImport([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingLeadsImport(true);
      const { data } = await supabase
        .from('leads')
        .select('id, lead_name, victim_name, city, state, visit_city, visit_state')
        .or(`lead_name.ilike.%${leadSearchImport}%,victim_name.ilike.%${leadSearchImport}%,city.ilike.%${leadSearchImport}%`)
        .limit(8);
      setLeadResultsImport(data || []);
      setIsSearchingLeadsImport(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [leadSearchImport]);

  // Check which campaigns are already imported
  const importedCampaignIds = new Set(promotedPosts.filter(p => p.campaign_id).map(p => p.campaign_id));

  const leadAdsMap = new Map<string, any[]>();
  for (const ad of promotedPosts) {
    if (ad.lead_id) {
      if (!leadAdsMap.has(ad.lead_id)) leadAdsMap.set(ad.lead_id, []);
      leadAdsMap.get(ad.lead_id)!.push(ad);
    }
  }

  const leadsWithAds = leads.filter((l) => leadAdsMap.has(l.id));
  const leadsWithoutAds = leads.filter((l) => !leadAdsMap.has(l.id));

  const filterLeads = (list: any[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (l) =>
        (l.lead_name || "").toLowerCase().includes(q) ||
        (l.victim_name || "").toLowerCase().includes(q) ||
        (l.city || "").toLowerCase().includes(q) ||
        (l.visit_city || "").toLowerCase().includes(q)
    );
  };

  const getLocation = (lead: any) => {
    const city = lead.visit_city || lead.city;
    const state = lead.visit_state || lead.state;
    return [city, state].filter(Boolean).join("/") || "Sem local";
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      active: { label: "Ativo", variant: "default" },
      paused: { label: "Pausado", variant: "secondary" },
      pending: { label: "Pendente", variant: "outline" },
      completed: { label: "Finalizado", variant: "secondary" },
    };
    const config = map[status] || { label: status, variant: "outline" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const totalSpend = leadsWithAds.reduce((sum, l) => {
    const ads = leadAdsMap.get(l.id) || [];
    return sum + ads.reduce((s: number, a: any) => s + (a.spend || 0), 0);
  }, 0);
  const totalReach = leadsWithAds.reduce((sum, l) => {
    const ads = leadAdsMap.get(l.id) || [];
    return sum + ads.reduce((s: number, a: any) => s + (a.reach || 0), 0);
  }, 0);
  const totalFollowers = leadsWithAds.reduce((sum, l) => {
    const ads = leadAdsMap.get(l.id) || [];
    return sum + ads.reduce((s: number, a: any) => s + (a.followers_gained || 0), 0);
  }, 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Megaphone className="h-4 w-4" />
              Com Anúncio
            </div>
            <p className="text-2xl font-bold mt-1">{leadsWithAds.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Sem Anúncio
            </div>
            <p className="text-2xl font-bold mt-1 text-destructive">{leadsWithoutAds.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              Investido
            </div>
            <p className="text-2xl font-bold mt-1">R$ {totalSpend.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UserPlus className="h-4 w-4" />
              Seguidores
            </div>
            <p className="text-2xl font-bold mt-1">{totalFollowers}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar lead por nome ou cidade..."
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchMetaAds}
          disabled={isLoadingMeta}
          className="gap-2"
        >
          {isLoadingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Atualizar Meta
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="meta" className="gap-2">
            <Download className="h-4 w-4" />
            Meta ({isLoadingMeta ? '...' : metaCampaigns.length})
          </TabsTrigger>
          <TabsTrigger value="briefings" className="gap-2">
            <FileText className="h-4 w-4" />
            Briefings ({briefings.length})
          </TabsTrigger>
          <TabsTrigger value="active" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Vinculados ({leadsWithAds.length})
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <AlertCircle className="h-4 w-4" />
            Sem Anúncio ({leadsWithoutAds.length})
          </TabsTrigger>
        </TabsList>

        {/* Meta campaigns tab - auto loaded */}
        <TabsContent value="meta" className="mt-4">
          {isLoadingMeta ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : linkingCampaign ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Vincular: {linkingCampaign.campaign_name}</CardTitle>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Gasto: R$ {linkingCampaign.spend.toFixed(2)}</span>
                  <span>Alcance: {linkingCampaign.reach.toLocaleString("pt-BR")}</span>
                  {getStatusBadge(linkingCampaign.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={leadSearchImport}
                    onChange={(e) => setLeadSearchImport(e.target.value)}
                    placeholder="Digite o nome do lead ou cidade..."
                    className="pl-9"
                    autoFocus
                  />
                </div>
                {leadResultsImport.length > 0 && (
                  <div className="border rounded-lg max-h-60 overflow-y-auto divide-y">
                    {leadResultsImport.map((lead) => {
                      const city = lead.visit_city || lead.city;
                      const state = lead.visit_state || lead.state;
                      return (
                        <button
                          key={lead.id}
                          type="button"
                          onClick={() => importCampaignToLead(linkingCampaign, lead.id)}
                          disabled={importingIds.has(linkingCampaign.campaign_id)}
                          className="w-full p-3 text-left hover:bg-muted/50 flex items-center justify-between transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium">{lead.lead_name || lead.victim_name || "Sem nome"}</p>
                            {(city || state) && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {[city, state].filter(Boolean).join("/")}
                              </p>
                            )}
                          </div>
                          {importingIds.has(linkingCampaign.campaign_id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Link2 className="h-4 w-4 text-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => { setLinkingCampaign(null); setLeadSearchImport(""); }}>
                  Voltar à lista
                </Button>
              </CardContent>
            </Card>
          ) : metaCampaigns.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {getMetaCredentials().accessToken
                  ? "Nenhuma campanha encontrada na conta Meta."
                  : "Conta Meta não conectada. Conecte na tela principal primeiro."}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {metaCampaigns.map((c) => {
                const alreadyImported = importedCampaignIds.has(c.campaign_id);
                return (
                  <Card key={c.campaign_id} className={alreadyImported ? "opacity-60" : ""}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{c.campaign_name}</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {getStatusBadge(c.status)}
                            {c.objective && (
                              <Badge variant="outline" className="text-xs">
                                {c.objective.replace("OUTCOME_", "")}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3" /> R$ {c.spend.toFixed(2)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" /> {c.reach.toLocaleString("pt-BR")} alcance
                            </span>
                            <span className="flex items-center gap-1">
                              <MousePointer className="h-3 w-3" /> {c.clicks} cliques
                            </span>
                            <span>CTR: {c.ctr.toFixed(2)}%</span>
                            <span>CPM: R$ {c.cpm.toFixed(2)}</span>
                          </div>
                        </div>
                        {alreadyImported ? (
                          <Badge variant="secondary" className="gap-1 shrink-0">
                            <Check className="h-3 w-3" /> Vinculado
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 shrink-0"
                            onClick={() => setLinkingCampaign(c)}
                          >
                            <Link2 className="h-3 w-3" />
                            Vincular a Lead
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          {linkingLeadId ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Vincular campanha a: {leads.find(l => l.id === linkingLeadId)?.lead_name || leads.find(l => l.id === linkingLeadId)?.victim_name || "Lead"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">Selecione uma campanha da Meta para vincular</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoadingMeta ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : metaCampaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma campanha encontrada. Conecte sua conta Meta primeiro.
                  </p>
                ) : (
                  metaCampaigns.filter(c => !importedCampaignIds.has(c.campaign_id)).map((c) => (
                    <div key={c.campaign_id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.campaign_name}</p>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                          {getStatusBadge(c.status)}
                          <span>R$ {c.spend.toFixed(2)}</span>
                          <span>{c.reach.toLocaleString("pt-BR")} alcance</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1 shrink-0"
                        disabled={importingIds.has(c.campaign_id)}
                        onClick={() => importCampaignToLead(c, linkingLeadId)}
                      >
                        {importingIds.has(c.campaign_id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Link2 className="h-3 w-3" />
                        )}
                        Vincular
                      </Button>
                    </div>
                  ))
                )}
                <Button variant="outline" size="sm" onClick={() => setLinkingLeadId(null)} className="mt-2">
                  Voltar à lista
                </Button>
              </CardContent>
            </Card>
          ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                Leads sem Anúncio
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Estes leads ainda não têm campanha de remarketing ativa.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                   <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Localização</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterLeads(leadsWithoutAds).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        {search ? "Nenhum lead encontrado" : "Todos os leads têm anúncios! 🎉"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filterLeads(leadsWithoutAds).slice(0, 50).map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <p className="font-medium text-sm">
                            {lead.lead_name || lead.victim_name || "Sem nome"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            {getLocation(lead)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{lead.status || "new"}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{lead.source || "-"}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => setLinkingLeadId(lead.id)}
                            >
                              <Link2 className="h-3 w-3" />
                              Vincular
                            </Button>
                            <Button
                              size="sm"
                              className="gap-1"
                              onClick={() => {
                                setSelectedLeadForBriefing(lead);
                                setBriefingDialogOpen(true);
                              }}
                            >
                              <FileText className="h-3 w-3" />
                              Briefing
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <div className="space-y-4">
            {filterLeads(leadsWithAds).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {search ? "Nenhum lead com anúncio encontrado" : "Nenhum lead com anúncio ainda. Use 'Importar Anúncios da Meta' para buscar campanhas existentes."}
                </CardContent>
              </Card>
            ) : (
              filterLeads(leadsWithAds).map((lead) => {
                const ads = leadAdsMap.get(lead.id) || [];
                const leadSpend = ads.reduce((s: number, a: any) => s + (a.spend || 0), 0);
                const leadReach = ads.reduce((s: number, a: any) => s + (a.reach || 0), 0);
                const leadFollowers = ads.reduce((s: number, a: any) => s + (a.followers_gained || 0), 0);
                const leadComments = ads.reduce((s: number, a: any) => s + (a.comments_count || 0), 0);

                return (
                  <Card key={lead.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">
                            {lead.lead_name || lead.victim_name || "Sem nome"}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3" />
                            {getLocation(lead)}
                          </p>
                        </div>
                        <Badge>{ads.length} anúncio(s)</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                        <div className="flex items-center gap-2 text-sm">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-muted-foreground text-xs">Investido</p>
                            <p className="font-medium">R$ {leadSpend.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Eye className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-muted-foreground text-xs">Alcance</p>
                            <p className="font-medium">{leadReach.toLocaleString("pt-BR")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <UserPlus className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-muted-foreground text-xs">Seguidores</p>
                            <p className="font-medium">{leadFollowers}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <MessageCircle className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-muted-foreground text-xs">Comentários</p>
                            <p className="font-medium">{leadComments}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Heart className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-muted-foreground text-xs">Curtidas</p>
                            <p className="font-medium">
                              {ads.reduce((s: number, a: any) => s + (a.likes_count || 0), 0)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Campanha</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Objetivo</TableHead>
                            <TableHead className="text-right">Gasto</TableHead>
                            <TableHead className="text-right">CPM</TableHead>
                            <TableHead className="text-right">CTR</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ads.map((ad: any) => (
                            <TableRow key={ad.id}>
                              <TableCell className="text-sm font-medium">
                                {ad.campaign_name || ad.post_title || "-"}
                              </TableCell>
                              <TableCell>{getStatusBadge(ad.status)}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {ad.objective?.replace("OUTCOME_", "") || "-"}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                R$ {(ad.spend || 0).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                R$ {(ad.cpm || 0).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {(ad.ctr || 0).toFixed(2)}%
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* Briefings Tab */}
        <TabsContent value="briefings" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Briefings de Criativos
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Criativos e copy preparados para o gestor de tráfego criar os anúncios no BM
                </p>
              </div>
              <Button size="sm" className="gap-1" onClick={() => { setSelectedLeadForBriefing(null); setBriefingDialogOpen(true); }}>
                <Plus className="h-3 w-3" /> Novo Briefing
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingBriefings ? (
                <div className="space-y-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : briefings.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhum briefing criado ainda.</p>
              ) : (
                <div className="space-y-3">
                  {briefings.map((b) => {
                    const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
                      pending: { label: "Pendente", variant: "outline" },
                      approved: { label: "Aprovado", variant: "default" },
                      created: { label: "Anúncio Criado", variant: "secondary" },
                      linked: { label: "Vinculado", variant: "default" },
                    };
                    const st = statusMap[b.status] || { label: b.status, variant: "outline" as const };
                    return (
                      <div key={b.id} className="flex gap-4 p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                        {/* Thumbnail */}
                        <div className="w-20 h-20 rounded-lg border overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                          {b.creative_url ? (
                            b.creative_type === "video" ? (
                              <video src={b.creative_url} className="w-full h-full object-cover" />
                            ) : (
                              <img src={b.creative_url} alt="" className="w-full h-full object-cover" />
                            )
                          ) : (
                            <Image className="h-8 w-8 text-muted-foreground" />
                          )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm truncate">{b.headline || "Sem título"}</p>
                              {b.lead_name && (
                                <p className="text-xs text-muted-foreground">Lead: {b.lead_name}</p>
                              )}
                              {b.body_text && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{b.body_text}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant={st.variant}>{st.label}</Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            {b.cta && <Badge variant="outline" className="text-xs">{b.cta.replace(/_/g, " ")}</Badge>}
                            <span className="text-xs text-muted-foreground">
                              {new Date(b.created_at).toLocaleDateString("pt-BR")}
                            </span>
                            {b.status === "pending" && (
                              <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={() => updateBriefingStatus(b.id, "approved")}>
                                <Check className="h-3 w-3" /> Aprovar
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive gap-1" onClick={() => deleteBriefing(b.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Briefing Dialog */}
      <CreateBriefingDialog
        open={briefingDialogOpen}
        onOpenChange={(open) => {
          setBriefingDialogOpen(open);
          if (!open) setSelectedLeadForBriefing(null);
        }}
        leadId={selectedLeadForBriefing?.id}
        leadName={selectedLeadForBriefing?.lead_name || selectedLeadForBriefing?.victim_name}
      />
    </div>
  );
}

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
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateAdDialog } from "./CreateAdDialog";
import type { Post } from "@/types/editorial";

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

export function LeadAdsManager() {
  const [leads, setLeads] = useState<any[]>([]);
  const [promotedPosts, setPromotedPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [adDialogOpen, setAdDialogOpen] = useState(false);
  const [selectedLeadForAd, setSelectedLeadForAd] = useState<any>(null);

  const dummyPost: Post = {
    id: selectedLeadForAd?.id || "lead-ad",
    title: selectedLeadForAd?.lead_name || selectedLeadForAd?.victim_name || "Anúncio para Lead",
    description: `Campanha para ${selectedLeadForAd?.lead_name || selectedLeadForAd?.victim_name || "lead"}`,
    platform: "instagram",
    status: "published",
    scheduled_date: new Date(),
    scheduled_time: "12:00",
    content_type: "image",
  };

  useEffect(() => {
    fetchData();
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

  // Build lead-ads map using lead_id from promoted_posts
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

  // Totals for leads with ads
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

      {/* Search + Tabs */}
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            <AlertCircle className="h-4 w-4" />
            Sem Anúncio ({leadsWithoutAds.length})
          </TabsTrigger>
          <TabsTrigger value="active" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Com Anúncio ({leadsWithAds.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
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
                    <TableHead>Criado em</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterLeads(leadsWithoutAds).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => {
                              setSelectedLeadForAd(lead);
                              setAdDialogOpen(true);
                            }}
                          >
                            <Plus className="h-3 w-3" />
                            Criar Anúncio
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <div className="space-y-4">
            {filterLeads(leadsWithAds).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {search ? "Nenhum lead com anúncio encontrado" : "Nenhum lead com anúncio ainda."}
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
                      {/* Metrics summary */}
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

                      {/* Ads table */}
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
      </Tabs>

      {selectedLeadForAd && (
        <CreateAdDialog
          open={adDialogOpen}
          onOpenChange={(open) => {
            setAdDialogOpen(open);
            if (!open) {
              setSelectedLeadForAd(null);
              fetchData();
            }
          }}
          post={dummyPost}
          leadLocation={{
            id: selectedLeadForAd.id,
            city: selectedLeadForAd.city,
            state: selectedLeadForAd.state,
            visit_city: selectedLeadForAd.visit_city,
            visit_state: selectedLeadForAd.visit_state,
            lead_name: selectedLeadForAd.lead_name || selectedLeadForAd.victim_name,
          }}
        />
      )}
    </div>
  );
}

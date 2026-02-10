import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon,
  Megaphone,
  Target,
  DollarSign,
  Users,
  Loader2,
  Rocket,
  MapPin,
  Search,
  X,
  ExternalLink,
  Image,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import type { Post } from "@/types/editorial";
import { usePromotedPosts } from "@/hooks/usePromotedPosts";

interface LeadLocation {
  id?: string;
  city?: string | null;
  state?: string | null;
  visit_city?: string | null;
  visit_state?: string | null;
  neighborhood?: string | null;
  lead_name?: string | null;
}

interface CreateAdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: Post;
  leadLocation?: LeadLocation | null;
}

const objectives = [
  { value: "OUTCOME_AWARENESS", label: "Reconhecimento", description: "Alcançar o máximo de pessoas" },
  { value: "OUTCOME_ENGAGEMENT", label: "Engajamento", description: "Curtidas, comentários e compartilhamentos" },
  { value: "OUTCOME_TRAFFIC", label: "Tráfego", description: "Enviar pessoas para um destino" },
  { value: "OUTCOME_LEADS", label: "Leads", description: "Gerar leads e cadastros" },
  { value: "OUTCOME_SALES", label: "Vendas", description: "Encontrar pessoas para comprar" },
];

export function CreateAdDialog({ open, onOpenChange, post, leadLocation }: CreateAdDialogProps) {
  const { createCampaign } = usePromotedPosts();
  const [isCreating, setIsCreating] = useState(false);
  const [step, setStep] = useState(1);

  const [campaignName, setCampaignName] = useState(`Promoção: ${post.title}`);
  const [objective, setObjective] = useState("OUTCOME_ENGAGEMENT");
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily");
  const [dailyBudget, setDailyBudget] = useState(20);
  const [lifetimeBudget, setLifetimeBudget] = useState(200);
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [ageRange, setAgeRange] = useState([25, 55]);
  const [genders, setGenders] = useState<number[]>([0]);
  const [postId, setPostId] = useState("");
  const [notes, setNotes] = useState("");

  // External posts selector
  const [externalPosts, setExternalPosts] = useState<any[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [selectedExternalPost, setSelectedExternalPost] = useState<any>(null);
  const [postSearch, setPostSearch] = useState("");

  // Creative fields
  const [creativeMode, setCreativeMode] = useState<"post" | "custom">("post");
  const [adImageUrl, setAdImageUrl] = useState("");
  const [adHeadline, setAdHeadline] = useState("");
  const [adBody, setAdBody] = useState("");
  const [adLinkDescription, setAdLinkDescription] = useState("");
  const [adCta, setAdCta] = useState("LEARN_MORE");

  // Lead search for location
  const [leadSearch, setLeadSearch] = useState("");
  const [leadResults, setLeadResults] = useState<any[]>([]);
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadLocation | null>(leadLocation || null);

  // Pre-fill location from selected lead or prop
  const activeLocation = selectedLead || leadLocation;
  const resolvedCity = activeLocation?.visit_city || activeLocation?.city || null;
  const resolvedState = activeLocation?.visit_state || activeLocation?.state || null;
  const resolvedNeighborhood = activeLocation?.neighborhood || null;
  const hasLeadLocation = !!(resolvedCity || resolvedState);

  // Fetch external posts (optionally filtered by lead)
  useEffect(() => {
    const fetchExternalPosts = async () => {
      setIsLoadingPosts(true);
      let query = supabase
        .from('external_posts')
        .select('id, url, post_id, title, description, author_username, platform, lead_id, comments_count')
        .order('created_at', { ascending: false })
        .limit(50);

      // If lead is pre-selected, prioritize their posts
      if (activeLocation?.id) {
        query = query.eq('lead_id', activeLocation.id);
      }

      const { data } = await query;
      setExternalPosts(data || []);
      setIsLoadingPosts(false);
    };
    fetchExternalPosts();
  }, [activeLocation?.id]);

  useEffect(() => {
    if (!leadSearch.trim() || leadSearch.length < 2) {
      setLeadResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingLeads(true);
      const { data } = await supabase
        .from('leads')
        .select('id, lead_name, victim_name, city, state, visit_city, visit_state, neighborhood')
        .or(`lead_name.ilike.%${leadSearch}%,victim_name.ilike.%${leadSearch}%,city.ilike.%${leadSearch}%`)
        .limit(8);
      setLeadResults(data || []);
      setIsSearchingLeads(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [leadSearch]);

  const filteredExternalPosts = externalPosts.filter((p) => {
    if (!postSearch.trim()) return true;
    const q = postSearch.toLowerCase();
    return (
      (p.title || "").toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      (p.author_username || "").toLowerCase().includes(q) ||
      (p.url || "").toLowerCase().includes(q)
    );
  });

  const getInstagramEmbedUrl = (url: string) => {
    // Extract shortcode from Instagram URL for thumbnail
    const match = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  };

  const handleCreate = async () => {
    if (creativeMode === "post" && !postId.trim()) {
      return;
    }

    setIsCreating(true);
    const locations = hasLeadLocation
      ? [{ key: "BR", name: [resolvedCity, resolvedState].filter(Boolean).join("/") }]
      : undefined;

    const result = await createCampaign({
      postId: creativeMode === "post" ? postId.trim() : "custom_creative",
      campaignName,
      objective,
      dailyBudget: budgetType === "daily" ? dailyBudget : undefined,
      lifetimeBudget: budgetType === "lifetime" ? lifetimeBudget : undefined,
      startDate: startDate.toISOString(),
      endDate: endDate?.toISOString(),
      locations,
      ageMin: ageRange[0],
      ageMax: ageRange[1],
      genders,
      editorialPostId: post.id,
      postTitle: post.title,
      postPlatform: post.platform,
      leadId: activeLocation?.id,
      ...(creativeMode === "custom" && {
        creativeData: {
          imageUrl: adImageUrl,
          headline: adHeadline,
          body: adBody,
          linkDescription: adLinkDescription,
          callToAction: adCta,
        },
      }),
    });

    setIsCreating(false);
    if (result.success) {
      onOpenChange(false);
    }
  };

  const totalSteps = 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Criar Anúncio - {post.title}
          </DialogTitle>
          <div className="flex items-center gap-2 mt-2">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={cn(
                  "h-2 flex-1 rounded-full transition-colors",
                  s <= step ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Passo {step} de {totalSteps}: {step === 1 ? "Criativo" : step === 2 ? "Campanha" : step === 3 ? "Público" : "Orçamento"}
          </p>
        </DialogHeader>

        {/* Step 1: Creative */}
        {step === 1 && (
          <div className="space-y-4">
            <Label className="font-medium">Tipo de Criativo</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreativeMode("post")}
                className={cn(
                  "flex-1 p-3 rounded-lg border text-sm transition-all text-left",
                  creativeMode === "post"
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <p className="font-medium">Promover Post Existente</p>
                <p className="text-xs text-muted-foreground">Selecione um post já publicado</p>
              </button>
              <button
                type="button"
                onClick={() => setCreativeMode("custom")}
                className={cn(
                  "flex-1 p-3 rounded-lg border text-sm transition-all text-left",
                  creativeMode === "custom"
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <p className="font-medium">Criar do Zero</p>
                <p className="text-xs text-muted-foreground">Imagem, texto e CTA personalizados</p>
              </button>
            </div>

            {creativeMode === "post" ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={postSearch}
                    onChange={(e) => setPostSearch(e.target.value)}
                    placeholder="Buscar post por título, descrição ou URL..."
                    className="pl-9"
                  />
                </div>

                {selectedExternalPost ? (
                  <div className="p-4 bg-accent/50 border border-primary/30 rounded-lg space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium flex items-center gap-1">
                          <Megaphone className="h-3 w-3 text-primary shrink-0" />
                          Post selecionado
                        </p>
                        <p className="font-bold mt-1 truncate">
                          {selectedExternalPost.title || selectedExternalPost.description?.slice(0, 60) || "Post sem título"}
                        </p>
                        {selectedExternalPost.author_username && (
                          <p className="text-xs text-muted-foreground">@{selectedExternalPost.author_username}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="secondary" className="text-xs">{selectedExternalPost.platform}</Badge>
                          <a href={selectedExternalPost.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> Ver post
                          </a>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { setSelectedExternalPost(null); setPostId(""); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                    {isLoadingPosts ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                        Carregando posts...
                      </div>
                    ) : filteredExternalPosts.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        {externalPosts.length === 0 ? "Nenhum post externo cadastrado." : "Nenhum post encontrado."}
                      </div>
                    ) : (
                      filteredExternalPosts.map((ep) => (
                        <button key={ep.id} type="button" onClick={() => {
                          setSelectedExternalPost(ep);
                          setPostId(ep.post_id || ep.url || "");
                          if (!campaignName || campaignName.startsWith("Promoção:")) {
                            setCampaignName(`Promoção: ${ep.title || ep.description?.slice(0, 40) || "Post"}`);
                          }
                        }} className="w-full p-3 text-left hover:bg-muted/50 transition-colors">
                          <p className="text-sm font-medium truncate">{ep.title || ep.description?.slice(0, 60) || "Post sem título"}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {ep.author_username && <span className="text-xs text-muted-foreground">@{ep.author_username}</span>}
                            <Badge variant="outline" className="text-xs">{ep.platform}</Badge>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {!selectedExternalPost && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Ou cole o ID manualmente:</Label>
                    <Input value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="Ex: 17895695668004550 ou page_id_post_id" className="text-sm" />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    URL da Imagem do Anúncio
                  </Label>
                  <Input
                    value={adImageUrl}
                    onChange={(e) => setAdImageUrl(e.target.value)}
                    placeholder="https://exemplo.com/imagem.jpg ou cole a URL da imagem"
                  />
                  {adImageUrl && (
                    <div className="border rounded-lg overflow-hidden max-h-48">
                      <img src={adImageUrl} alt="Preview" className="w-full h-48 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Título do Anúncio</Label>
                  <Input value={adHeadline} onChange={(e) => setAdHeadline(e.target.value)} placeholder="Ex: Conheça seus direitos trabalhistas" />
                </div>

                <div className="space-y-2">
                  <Label>Texto Principal</Label>
                  <Textarea value={adBody} onChange={(e) => setAdBody(e.target.value)} placeholder="Texto que aparece no corpo do anúncio..." rows={3} />
                </div>

                <div className="space-y-2">
                  <Label>Descrição do Link (opcional)</Label>
                  <Input value={adLinkDescription} onChange={(e) => setAdLinkDescription(e.target.value)} placeholder="Descrição que aparece abaixo do título" />
                </div>

                <div className="space-y-2">
                  <Label>Botão de Ação (CTA)</Label>
                  <Select value={adCta} onValueChange={setAdCta}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LEARN_MORE">Saiba Mais</SelectItem>
                      <SelectItem value="CONTACT_US">Fale Conosco</SelectItem>
                      <SelectItem value="SEND_MESSAGE">Enviar Mensagem</SelectItem>
                      <SelectItem value="SIGN_UP">Cadastre-se</SelectItem>
                      <SelectItem value="CALL_NOW">Ligue Agora</SelectItem>
                      <SelectItem value="GET_QUOTE">Obter Cotação</SelectItem>
                      <SelectItem value="WATCH_MORE">Assistir Mais</SelectItem>
                      <SelectItem value="APPLY_NOW">Inscreva-se</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Campaign Name & Objective */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Campanha</Label>
              <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Nome da campanha" />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                Objetivo
              </Label>
              <div className="grid grid-cols-1 gap-2">
                {objectives.map((obj) => (
                  <button key={obj.value} type="button" onClick={() => setObjective(obj.value)} className={cn(
                    "p-3 rounded-lg border text-left transition-all",
                    objective === obj.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border hover:border-primary/50"
                  )}>
                    <p className="font-medium text-sm">{obj.label}</p>
                    <p className="text-xs text-muted-foreground">{obj.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Targeting */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Faixa Etária: {ageRange[0]} - {ageRange[1]} anos
              </Label>
              <Slider
                value={ageRange}
                onValueChange={setAgeRange}
                min={13}
                max={65}
                step={1}
                className="mt-2"
              />
            </div>

            <div className="space-y-2">
              <Label>Gênero</Label>
              <div className="flex gap-2">
                {[
                  { value: 0, label: "Todos" },
                  { value: 1, label: "Masculino" },
                  { value: 2, label: "Feminino" },
                ].map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGenders([g.value])}
                    className={cn(
                      "px-4 py-2 rounded-lg border text-sm transition-all",
                      genders.includes(g.value)
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Localização (vincular ao lead)
              </Label>

              {/* Lead search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  placeholder="Buscar lead por nome, vítima ou cidade..."
                  className="pl-9"
                />
                {isSearchingLeads && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {/* Search results */}
              {leadResults.length > 0 && (
                <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
                  {leadResults.map((lead) => {
                    const leadCity = lead.visit_city || lead.city;
                    const leadState = lead.visit_state || lead.state;
                    return (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          setSelectedLead({
                            id: lead.id,
                            city: lead.city,
                            state: lead.state,
                            visit_city: lead.visit_city,
                            visit_state: lead.visit_state,
                            neighborhood: lead.neighborhood,
                            lead_name: lead.lead_name || lead.victim_name,
                          });
                          setLeadSearch("");
                          setLeadResults([]);
                        }}
                        className="w-full p-2 text-left hover:bg-muted/50 text-sm flex items-center justify-between"
                      >
                        <span className="font-medium">{lead.lead_name || lead.victim_name || "Sem nome"}</span>
                        {(leadCity || leadState) && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {[leadCity, leadState].filter(Boolean).join("/")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Selected location display */}
              {hasLeadLocation ? (
                <div className="p-3 bg-accent/50 border border-primary/30 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-primary" />
                      Localização do lead
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setSelectedLead(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-sm">
                    {[resolvedCity, resolvedState].filter(Boolean).join(" / ")}
                    {resolvedNeighborhood && ` - ${resolvedNeighborhood}`}
                  </p>
                  {activeLocation?.lead_name && (
                    <p className="text-xs text-muted-foreground">Lead: {activeLocation.lead_name}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    O anúncio será direcionado para a região do acidente/visita.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Busque e selecione um lead acima para segmentar pela região. Sem lead, o anúncio vai para todo o Brasil.
                </p>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anotações sobre a estratégia deste anúncio..."
                rows={3}
              />
            </div>
          </div>
        )}

        {/* Step 4: Budget */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Tipo de Orçamento
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBudgetType("daily")}
                  className={cn(
                    "flex-1 p-3 rounded-lg border text-sm transition-all",
                    budgetType === "daily"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <p className="font-medium">Diário</p>
                  <p className="text-xs text-muted-foreground">Gasto máximo por dia</p>
                </button>
                <button
                  type="button"
                  onClick={() => setBudgetType("lifetime")}
                  className={cn(
                    "flex-1 p-3 rounded-lg border text-sm transition-all",
                    budgetType === "lifetime"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <p className="font-medium">Vitalício</p>
                  <p className="text-xs text-muted-foreground">Total para toda a campanha</p>
                </button>
              </div>
            </div>

            {budgetType === "daily" ? (
              <div className="space-y-2">
                <Label>Orçamento Diário (R$)</Label>
                <Input
                  type="number"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(Number(e.target.value))}
                  min={1}
                  step={1}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Orçamento Total (R$)</Label>
                <Input
                  type="number"
                  value={lifetimeBudget}
                  onChange={(e) => setLifetimeBudget(Number(e.target.value))}
                  min={1}
                  step={1}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data de Início</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(startDate, "dd/MM/yyyy", { locale: ptBR })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={(d) => d && setStartDate(d)}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Data de Término (opcional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "dd/MM/yyyy", { locale: ptBR }) : "Sem término"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={(d) => setEndDate(d || undefined)}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 space-y-2">
              <p className="font-medium text-sm">Resumo da Campanha</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Campanha:</span>
                  <p className="font-medium">{campaignName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Objetivo:</span>
                  <p className="font-medium">{objectives.find(o => o.value === objective)?.label}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Orçamento:</span>
                  <p className="font-medium">
                    R$ {budgetType === "daily" ? `${dailyBudget}/dia` : `${lifetimeBudget} total`}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Público:</span>
                  <p className="font-medium">
                    {ageRange[0]}-{ageRange[1]} anos, {hasLeadLocation ? [resolvedCity, resolvedState].filter(Boolean).join("/") : "Brasil"}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                ⚠️ A campanha será criada como <strong>PAUSADA</strong>. Ative-a quando estiver pronto.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
          )}
          {step < totalSteps ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && creativeMode === "post" && !postId.trim()}>
              Próximo
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={isCreating || (creativeMode === "post" && !postId.trim())} className="gap-2">
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Criar Campanha
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

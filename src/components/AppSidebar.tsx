import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, CalendarDays, TrendingUp, Trophy, UsersRound,
  MessageCircle, CreditCard, Filter, Bot, Target, Heart, Megaphone,
  Zap, Search, ClipboardList, Phone, Scale, Briefcase, AtSign, RefreshCw, FileText,
  LogOut, MessagesSquare, Settings, ChevronRight, User, Chrome, Archive,
  MessageSquare as MessageSquareIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ActivityChatSheet } from "@/components/activities/ActivityChatSheet";
import { MentionsPanel } from "@/components/chat/MentionsPanel";
import { useUnreadMentionsCount } from "@/hooks/useTeamChat";
import { useChangelogAcknowledgments } from "@/hooks/useChangelogAcknowledgments";
import { onUpdateAvailable, applyUpdate, checkForUpdates } from "@/lib/pwaUpdater";
import { UpdateNotesDialog } from "@/components/updates/UpdateNotesDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  color?: string;
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
}

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, signOut } = useAuthContext();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const unreadMentions = useUnreadMentionsCount();
  const { unseenCount, isFeatureAcked, acknowledgeFeature, acknowledgeAll } = useChangelogAcknowledgments();

  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [hasPwaUpdate, setHasPwaUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateNotesOpen, setUpdateNotesOpen] = useState(false);
  const hasUpdate = unseenCount > 0 || hasPwaUpdate;

  const noop = useCallback(() => {}, []);

  useEffect(() => {
    const unsub = onUpdateAvailable(() => setHasPwaUpdate(true));
    return unsub;
  }, []);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast.error('Erro ao sair', { description: error.message });
    } else {
      toast.success('Você saiu da conta');
    }
  };

  const quickLinks: NavItem[] = [
    { id: "activities", label: "Atividades", icon: <ClipboardList className="h-4 w-4" />, path: "/", color: "text-emerald-600" },
    { id: "leads", label: "Leads", icon: <Users className="h-4 w-4" />, path: "/leads" },
    { id: "calls", label: "Ligações", icon: <Phone className="h-4 w-4" />, path: "/calls", color: "text-blue-500" },
    { id: "whatsapp", label: "WhatsApp", icon: <MessageSquareIcon className="h-4 w-4" />, path: "/whatsapp", color: "text-green-500" },
    { id: "agent-monitor", label: "Monitor IA", icon: <Bot className="h-4 w-4" />, path: "/agent-monitor", color: "text-purple-500" },
    { id: "instagram", label: "Instagram", icon: <AtSign className="h-4 w-4" />, path: "/instagram", color: "text-pink-500" },
    { id: "comment-workflow", label: "Fluxo de Respostas", icon: <MessageCircle className="h-4 w-4" />, path: "/workflow", color: "text-pink-500" },
    { id: "contacts", label: "Contatos", icon: <Users className="h-4 w-4" />, path: "/contacts", color: "text-primary" },
    { id: "referrals", label: "Indicações", icon: <Search className="h-4 w-4" />, path: "/referrals", color: "text-amber-500" },
    { id: "dashboard", label: "Visão Geral", icon: <LayoutDashboard className="h-4 w-4" />, path: "/dashboard" },
  ];

  const sections: NavSection[] = [
    {
      id: "marketing", label: "Marketing", icon: <Megaphone className="h-4 w-4" />,
      items: [
        { id: "organic", label: "Orgânico", icon: <Heart className="h-3.5 w-3.5" />, path: "/dashboard?tab=organic", color: "text-pink-500" },
        { id: "paid", label: "Anúncios", icon: <Megaphone className="h-3.5 w-3.5" />, path: "/dashboard?tab=paid", color: "text-blue-500" },
        { id: "comments", label: "Comentários", icon: <MessageCircle className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation&subtab=comments", color: "text-primary" },
        { id: "manychat", label: "ManyChat", icon: <MessagesSquare className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation&subtab=manychat", color: "text-blue-500" },
        { id: "funnel", label: "Funil", icon: <Filter className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation&subtab=funnel", color: "text-orange-500" },
      ],
    },
    {
      id: "sales", label: "Vendas", icon: <Zap className="h-4 w-4" />,
      items: [
        { id: "sales-funnels", label: "Funil de Vendas", icon: <Filter className="h-3.5 w-3.5" />, path: "/sales-funnels", color: "text-yellow-500" },
        { id: "goals", label: "Metas", icon: <Target className="h-3.5 w-3.5" />, path: "/dashboard?tab=goals", color: "text-emerald-500" },
        { id: "leaderboard", label: "Ranking", icon: <Trophy className="h-3.5 w-3.5" />, path: "/leaderboard", color: "text-yellow-500" },
      ],
    },
    {
      id: "processual", label: "Processual", icon: <Scale className="h-4 w-4" />,
      items: [
        { id: "cases", label: "Casos", icon: <Briefcase className="h-3.5 w-3.5" />, path: "/cases", color: "text-primary" },
        { id: "processes", label: "Processos", icon: <FileText className="h-3.5 w-3.5" />, path: "/processes", color: "text-blue-500" },
        { id: "process-tracking", label: "Controle Processual", icon: <ClipboardList className="h-3.5 w-3.5" />, path: "/process-tracking", color: "text-emerald-500" },
        { id: "nuclei", label: "Núcleos", icon: <Scale className="h-3.5 w-3.5" />, path: "/nuclei", color: "text-orange-500" },
        { id: "workflow-progress", label: "Fluxo de Trabalho", icon: <Zap className="h-3.5 w-3.5" />, path: "/workflow-progress", color: "text-purple-500" },
      ],
    },
    {
      id: "finance", label: "Financeiro", icon: <CreditCard className="h-4 w-4" />,
      items: [
        { id: "finance-main", label: "Finanças", icon: <CreditCard className="h-3.5 w-3.5" />, path: "/finance", color: "text-green-500" },
        { id: "cost-org", label: "Ecossistema", icon: <Target className="h-3.5 w-3.5" />, path: "/cost-organization", color: "text-purple-500" },
      ],
    },
    {
      id: "team", label: "Equipe", icon: <UsersRound className="h-4 w-4" />,
      items: [
        { id: "team-main", label: "Equipe", icon: <UsersRound className="h-3.5 w-3.5" />, path: "/team", color: "text-emerald-500" },
        { id: "analytics", label: "Analytics", icon: <TrendingUp className="h-3.5 w-3.5" />, path: "/analytics" },
      ],
    },
  ];

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" && !location.search;
    if (path === "/dashboard") return location.pathname === "/dashboard" && !location.search;
    if (path.includes("?")) return location.pathname + location.search === path;
    return location.pathname === path;
  };

  const isSectionActive = (section: NavSection) => section.items.some(i => isActive(i.path));

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  const openCommandPalette = () => {
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
    document.dispatchEvent(event);
  };

  const hiddenRoutes = ['/login', '/reset-password', '/privacy', '/expense-form', '/install'];
  const isHidden = !user || hiddenRoutes.some(r => location.pathname.startsWith(r));

  if (isHidden) return null;

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-2 flex flex-col gap-2">
          <SidebarTrigger className="w-full flex items-center justify-center" />
          {!collapsed && (
            <button
              onClick={openCommandPalette}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent rounded-md transition-colors"
            >
              <Search className="h-4 w-4" />
              <span>Buscar...</span>
              <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
            </button>
          )}
          {collapsed && (
            <button
              onClick={openCommandPalette}
              className="w-full flex items-center justify-center py-2 text-muted-foreground hover:bg-accent rounded-md transition-colors"
              title="Buscar (⌘K)"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </SidebarHeader>

        <SidebarContent>
          {/* Quick Links */}
          <SidebarGroup>
            <SidebarGroupLabel>Principal</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {quickLinks.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      onClick={() => handleNavigate(item.path)}
                      isActive={isActive(item.path)}
                      tooltip={item.label}
                    >
                      <span className={cn(item.color)}>{item.icon}</span>
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          {/* Sections */}
          {sections.map((section) => (
            <Collapsible key={section.id} defaultOpen={isSectionActive(section)}>
              <SidebarGroup>
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors">
                    <span className="flex items-center gap-2 flex-1">
                      {section.icon}
                      {!collapsed && section.label}
                    </span>
                    {!collapsed && <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />}
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {section.items.map((item) => (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            onClick={() => handleNavigate(item.path)}
                            isActive={isActive(item.path)}
                            tooltip={item.label}
                          >
                            <span className={cn(item.color)}>{item.icon}</span>
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          ))}
        </SidebarContent>

        <SidebarFooter className="p-2">
          <SidebarMenu>
            {/* Mentions */}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setMentionsOpen(true)}
                tooltip="Menções"
              >
                <span className="relative">
                  <MessageCircle className="h-4 w-4" />
                  {unreadMentions > 0 && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive text-destructive-foreground text-[8px] font-bold flex items-center justify-center">
                      {unreadMentions > 9 ? '9+' : unreadMentions}
                    </span>
                  )}
                </span>
                <span>Menções</span>
                {unreadMentions > 0 && !collapsed && (
                  <span className="ml-auto w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                    {unreadMentions > 9 ? '9+' : unreadMentions}
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Update */}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={async () => {
                  if (hasUpdate) {
                    setUpdateNotesOpen(true);
                    return;
                  }
                  setChecking(true);
                  const result = await checkForUpdates();
                  setChecking(false);
                  if (result === 'update-found') {
                    setHasPwaUpdate(true);
                    setUpdateNotesOpen(true);
                  } else if (result === 'no-sw') {
                    toast.info('Recarregando app...');
                    setTimeout(() => window.location.reload(), 300);
                  } else {
                    toast.success('App atualizado!');
                  }
                }}
                tooltip={hasUpdate ? "Atualização disponível" : "Atualizar"}
              >
                <span className="relative">
                  <RefreshCw className={cn("h-4 w-4", (updating || checking) && "animate-spin")} />
                  {hasUpdate && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive" />
                  )}
                </span>
                <span>Atualizar</span>
                {hasUpdate && !collapsed && (
                  <span className="ml-auto w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                    {unseenCount > 0 ? unseenCount : '!'}
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarSeparator />

            {/* User Profile */}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => handleNavigate('/profile')}
                isActive={isActive('/profile')}
                tooltip={profile?.full_name || user?.email || 'Perfil'}
              >
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="bg-primary text-primary-foreground text-[10px] font-bold">
                    {profile?.full_name
                      ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                      : user?.email?.slice(0, 2).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-sm font-medium">{profile?.full_name || 'Usuário'}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{user?.email}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Extension */}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => handleNavigate('/extension')}
                isActive={isActive('/extension')}
                tooltip="Extensão Chrome"
              >
                <Chrome className="h-4 w-4" />
                <span>Extensão Chrome</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Settings */}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => handleNavigate('/settings')}
                isActive={isActive('/settings')}
                tooltip="Configurações"
              >
                <Settings className="h-4 w-4" />
                <span>Configurações</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Archived Items */}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => handleNavigate('/archived')}
                isActive={isActive('/archived')}
                tooltip="Arquivados"
              >
                <Archive className="h-4 w-4" />
                <span>Arquivados</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Logout */}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={handleSignOut}
                tooltip="Sair"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Sair</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <MentionsPanel open={mentionsOpen} onOpenChange={setMentionsOpen} />

      <UpdateNotesDialog
        open={updateNotesOpen}
        onOpenChange={setUpdateNotesOpen}
        onApplyUpdate={async () => {
          setUpdating(true);
          await acknowledgeAll();
          if (hasPwaUpdate) {
            applyUpdate();
            setTimeout(() => window.location.reload(), 3000);
          } else {
            setUpdating(false);
            setUpdateNotesOpen(false);
          }
        }}
        updating={updating}
        isFeatureAcked={isFeatureAcked}
        onAcknowledgeFeature={acknowledgeFeature}
      />
    </>
  );
}

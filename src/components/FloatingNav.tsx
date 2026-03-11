import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, CalendarDays, TrendingUp, Trophy, UsersRound,
  MessageCircle, CreditCard, Filter, Bot, Target, Heart, Megaphone,
  Zap, Menu, X, Search, ClipboardList, ChevronRight, Phone,
  MessageSquare as MessageSquareIcon, Scale, Briefcase, AtSign, RefreshCw,
  ChevronUp, ChevronDown, LogOut, MessagesSquare,
} from "lucide-react";
import { onUpdateAvailable, applyUpdate, checkForUpdates } from "@/lib/pwaUpdater";
import { UpdateNotesDialog } from "@/components/updates/UpdateNotesDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuthContext } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ActivityChatSheet } from "@/components/activities/ActivityChatSheet";
import { MentionsPanel } from "@/components/chat/MentionsPanel";
import { useUnreadMentionsCount } from "@/hooks/useTeamChat";

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

export function FloatingNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useUserRole();
  const { user, signOut } = useAuthContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(() => {
    try { return localStorage.getItem('dock_collapsed') === '1'; } catch { return false; }
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadMentions = useUnreadMentionsCount();
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateNotesOpen, setUpdateNotesOpen] = useState(false);

  const noop = useCallback(() => {}, []);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast.error('Erro ao sair', { description: error.message });
    } else {
      toast.success('Você saiu da conta');
    }
  };

  // Listen for PWA updates
  useEffect(() => {
    const unsub = onUpdateAvailable(() => setHasUpdate(true));
    return unsub;
  }, []);

  const hiddenRoutes = ['/login', '/reset-password', '/privacy', '/expense-form', '/install'];
  const isHidden = !user || hiddenRoutes.some(r => location.pathname.startsWith(r));

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setExpandedSection(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Quick links
  const quickLinks: NavItem[] = [
    { id: "activities", label: "Atividades", icon: <ClipboardList className="h-4 w-4" />, path: "/", color: "text-emerald-600" },
    { id: "leads", label: "Leads", icon: <Users className="h-4 w-4" />, path: "/leads" },
    { id: "calls", label: "Ligações", icon: <Phone className="h-4 w-4" />, path: "/calls", color: "text-blue-500" },
    { id: "whatsapp", label: "WhatsApp", icon: <MessageSquareIcon className="h-4 w-4" />, path: "/whatsapp", color: "text-green-500" },
    { id: "finance", label: "Finanças", icon: <CreditCard className="h-4 w-4" />, path: "/finance", color: "text-green-500" },
    { id: "cost-org", label: "Ecossistema", icon: <Target className="h-4 w-4" />, path: "/cost-organization", color: "text-purple-500" },
  ];

  const sections: NavSection[] = [
    {
      id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />,
      items: [
        { id: "dashboard-main", label: "Visão Geral", icon: <LayoutDashboard className="h-3.5 w-3.5" />, path: "/dashboard" },
        { id: "paid", label: "Tráfego Pago", icon: <Megaphone className="h-3.5 w-3.5" />, path: "/dashboard?tab=paid", color: "text-blue-500" },
        { id: "organic", label: "Orgânico", icon: <Heart className="h-3.5 w-3.5" />, path: "/dashboard?tab=organic", color: "text-pink-500" },
        { id: "goals", label: "Metas", icon: <Target className="h-3.5 w-3.5" />, path: "/dashboard?tab=goals", color: "text-emerald-500" },
      ],
    },
    {
      id: "automation", label: "Automação", icon: <Bot className="h-4 w-4" />,
      items: [
        { id: "automation-main", label: "Painel", icon: <Bot className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation", color: "text-purple-500" },
        { id: "comments", label: "Comentários", icon: <MessageCircle className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation&subtab=comments", color: "text-primary" },
        { id: "funnel", label: "Funil", icon: <Filter className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation&subtab=funnel", color: "text-orange-500" },
        { id: "workflow", label: "Funil de Vendas", icon: <Zap className="h-3.5 w-3.5" />, path: "/workflow", color: "text-yellow-500" },
      ],
    },
    {
      id: "processual", label: "Processual", icon: <Scale className="h-4 w-4" />,
      items: [
        { id: "cases", label: "Casos", icon: <Briefcase className="h-3.5 w-3.5" />, path: "/cases", color: "text-primary" },
        { id: "nuclei", label: "Núcleos", icon: <Scale className="h-3.5 w-3.5" />, path: "/nuclei", color: "text-orange-500" },
        { id: "workflow-progress", label: "Fluxo de Trabalho", icon: <Zap className="h-3.5 w-3.5" />, path: "/workflow-progress", color: "text-purple-500" },
      ],
    },
    {
      id: "more", label: "Mais", icon: <TrendingUp className="h-4 w-4" />,
      items: [
        { id: "analytics", label: "Analytics", icon: <TrendingUp className="h-3.5 w-3.5" />, path: "/analytics" },
        { id: "leaderboard", label: "Ranking", icon: <Trophy className="h-3.5 w-3.5" />, path: "/leaderboard", color: "text-yellow-500" },
        { id: "team", label: "Equipe", icon: <UsersRound className="h-3.5 w-3.5" />, path: "/team", color: "text-emerald-500" },
      ],
    },
  ];

  const handleNavigate = (path: string) => {
    navigate(path);
    setMenuOpen(false);
    setExpandedSection(null);
  };

  const openCommandPalette = () => {
    setMenuOpen(false);
    setExpandedSection(null);
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
    document.dispatchEvent(event);
  };

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" && !location.search;
    if (path === "/dashboard") return location.pathname === "/dashboard" && !location.search;
    if (path.includes("?")) return location.pathname + location.search === path;
    return location.pathname === path;
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSection(prev => prev === sectionId ? null : sectionId);
  };

  if (isHidden) return null;

  return (
    <>
      <div ref={containerRef} className="fixed left-1/2 -translate-x-1/2 z-50 bottom-[calc(env(safe-area-inset-bottom)+1rem)] md:bottom-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        {/* Menu Panel - appears above the dock */}
        {menuOpen && !dockCollapsed && (
          <div
            className="mb-2 w-56 mx-auto bg-card/95 backdrop-blur-lg border border-border/60 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
          >
            {/* Search */}
            <button
              onClick={openCommandPalette}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent/50 transition-colors border-b border-border/30"
            >
              <Search className="h-4 w-4" />
              <span>Buscar...</span>
              <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
            </button>

            <div className="max-h-[60vh] overflow-y-auto">
              <div className="py-1.5">
                {quickLinks.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleNavigate(item.path)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors hover:bg-accent/50",
                      isActive(item.path) && "bg-primary/10 text-primary font-medium"
                    )}
                  >
                    <span className={cn(item.color)}>{item.icon}</span>
                    {item.label}
                    {isActive(item.path) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                  </button>
                ))}
              </div>

              {sections.map(section => (
                <div key={section.id} className="border-t border-border/30">
                  <button
                    onClick={() => toggleSection(section.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/50",
                      expandedSection === section.id && "bg-accent/30"
                    )}
                  >
                    {section.icon}
                    <span className="flex-1 text-left">{section.label}</span>
                    <ChevronRight className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                      expandedSection === section.id && "rotate-90"
                    )} />
                  </button>
                  {expandedSection === section.id && (
                    <div className="bg-muted/20 py-1 animate-in slide-in-from-top-1 fade-in duration-150">
                      {section.items.map(item => (
                        <button
                          key={item.id}
                          onClick={() => handleNavigate(item.path)}
                          className={cn(
                            "w-full flex items-center gap-2 pl-10 pr-4 py-1.5 text-xs transition-colors hover:bg-accent/50",
                            isActive(item.path) && "bg-primary/10 text-primary font-medium"
                          )}
                        >
                          <span className={cn(item.color)}>{item.icon}</span>
                          {item.label}
                          {isActive(item.path) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Sair */}
              <div className="border-t border-border/30">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10 font-medium"
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Collapsed state - small pill to expand */}
        {dockCollapsed ? (
          <button
            onClick={() => { setDockCollapsed(false); try { localStorage.setItem('dock_collapsed', '0'); } catch {} }}
            className="flex items-center gap-1.5 bg-card/80 backdrop-blur-xl border border-border/60 rounded-full px-4 py-2.5 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 active:scale-95"
          >
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">Menu</span>
            {(unreadMentions > 0 || hasUpdate) && (
              <span className="w-2 h-2 rounded-full bg-destructive" />
            )}
          </button>
        ) : (
          /* Dock Bar */
          <div className="flex items-center gap-1.5 bg-card/90 backdrop-blur-xl border border-border/60 rounded-full px-2.5 py-2 shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200">
            {/* Collapse button */}
            <button
              onClick={() => { setDockCollapsed(true); setMenuOpen(false); setExpandedSection(null); try { localStorage.setItem('dock_collapsed', '1'); } catch {} }}
              title="Minimizar"
              className="h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md bg-muted/50 text-muted-foreground hover:bg-muted"
            >
              <ChevronDown className="h-5 w-5" />
            </button>

            {/* Menu button */}
            <button
              onClick={() => { setMenuOpen(v => !v); setExpandedSection(null); }}
              title="Menu"
              className={cn(
                "h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md",
                "bg-primary text-primary-foreground",
                menuOpen && "ring-2 ring-primary/50 scale-110"
              )}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            {/* Search button */}
            <button
              onClick={() => {
                setMenuOpen(false);
                const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
                document.dispatchEvent(event);
              }}
              title="Buscar"
              className="h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md bg-muted text-muted-foreground hover:bg-muted/80"
            >
              <Search className="h-5 w-5" />
            </button>

            {/* WhatsApp Call button */}
            <button
              onClick={() => {
                setWhatsAppOpen(v => !v);
                setMenuOpen(false);
              }}
              title="WhatsApp Call"
              className={cn(
                "h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md",
                "bg-green-600 text-white hover:bg-green-700",
                whatsAppOpen && "ring-2 ring-green-400/50 scale-110"
              )}
            >
              <Phone className="h-5 w-5" />
            </button>

            {/* AI Chat button */}
            <button
              onClick={() => {
                setAiChatOpen(true);
                setMenuOpen(false);
              }}
              title="Chat IA"
              className="h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md bg-accent text-accent-foreground hover:bg-accent/80"
            >
              <Bot className="h-5 w-5" />
            </button>

            {/* Mentions button */}
            <button
              onClick={() => {
                setMentionsOpen(true);
                setMenuOpen(false);
              }}
              title="Menções"
              className="h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md relative bg-muted text-muted-foreground hover:bg-muted/80"
            >
              <AtSign className="h-5 w-5" />
              {unreadMentions > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {unreadMentions > 9 ? '9+' : unreadMentions}
                </span>
              )}
            </button>

            {/* Update button */}
            <button
              onClick={() => {
                if (hasUpdate) {
                  setUpdateNotesOpen(true);
                  setMenuOpen(false);
                } else {
                  setChecking(true);
                  checkForUpdates();
                  setTimeout(() => setChecking(false), 3000);
                }
              }}
              title={hasUpdate ? "Atualização disponível — clique para aplicar" : "Verificar atualizações"}
              className={cn(
                "h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md relative",
                hasUpdate
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 animate-pulse"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              <RefreshCw className={cn("h-5 w-5", (updating || checking) && "animate-spin")} />
              {hasUpdate && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive" />}
            </button>
          </div>
        )}
      </div>

      {/* AI Chat Sheet */}
      <ActivityChatSheet
        open={aiChatOpen}
        onOpenChange={setAiChatOpen}
        activityId={null}
        leadId={null}
        onApplySuggestion={noop}
      />

      {/* Mentions Panel */}
      <MentionsPanel
        open={mentionsOpen}
        onOpenChange={setMentionsOpen}
      />

      {/* Update Notes Dialog */}
      <UpdateNotesDialog
        open={updateNotesOpen}
        onOpenChange={setUpdateNotesOpen}
        onApplyUpdate={() => {
          setUpdating(true);
          applyUpdate();
          setTimeout(() => window.location.reload(), 3000);
        }}
        updating={updating}
      />
    </>
  );
}

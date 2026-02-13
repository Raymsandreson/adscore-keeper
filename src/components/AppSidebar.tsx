import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  TrendingUp,
  Trophy,
  UsersRound,
  MessageCircle,
  CreditCard,
  Filter,
  Bot,
  Target,
  Heart,
  Megaphone,
  Zap,
  Search,
  ClipboardList,
  ChevronRight,
  User,
} from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import abraciLogo from "@/assets/abraci-logo.png";

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useUserRole();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" && !location.search;
    if (path === "/dashboard") return location.pathname === "/dashboard" && !location.search;
    if (path.includes("?")) return location.pathname + location.search === path;
    return location.pathname === path;
  };

  const handleNav = (path: string) => navigate(path);

  const openCommandPalette = () => {
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
    document.dispatchEvent(event);
  };

  const quickLinks = [
    { id: "activities", label: "Atividades", icon: ClipboardList, path: "/" },
    { id: "leads", label: "Leads", icon: Users, path: "/leads" },
    { id: "finance", label: "Finanças", icon: CreditCard, path: "/finance" },
    { id: "editorial", label: "Editorial", icon: CalendarDays, path: "/editorial" },
  ];

  const sections = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      items: [
        { id: "dashboard-main", label: "Visão Geral", icon: LayoutDashboard, path: "/dashboard" },
        { id: "paid", label: "Tráfego Pago", icon: Megaphone, path: "/dashboard?tab=paid" },
        { id: "organic", label: "Orgânico", icon: Heart, path: "/dashboard?tab=organic" },
        { id: "goals", label: "Metas", icon: Target, path: "/dashboard?tab=goals" },
      ],
    },
    {
      id: "automation",
      label: "Automação",
      icon: Bot,
      items: [
        { id: "automation-main", label: "Painel", icon: Bot, path: "/dashboard?tab=automation" },
        { id: "comments", label: "Comentários", icon: MessageCircle, path: "/dashboard?tab=automation&subtab=comments" },
        { id: "funnel", label: "Funil", icon: Filter, path: "/dashboard?tab=automation&subtab=funnel" },
        { id: "workflow", label: "Workflow", icon: Zap, path: "/workflow" },
      ],
    },
    {
      id: "more",
      label: "Mais",
      icon: TrendingUp,
      items: [
        { id: "analytics", label: "Analytics", icon: TrendingUp, path: "/analytics" },
        { id: "leaderboard", label: "Ranking", icon: Trophy, path: "/leaderboard" },
        { id: "workflow-progress", label: "Fluxo de Trabalho", icon: Zap, path: "/workflow-progress" },
        ...(isAdmin ? [{ id: "team", label: "Equipe", icon: UsersRound, path: "/team" }] : []),
      ],
    },
  ];

  return (
    <Sidebar collapsible="icon">
      {/* Logo */}
      <SidebarHeader className="border-b border-border/40 px-3 py-3">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <img src={abraciLogo} alt="Logo" className="h-8 w-8 rounded-lg shrink-0" />
          {!collapsed && <span className="font-semibold text-sm truncate">Abraci CRM</span>}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Search */}
        {!collapsed && (
          <div className="px-2 pt-2">
            <button
              onClick={openCommandPalette}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground rounded-lg border border-border/40 hover:bg-accent/50 transition-colors"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Buscar...</span>
              <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
            </button>
          </div>
        )}

        {/* Quick Links */}
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {quickLinks.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    tooltip={item.label}
                    isActive={isActive(item.path)}
                    onClick={() => handleNav(item.path)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Collapsible Sections */}
        {sections.map((section) => (
          <SidebarGroup key={section.id}>
            <Collapsible defaultOpen={section.items.some((i) => isActive(i.path))}>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors">
                  <section.icon className="h-3.5 w-3.5 mr-1.5" />
                  {section.label}
                  <ChevronRight className="ml-auto h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          tooltip={item.label}
                          isActive={isActive(item.path)}
                          onClick={() => handleNav(item.path)}
                          size="sm"
                        >
                          <item.icon className="h-3.5 w-3.5" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Profile */}
      <SidebarFooter className="border-t border-border/40">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Perfil"
              isActive={isActive("/profile")}
              onClick={() => handleNav("/profile")}
            >
              <User className="h-4 w-4" />
              <span>Meu Perfil</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

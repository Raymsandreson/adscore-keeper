import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
  Menu,
  X,
  Search,
  ClipboardList,
  ChevronRight,
  Phone,
  MessageSquare as MessageSquareIcon,
  Scale,
  Briefcase,
} from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";

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
  const [open, setOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Draggable state
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const posRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    try {
      const saved = localStorage.getItem('floatingNavPos');
      if (saved) {
        const parsed = JSON.parse(saved);
        const pos = { x: parsed.x || 0, y: parsed.y || 0 };
        setPosition(pos);
        posRef.current = pos;
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current || !dragStart.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const newPos = { x: dragStart.current.posX + dx, y: dragStart.current.posY + dy };
      posRef.current = newPos;
      setPosition(newPos);
    };
    const onUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragStart.current = null;
        try { localStorage.setItem('floatingNavPos', JSON.stringify(posRef.current)); } catch {}
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    isDraggingRef.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, posX: posRef.current.x, posY: posRef.current.y };
  }, []);

  // Top-level quick links (always visible when menu open)
  const quickLinks: NavItem[] = [
    { id: "activities", label: "Atividades", icon: <ClipboardList className="h-4 w-4" />, path: "/", color: "text-emerald-600" },
    { id: "leads", label: "Leads", icon: <Users className="h-4 w-4" />, path: "/leads" },
    { id: "calls", label: "Ligações", icon: <Phone className="h-4 w-4" />, path: "/calls", color: "text-blue-500" },
    { id: "whatsapp", label: "WhatsApp", icon: <MessageSquareIcon className="h-4 w-4" />, path: "/whatsapp", color: "text-green-500" },
    { id: "finance", label: "Finanças", icon: <CreditCard className="h-4 w-4" />, path: "/finance", color: "text-green-500" },
    
  ];

  // Sections with sub-items
  const sections: NavSection[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard className="h-4 w-4" />,
      items: [
        { id: "dashboard-main", label: "Visão Geral", icon: <LayoutDashboard className="h-3.5 w-3.5" />, path: "/dashboard" },
        { id: "paid", label: "Tráfego Pago", icon: <Megaphone className="h-3.5 w-3.5" />, path: "/dashboard?tab=paid", color: "text-blue-500" },
        { id: "organic", label: "Orgânico", icon: <Heart className="h-3.5 w-3.5" />, path: "/dashboard?tab=organic", color: "text-pink-500" },
        { id: "goals", label: "Metas", icon: <Target className="h-3.5 w-3.5" />, path: "/dashboard?tab=goals", color: "text-emerald-500" },
      ],
    },
    {
      id: "automation",
      label: "Automação",
      icon: <Bot className="h-4 w-4" />,
      items: [
        { id: "automation-main", label: "Painel", icon: <Bot className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation", color: "text-purple-500" },
        { id: "comments", label: "Comentários", icon: <MessageCircle className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation&subtab=comments", color: "text-primary" },
        { id: "funnel", label: "Funil", icon: <Filter className="h-3.5 w-3.5" />, path: "/dashboard?tab=automation&subtab=funnel", color: "text-orange-500" },
        { id: "workflow", label: "Workflow", icon: <Zap className="h-3.5 w-3.5" />, path: "/workflow", color: "text-yellow-500" },
      ],
    },
    {
      id: "processual",
      label: "Processual",
      icon: <Scale className="h-4 w-4" />,
      items: [
        { id: "cases", label: "Casos", icon: <Briefcase className="h-3.5 w-3.5" />, path: "/cases", color: "text-primary" },
        { id: "workflow-progress", label: "Fluxo de Trabalho", icon: <Zap className="h-3.5 w-3.5" />, path: "/workflow-progress", color: "text-purple-500" },
      ],
    },
    {
      id: "more",
      label: "Mais",
      icon: <TrendingUp className="h-4 w-4" />,
      items: [
        { id: "analytics", label: "Analytics", icon: <TrendingUp className="h-3.5 w-3.5" />, path: "/analytics" },
        { id: "leaderboard", label: "Ranking", icon: <Trophy className="h-3.5 w-3.5" />, path: "/leaderboard", color: "text-yellow-500" },
        { id: "team", label: "Equipe", icon: <UsersRound className="h-3.5 w-3.5" />, path: "/team", color: "text-emerald-500" },
      ],
    },
  ];

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setExpandedSection(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleNavigate = (path: string) => {
    navigate(path);
    setOpen(false);
    setExpandedSection(null);
  };

  const openCommandPalette = () => {
    setOpen(false);
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

   return (
    <div
      ref={containerRef}
      className="fixed z-50 touch-none select-none"
      style={{
        bottom: `${24 - position.y}px`,
        right: `${24 - position.x}px`,
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Expanded Menu Panel */}
      {open && (
        <div
          data-no-drag
          className="mb-2 w-56 bg-card/95 backdrop-blur-lg border border-border/60 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
          style={{ cursor: 'default' }}
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

          {/* Quick Links */}
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

          {/* Collapsible Sections */}
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
        </div>
      )}

      {/* FAB Button */}
      <div className="flex justify-end">
        <Button
          data-no-drag
          size="icon"
          className={cn(
            "h-14 w-14 rounded-full shadow-lg transition-transform duration-200 cursor-pointer",
            open && "rotate-90"
          )}
          onClick={() => { setOpen(v => !v); setExpandedSection(null); }}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>
    </div>
  );
}

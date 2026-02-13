import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Search,
  ClipboardList,
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

export function FloatingNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useUserRole();
  const [open, setOpen] = useState(false);

  // Draggable state
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const hasMoved = useRef(false);

  // Load saved position
  useEffect(() => {
    try {
      const saved = localStorage.getItem('floatingNavPos');
      if (saved) {
        const parsed = JSON.parse(saved);
        setPosition({ x: parsed.x || 0, y: parsed.y || 0 });
      }
    } catch {}
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    setIsDragging(true);
    hasMoved.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved.current = true;
    const newX = dragStart.current.posX + dx;
    const newY = dragStart.current.posY + dy;
    setPosition({ x: newX, y: newY });
  }, [isDragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      dragStart.current = null;
      try { localStorage.setItem('floatingNavPos', JSON.stringify(position)); } catch {}
    }
  }, [isDragging, position]);

  const mainNavItems: NavItem[] = [
    {
      id: "activities",
      label: "Atividades",
      icon: <ClipboardList className="h-4 w-4" />,
      path: "/",
      color: "text-emerald-600",
    },
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard className="h-4 w-4" />,
      path: "/dashboard",
    },
    {
      id: "finance",
      label: "Finanças",
      icon: <CreditCard className="h-4 w-4" />,
      path: "/finance",
      color: "text-green-500",
    },
    {
      id: "leads",
      label: "Leads",
      icon: <Users className="h-4 w-4" />,
      path: "/leads",
    },
    {
      id: "editorial",
      label: "Editorial",
      icon: <CalendarDays className="h-4 w-4" />,
      path: "/editorial",
    },
    {
      id: "analytics",
      label: "Analytics",
      icon: <TrendingUp className="h-4 w-4" />,
      path: "/analytics",
    },
    {
      id: "leaderboard",
      label: "Ranking",
      icon: <Trophy className="h-4 w-4" />,
      path: "/leaderboard",
      color: "text-yellow-500",
    },
    {
      id: "workflow-progress",
      label: "Fluxo de Trabalho",
      icon: <Zap className="h-4 w-4" />,
      path: "/workflow-progress",
      color: "text-purple-500",
    },
  ];

  const dashboardSections: NavItem[] = [
    {
      id: "paid",
      label: "Tráfego Pago",
      icon: <Megaphone className="h-4 w-4" />,
      path: "/dashboard?tab=paid",
      color: "text-blue-500",
    },
    {
      id: "organic",
      label: "Orgânico",
      icon: <Heart className="h-4 w-4" />,
      path: "/dashboard?tab=organic",
      color: "text-pink-500",
    },
    {
      id: "goals",
      label: "Metas",
      icon: <Target className="h-4 w-4" />,
      path: "/dashboard?tab=goals",
      color: "text-emerald-500",
    },
    {
      id: "automation",
      label: "Automação",
      icon: <Bot className="h-4 w-4" />,
      path: "/dashboard?tab=automation",
      color: "text-purple-500",
    },
  ];

  const automationSections: NavItem[] = [
    {
      id: "comments",
      label: "Comentários",
      icon: <MessageCircle className="h-4 w-4" />,
      path: "/dashboard?tab=automation&subtab=comments",
      color: "text-primary",
    },
    {
      id: "funnel",
      label: "Funil",
      icon: <Filter className="h-4 w-4" />,
      path: "/dashboard?tab=automation&subtab=funnel",
      color: "text-orange-500",
    },
    {
      id: "workflow",
      label: "Workflow",
      icon: <Zap className="h-4 w-4" />,
      path: "/workflow",
      color: "text-yellow-500",
    },
  ];

  const handleNavigate = (path: string) => {
    if (hasMoved.current) return;
    navigate(path);
    setOpen(false);
  };

  const openCommandPalette = () => {
    setOpen(false);
    // Dispatch keyboard event to open command palette
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  const isActive = (path: string) => {
    if (path === "/") {
      return location.pathname === "/" && !location.search;
    }
    if (path === "/dashboard") {
      return location.pathname === "/dashboard" && !location.search;
    }
    if (path.includes("?")) {
      return location.pathname + location.search === path;
    }
    return location.pathname === path;
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-50 flex flex-col gap-2 touch-none select-none"
      style={{
        bottom: `${24 - position.y}px`,
        right: `${24 - position.x}px`,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Search Button */}
      <Button
        variant="outline"
        size="icon"
        className="h-12 w-12 rounded-full shadow-lg bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-primary/20 hover:border-primary/50"
        onClick={() => { if (!hasMoved.current) openCommandPalette(); }}
      >
        <Search className="h-5 w-5" />
      </Button>

      {/* Nav Menu */}
      <DropdownMenu open={open} onOpenChange={(v) => { if (!hasMoved.current) setOpen(v); }}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg"
          >
            <Menu className="h-6 w-6" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-56 mb-2"
          sideOffset={8}
        >
          <DropdownMenuLabel>Navegação</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <DropdownMenuGroup>
            {mainNavItems.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => handleNavigate(item.path)}
                className={cn(
                  "gap-2 cursor-pointer",
                  isActive(item.path) && "bg-accent"
                )}
              >
                <span className={item.color}>{item.icon}</span>
                {item.label}
              </DropdownMenuItem>
            ))}
            {isAdmin && (
              <DropdownMenuItem
                onClick={() => handleNavigate("/team")}
                className={cn(
                  "gap-2 cursor-pointer",
                  isActive("/team") && "bg-accent"
                )}
              >
                <UsersRound className="h-4 w-4 text-emerald-500" />
                Equipe
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Dashboard
          </DropdownMenuLabel>
          
          <DropdownMenuGroup>
            {dashboardSections.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => handleNavigate(item.path)}
                className={cn(
                  "gap-2 cursor-pointer",
                  isActive(item.path) && "bg-accent"
                )}
              >
                <span className={item.color}>{item.icon}</span>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Automação
          </DropdownMenuLabel>
          
          <DropdownMenuGroup>
            {automationSections.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onClick={() => handleNavigate(item.path)}
                className={cn(
                  "gap-2 cursor-pointer",
                  isActive(item.path) && "bg-accent"
                )}
              >
                <span className={item.color}>{item.icon}</span>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={openCommandPalette}
            className="gap-2 cursor-pointer"
          >
            <Search className="h-4 w-4" />
            Buscar...
            <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

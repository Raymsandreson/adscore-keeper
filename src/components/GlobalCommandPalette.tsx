import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  TrendingUp,
  Trophy,
  UsersRound,
  MessageCircle,
  User,
  CreditCard,
  Filter,
  Bot,
  Target,
  Heart,
  Megaphone,
  Flag,
  Settings,
  Zap,
  Contact,
  BarChart3,
  Wallet,
  LineChart,
} from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string[];
  group: string;
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { isAdmin } = useUserRole();

  // Toggle command palette with Cmd+K or Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  const commands: CommandItem[] = [
    // Navegação Principal
    {
      id: "dashboard",
      label: "Dashboard",
      description: "Visão geral de marketing",
      icon: <LayoutDashboard className="h-4 w-4" />,
      action: () => navigate("/"),
      keywords: ["home", "início", "principal"],
      group: "Navegação",
    },
    {
      id: "leads",
      label: "Central de Leads",
      description: "Gerenciar leads e pipeline",
      icon: <Users className="h-4 w-4" />,
      action: () => navigate("/leads"),
      keywords: ["leads", "vendas", "pipeline", "kanban"],
      group: "Navegação",
    },
    {
      id: "analytics",
      label: "Analytics",
      description: "Métricas de redes sociais",
      icon: <TrendingUp className="h-4 w-4" />,
      action: () => navigate("/analytics"),
      keywords: ["métricas", "instagram", "análise", "estatísticas"],
      group: "Navegação",
    },
    {
      id: "finance",
      label: "Finanças",
      description: "Gestão financeira e despesas",
      icon: <CreditCard className="h-4 w-4" />,
      action: () => navigate("/finance"),
      keywords: ["dinheiro", "gastos", "cartão", "despesas", "financeiro"],
      group: "Navegação",
    },
    {
      id: "leaderboard",
      label: "Ranking",
      description: "Campeonato de engajamento",
      icon: <Trophy className="h-4 w-4" />,
      action: () => navigate("/leaderboard"),
      keywords: ["ranking", "campeões", "engajamento", "pontos"],
      group: "Navegação",
    },
    {
      id: "profile",
      label: "Perfil",
      description: "Suas configurações",
      icon: <User className="h-4 w-4" />,
      action: () => navigate("/profile"),
      keywords: ["perfil", "conta", "usuário", "configurações"],
      group: "Navegação",
    },

    // Seções do Dashboard
    {
      id: "paid-metrics",
      label: "Tráfego Pago",
      description: "Métricas de anúncios",
      icon: <Megaphone className="h-4 w-4" />,
      action: () => navigate("/?tab=paid"),
      keywords: ["ads", "anúncios", "cpc", "ctr", "facebook", "meta"],
      group: "Dashboard",
    },
    {
      id: "organic-metrics",
      label: "Orgânico",
      description: "Métricas orgânicas",
      icon: <Heart className="h-4 w-4" />,
      action: () => navigate("/?tab=organic"),
      keywords: ["orgânico", "alcance", "impressões"],
      group: "Dashboard",
    },
    {
      id: "goals",
      label: "Metas",
      description: "Gerenciar metas",
      icon: <Target className="h-4 w-4" />,
      action: () => navigate("/?tab=goals"),
      keywords: ["metas", "objetivos", "targets"],
      group: "Dashboard",
    },
    {
      id: "automation",
      label: "Automação",
      description: "Instagram e automações",
      icon: <Bot className="h-4 w-4" />,
      action: () => navigate("/?tab=automation"),
      keywords: ["automação", "bot", "instagram", "respostas"],
      group: "Dashboard",
    },

    // Automação - Subseções
    {
      id: "comments",
      label: "Comentários",
      description: "Gerenciar comentários",
      icon: <MessageCircle className="h-4 w-4" />,
      action: () => navigate("/?tab=automation&subtab=comments"),
      keywords: ["comentários", "respostas", "instagram"],
      group: "Automação",
    },
    {
      id: "funnel",
      label: "Funil de Prospecção",
      description: "Pipeline de prospects",
      icon: <Filter className="h-4 w-4" />,
      action: () => navigate("/?tab=automation&subtab=funnel"),
      keywords: ["funil", "prospecção", "prospects"],
      group: "Automação",
    },
    {
      id: "workflow",
      label: "Workflow",
      description: "Responder comentários",
      icon: <Zap className="h-4 w-4" />,
      action: () => navigate("/workflow"),
      keywords: ["workflow", "responder", "trabalho"],
      group: "Automação",
    },
    {
      id: "automation-ai",
      label: "Automação IA",
      description: "Respostas automáticas",
      icon: <Bot className="h-4 w-4" />,
      action: () => navigate("/?tab=automation&subtab=automation"),
      keywords: ["ia", "inteligência", "artificial", "auto"],
      group: "Automação",
    },
    {
      id: "championship",
      label: "Campeonato",
      description: "Rankings de engajamento",
      icon: <Trophy className="h-4 w-4" />,
      action: () => navigate("/?tab=automation&subtab=championship"),
      keywords: ["campeonato", "ranking", "engajamento"],
      group: "Automação",
    },

    // Finanças - Subseções
    {
      id: "transactions",
      label: "Transações",
      description: "Ver todas transações",
      icon: <Wallet className="h-4 w-4" />,
      action: () => navigate("/finance"),
      keywords: ["transações", "compras", "gastos"],
      group: "Finanças",
    },
    {
      id: "card-assignments",
      label: "Cartões",
      description: "Vincular cartões a contatos",
      icon: <CreditCard className="h-4 w-4" />,
      action: () => navigate("/finance"),
      keywords: ["cartões", "vincular", "atribuir"],
      group: "Finanças",
    },

    // Analytics - Subseções
    {
      id: "instagram-accounts",
      label: "Contas Instagram",
      description: "Gerenciar contas",
      icon: <Contact className="h-4 w-4" />,
      action: () => navigate("/analytics"),
      keywords: ["contas", "instagram", "perfis"],
      group: "Analytics",
    },
    {
      id: "metrics-evolution",
      label: "Evolução",
      description: "Gráficos de evolução",
      icon: <LineChart className="h-4 w-4" />,
      action: () => navigate("/analytics"),
      keywords: ["evolução", "gráfico", "histórico"],
      group: "Analytics",
    },

    // Leads - Subseções
    {
      id: "contacts",
      label: "Contatos",
      description: "Gerenciar contatos CRM",
      icon: <Contact className="h-4 w-4" />,
      action: () => navigate("/leads"),
      keywords: ["contatos", "crm", "pessoas"],
      group: "Leads",
    },
  ];

  // Add admin-only commands
  if (isAdmin) {
    commands.push({
      id: "team",
      label: "Gestão de Equipe",
      description: "Gerenciar membros",
      icon: <UsersRound className="h-4 w-4" />,
      action: () => navigate("/team"),
      keywords: ["equipe", "time", "membros", "admin"],
      group: "Navegação",
    });
  }

  // Group commands
  const groupedCommands = commands.reduce((acc, cmd) => {
    if (!acc[cmd.group]) {
      acc[cmd.group] = [];
    }
    acc[cmd.group].push(cmd);
    return acc;
  }, {} as Record<string, CommandItem[]>);

  const groupOrder = ["Navegação", "Dashboard", "Automação", "Finanças", "Analytics", "Leads"];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar área ou função... (Cmd+K)" />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
        
        {groupOrder.map((group, index) => {
          const items = groupedCommands[group];
          if (!items || items.length === 0) return null;
          
          return (
            <div key={group}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={group}>
                {items.map((cmd) => (
                  <CommandItem
                    key={cmd.id}
                    value={`${cmd.label} ${cmd.description} ${cmd.keywords?.join(" ") || ""}`}
                    onSelect={() => runCommand(cmd.action)}
                    className="gap-3 cursor-pointer"
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted">
                      {cmd.icon}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium">{cmd.label}</span>
                      {cmd.description && (
                        <span className="text-xs text-muted-foreground">
                          {cmd.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

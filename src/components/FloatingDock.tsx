import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Phone, Bot, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const DOCK_COLLAPSED_KEY = 'dock-collapsed';

interface FloatingDockProps {
  onOpenNav: () => void;
  onOpenWhatsApp: () => void;
  onOpenAIChat: () => void;
  navOpen: boolean;
}

export function FloatingDock({ onOpenNav, onOpenWhatsApp, onOpenAIChat, navOpen }: FloatingDockProps) {
  const { user } = useAuthContext();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(DOCK_COLLAPSED_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(DOCK_COLLAPSED_KEY, String(collapsed)); } catch {}
  }, [collapsed]);

  const hiddenRoutes = ['/login', '/reset-password', '/privacy', '/expense-form', '/install'];
  if (!user || hiddenRoutes.some(r => location.pathname.startsWith(r))) return null;

  const items = [
    {
      id: 'nav',
      icon: <Menu className="h-5 w-5" />,
      label: 'Menu',
      onClick: onOpenNav,
      active: navOpen,
      color: 'bg-primary text-primary-foreground',
    },
    {
      id: 'whatsapp',
      icon: <Phone className="h-5 w-5" />,
      label: 'WhatsApp',
      onClick: onOpenWhatsApp,
      color: 'bg-green-600 text-white hover:bg-green-700',
    },
    {
      id: 'ai',
      icon: <Bot className="h-5 w-5" />,
      label: 'Chat IA',
      onClick: onOpenAIChat,
      color: 'bg-primary text-primary-foreground',
    },
  ];

  if (collapsed) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 md:bottom-6">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 bg-card/90 backdrop-blur-xl border border-border/60 rounded-full px-3 py-1.5 shadow-2xl text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Menu
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 md:bottom-6">
      <div className="flex items-center gap-1.5 bg-card/90 backdrop-blur-xl border border-border/60 rounded-full px-2 py-1.5 shadow-2xl">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={item.onClick}
            title={item.label}
            className={cn(
              'h-11 w-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-md',
              item.active ? 'ring-2 ring-primary/50 scale-110' : '',
              item.color
            )}
          >
            {item.icon}
          </button>
        ))}
        {/* Minimize button */}
        <button
          onClick={() => setCollapsed(true)}
          title="Minimizar"
          className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

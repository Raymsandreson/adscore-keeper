import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Phone, MessageCircle, Bot } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface FloatingDockProps {
  onOpenNav: () => void;
  onOpenWhatsApp: () => void;
  onOpenAIChat: () => void;
  navOpen: boolean;
}

export function FloatingDock({ onOpenNav, onOpenWhatsApp, onOpenAIChat, navOpen }: FloatingDockProps) {
  const { user } = useAuthContext();
  const location = useLocation();

  const hiddenRoutes = ['/login', '/reset-password', '/privacy', '/expense-form', '/install', '/whatsapp'];
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
      </div>
    </div>
  );
}

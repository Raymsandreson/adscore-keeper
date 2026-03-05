import { useState, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { ActivityChatSheet } from '@/components/activities/ActivityChatSheet';
import { useLocation } from 'react-router-dom';

export function GlobalAIChatButton() {
  const { user } = useAuthContext();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const noop = useCallback(() => {}, []);

  // Don't show on login, reset-password, public pages, or on activities page (it has its own)
  const hiddenRoutes = ['/login', '/reset-password', '/privacy', '/expense-form', '/install'];
  if (!user || hiddenRoutes.some(r => location.pathname.startsWith(r))) return null;
  if (location.pathname === '/') return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center md:bottom-6"
        title="Chat IA"
      >
        <MessageCircle className="h-5 w-5" />
      </button>

      <ActivityChatSheet
        open={open}
        onOpenChange={setOpen}
        activityId={null}
        leadId={null}
        onApplySuggestion={noop}
      />
    </>
  );
}

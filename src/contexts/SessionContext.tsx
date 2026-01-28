import React, { createContext, useContext, ReactNode } from 'react';
import { useSessionTracker } from '@/hooks/useSessionTracker';

interface SessionContextType {
  sessionId: string | null;
  logPageVisit: (pagePath: string) => Promise<void>;
  updateActivity: () => Promise<void>;
  endSession: (reason?: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const sessionTracker = useSessionTracker();

  return (
    <SessionContext.Provider value={sessionTracker}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}

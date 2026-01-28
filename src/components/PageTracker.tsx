import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '@/contexts/SessionContext';

export function PageTracker() {
  const location = useLocation();
  const { logPageVisit } = useSession();

  useEffect(() => {
    logPageVisit(location.pathname);
  }, [location.pathname, logPageVisit]);

  return null;
}

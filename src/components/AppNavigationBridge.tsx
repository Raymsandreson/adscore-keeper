import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerAppNavigator } from '@/lib/appNavigation';

/**
 * Registra o navigate do Router para quem vive fora dele (popups de
 * notificação). Ver src/lib/appNavigation.ts.
 */
export function AppNavigationBridge() {
  const navigate = useNavigate();

  useEffect(() => registerAppNavigator((to) => navigate(to)), [navigate]);

  return null;
}

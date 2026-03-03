import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getIsOnline, onConnectivityChange } from '@/lib/offlineCache';
import { useAuthContext } from '@/contexts/AuthContext';

export function OfflineBanner() {
  const { isOfflineMode, retry } = useAuthContext();
  const [browserOffline, setBrowserOffline] = useState(!getIsOnline());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return onConnectivityChange((online) => {
      setBrowserOffline(!online);
      if (online && isOfflineMode) {
        retry();
      }
    });
  }, [isOfflineMode, retry]);

  const showBanner = (isOfflineMode || browserOffline) && !dismissed;

  if (!showBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between gap-3 text-sm font-medium shadow-lg">
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          {browserOffline 
            ? 'Sem conexão com a internet. Exibindo dados salvos localmente.'
            : 'Servidor indisponível. Usando dados do cache local.'
          }
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1"
          onClick={() => retry()}
        >
          <RefreshCw className="h-3 w-3" />
          Reconectar
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 hover:bg-secondary/30 rounded"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

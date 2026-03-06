import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, X, Share, MoreVertical } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(ios);
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    );

    // Check if user permanently dismissed
    if (localStorage.getItem('pwa_banner_dismissed_forever') === 'true') {
      setDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setDismissed(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDismissed(true);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa_banner_dismissed_forever', 'true');
  };

  // Don't show if already installed, dismissed, or in standalone mode
  if (isStandalone || dismissed) return null;

  // Don't show if no prompt available and not iOS
  if (!deferredPrompt && !isIOS) return null;

  return (
    <>
      {/* Overlay backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => {}} />
      
      {/* Popup central */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95 slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Download className="h-8 w-8 text-primary" />
            </div>
            
            <div>
              <h2 className="text-lg font-bold text-foreground">Instale o WhatsJUD</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Adicione à tela inicial do seu celular e acesse como um app nativo, mais rápido e prático!
              </p>
            </div>

            <div className="w-full space-y-2">
              {deferredPrompt ? (
                <Button onClick={handleInstall} size="lg" className="w-full gap-2">
                  <Download className="h-5 w-5" /> Instalar agora
                </Button>
              ) : isIOS ? (
                <Button 
                  onClick={() => setShowIOSGuide(true)} 
                  size="lg" 
                  className="w-full gap-2"
                >
                  <Share className="h-5 w-5" /> Ver como instalar
                </Button>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                  <MoreVertical className="h-5 w-5 shrink-0" />
                  <span>Toque no menu <strong>⋮</strong> do navegador → <strong>"Instalar app"</strong></span>
                </div>
              )}

              <button 
                onClick={handleDismiss} 
                className="w-full text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
              >
                Não mostrar novamente
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* iOS guide overlay */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-end justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-5 w-full max-w-sm animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">Como instalar no iPhone</h3>
              <button onClick={() => setShowIOSGuide(false)} className="text-muted-foreground p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
                <span>Toque no botão <Share className="h-4 w-4 inline" /> <strong className="text-foreground">Compartilhar</strong> na barra do Safari</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
                <span>Role e toque em <strong className="text-foreground">"Adicionar à Tela de Início"</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
                <span>Toque em <strong className="text-foreground">"Adicionar"</strong></span>
              </li>
            </ol>
            <Button onClick={() => setShowIOSGuide(false)} variant="outline" className="w-full mt-4">
              Entendi
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

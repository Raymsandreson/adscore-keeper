import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Smartphone, Check, Share, MoreVertical } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => setInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  };

  if (isStandalone) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="text-center space-y-4 max-w-sm">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">App instalado!</h1>
          <p className="text-muted-foreground">Você já está usando o WhatsJUD como app.</p>
          <Button onClick={() => window.location.href = '/'} className="w-full">
            Ir para o início
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="text-center space-y-6 max-w-sm">
        <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Smartphone className="h-10 w-10 text-primary" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Instalar WhatsJUD</h1>
          <p className="text-muted-foreground text-sm">
            Adicione o WhatsJUD à tela inicial do seu celular para acessar como um app nativo.
          </p>
        </div>

        {installed ? (
          <div className="space-y-3">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <p className="font-medium text-green-600">App instalado com sucesso!</p>
          </div>
        ) : deferredPrompt ? (
          <Button onClick={handleInstall} size="lg" className="w-full gap-2">
            <Download className="h-5 w-5" /> Instalar App
          </Button>
        ) : isIOS ? (
          <div className="space-y-4 text-left bg-muted/50 rounded-xl p-4">
            <p className="font-semibold text-sm">No iPhone/iPad:</p>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
                <span>Toque no botão <Share className="h-4 w-4 inline" /> <strong>Compartilhar</strong> na barra do Safari</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
                <span>Role para baixo e toque em <strong>"Adicionar à Tela de Início"</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
                <span>Toque em <strong>"Adicionar"</strong> no canto superior direito</span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="space-y-4 text-left bg-muted/50 rounded-xl p-4">
            <p className="font-semibold text-sm">No Android:</p>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
                <span>Toque no menu <MoreVertical className="h-4 w-4 inline" /> do navegador (3 pontinhos)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
                <span>Toque em <strong>"Instalar app"</strong> ou <strong>"Adicionar à tela inicial"</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
                <span>Confirme tocando em <strong>"Instalar"</strong></span>
              </li>
            </ol>
          </div>
        )}

        <Button variant="ghost" onClick={() => window.location.href = '/'} className="w-full text-muted-foreground">
          Continuar no navegador
        </Button>
      </div>
    </div>
  );
}

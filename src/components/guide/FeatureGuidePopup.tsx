import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { HelpCircle, Lightbulb } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { findGuideForPath } from "@/config/featureGuides";
import { useAuthContext } from "@/contexts/AuthContext";

const STORAGE_KEY = "feature_guides_dismissed_v1";

function readDismissed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveDismissed(map: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Guia de funcionalidades da seção atual. Abre sozinho ao entrar numa seção
 * que tem guia cadastrado (src/config/featureGuides.ts), até o usuário clicar
 * em "Não exibir mais". O botão "?" flutuante reabre o guia a qualquer momento.
 */
export function FeatureGuidePopup() {
  const { pathname } = useLocation();
  const { user } = useAuthContext();
  const guide = user ? findGuideForPath(pathname) : undefined;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!guide) return;
    if (readDismissed()[guide.id]) return;
    setOpen(true);
    // Reabre só quando muda de seção (guide.id), não a cada re-render
  }, [guide?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!guide) return null;

  const dismissForever = () => {
    const map = readDismissed();
    map[guide.id] = true;
    saveDismissed(map);
    setOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary shrink-0" />
              {guide.title}
            </DialogTitle>
            <DialogDescription>{guide.intro}</DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-2">
            {guide.items.map((item) => (
              <div key={item.label} className="text-sm leading-snug">
                <span className="font-semibold">{item.label}</span>
                <span className="text-muted-foreground"> — {item.description}</span>
              </div>
            ))}
            {guide.tip && (
              <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm flex gap-2">
                <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Jeito mais prático: </span>
                  {guide.tip}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={dismissForever}>
              Não exibir mais
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`Guia: ${guide.title}`}
          aria-label="Abrir guia de funcionalidades desta tela"
          className="fixed bottom-16 left-4 z-50 h-9 w-9 rounded-full border bg-background/95 shadow-lg backdrop-blur flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      )}
    </>
  );
}

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, ChevronDown, ChevronUp, Sparkles, ArrowRight, RotateCcw } from "lucide-react";
import { changelog, type ChangelogFeature } from "./changelogData";
import { cn } from "@/lib/utils";
import { forceHardRefresh } from "@/lib/pwaUpdater";

interface UpdateNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyUpdate: () => void;
  updating: boolean;
}

function FeatureCard({ feature, index }: { feature: ChangelogFeature; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2 animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${index * 80}ms` }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 text-left"
      >
        <span className="text-2xl shrink-0">{feature.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm text-foreground">{feature.title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{feature.description}</p>
        </div>
        {feature.howToUse && (
          <span className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        )}
      </button>

      {expanded && feature.howToUse && (
        <div className="ml-9 mt-2 p-3 rounded-lg bg-primary/5 border border-primary/10 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ArrowRight className="h-3 w-3 text-primary" />
            <span className="text-xs font-semibold text-primary">Como usar</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{feature.howToUse}</p>
        </div>
      )}
    </div>
  );
}

export function UpdateNotesDialog({ open, onOpenChange, onApplyUpdate, updating }: UpdateNotesDialogProps) {
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const latest = changelog[0];
  if (!latest) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <DialogTitle className="text-lg">{latest.title}</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Versão {latest.version} · {new Date(latest.date).toLocaleDateString("pt-BR")}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Features list */}
        <ScrollArea className="max-h-[50vh] px-4 py-3">
          <div className="space-y-3 pb-2">
            <p className="text-xs text-muted-foreground px-1">
              Clique em cada item para ver <strong>como usar</strong> a novidade:
            </p>
            {latest.features.map((feature, i) => (
              <FeatureCard key={i} feature={feature} index={i} />
            ))}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border px-4 py-3 space-y-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Depois
            </Button>
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={onApplyUpdate}
              disabled={updating || forceRefreshing}
            >
              {updating ? (
                <>Atualizando...</>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Atualizar agora
                </>
              )}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground gap-1.5"
            onClick={() => {
              setForceRefreshing(true);
              forceHardRefresh();
            }}
            disabled={updating || forceRefreshing}
          >
            <RotateCcw className={cn("h-3.5 w-3.5", forceRefreshing && "animate-spin")} />
            {forceRefreshing ? "Limpando cache..." : "Forçar atualização completa"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

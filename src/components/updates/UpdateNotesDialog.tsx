import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, ChevronDown, ChevronUp, Sparkles, ArrowRight, RotateCcw, Play, CheckCircle2 } from "lucide-react";
import { changelog, type ChangelogFeature } from "./changelogData";
import { cn } from "@/lib/utils";
import { forceHardRefresh } from "@/lib/pwaUpdater";
import { FeatureTour } from "./FeatureTour";
import { featureTourMap } from "./featureTourSteps";
import type { TourStep } from "./FeatureTour";

interface UpdateNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyUpdate: () => void;
  updating: boolean;
  acknowledgedVersions?: string[];
  onAcknowledge?: (version: string) => void;
  onAcknowledgeAll?: () => void;
}

function FeatureCard({ feature, index, onStartTour }: { feature: ChangelogFeature; index: number; onStartTour?: (steps: TourStep[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  const tourSteps = featureTourMap[feature.title];

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
        {(feature.howToUse || tourSteps) && (
          <span className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        )}
      </button>

      {expanded && (feature.howToUse || tourSteps) && (
        <div className="ml-9 mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {feature.howToUse && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ArrowRight className="h-3 w-3 text-primary" />
                <span className="text-xs font-semibold text-primary">Como usar</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{feature.howToUse}</p>
            </div>
          )}
          {tourSteps && onStartTour && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs border-primary/30 text-primary hover:bg-primary/5"
              onClick={(e) => {
                e.stopPropagation();
                onStartTour(tourSteps);
              }}
            >
              <Play className="h-3.5 w-3.5" />
              Ver demonstração passo a passo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function UpdateNotesDialog({ open, onOpenChange, onApplyUpdate, updating, acknowledgedVersions = [], onAcknowledge, onAcknowledgeAll }: UpdateNotesDialogProps) {
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [tourSteps, setTourSteps] = useState<TourStep[] | null>(null);
  const [selectedVersionIdx, setSelectedVersionIdx] = useState(0);

  // Show all versions, not just the latest
  const versions = changelog;
  const selected = versions[selectedVersionIdx];
  if (!selected) return null;

  const isAcknowledged = acknowledgedVersions.includes(selected.version);

  const handleDismiss = () => {
    onOpenChange(false);
  };

  const handleStartTour = (steps: TourStep[]) => {
    onOpenChange(false);
    // Small delay to let dialog close
    setTimeout(() => setTourSteps(steps), 300);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <DialogTitle className="text-lg">{selected.title}</DialogTitle>
              </div>
              <DialogDescription className="text-xs">
                Versão {selected.version} · {new Date(selected.date).toLocaleDateString("pt-BR")}
              </DialogDescription>
            </DialogHeader>

            {/* Version tabs */}
            {versions.length > 1 && (
              <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1">
                {versions.map((v, i) => {
                  const acked = acknowledgedVersions.includes(v.version);
                  return (
                    <button
                      key={v.version}
                      onClick={() => setSelectedVersionIdx(i)}
                      className={cn(
                        "shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all flex items-center gap-1",
                        i === selectedVersionIdx
                          ? "bg-primary text-primary-foreground"
                          : acked
                            ? "bg-muted text-muted-foreground"
                            : "bg-destructive/10 text-destructive border border-destructive/20"
                      )}
                    >
                      {acked && <CheckCircle2 className="h-3 w-3" />}
                      v{v.version}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Features list */}
          <ScrollArea className="max-h-[50vh] px-4 py-3">
            <div className="space-y-3 pb-2">
              <p className="text-xs text-muted-foreground px-1">
                Clique em cada item para ver <strong>como usar</strong> ou iniciar uma <strong>demonstração</strong>:
              </p>
              {selected.features.map((feature, i) => (
                <FeatureCard key={i} feature={feature} index={i} onStartTour={handleStartTour} />
              ))}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="border-t border-border px-4 py-3 space-y-2">
            <div className="flex gap-2">
              {!isAcknowledged && onAcknowledge ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => {
                    onAcknowledge(selected.version);
                  }}
                >
                  <Check className="h-4 w-4" />
                  Entendi esta versão
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5 text-emerald-600"
                  disabled
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Ciência dada
                </Button>
              )}
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => {
                  onAcknowledgeAll?.();
                  localStorage.setItem('app_last_seen_version', versions[0]?.version || '');
                  onApplyUpdate();
                }}
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
                onAcknowledgeAll?.();
                localStorage.setItem('app_last_seen_version', versions[0]?.version || '');
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

      {/* Feature Tour overlay */}
      <FeatureTour
        steps={tourSteps || []}
        open={!!tourSteps}
        onClose={() => setTourSteps(null)}
      />
    </>
  );
}

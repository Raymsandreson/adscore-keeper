import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { X, ChevronRight, ChevronLeft, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TourStep {
  /** CSS selector for element to highlight */
  selector: string;
  /** Instruction text */
  title: string;
  description: string;
  /** Where to position the tooltip relative to target */
  position?: "top" | "bottom" | "left" | "right";
}

interface FeatureTourProps {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
}

export function FeatureTour({ steps, open, onClose }: FeatureTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = steps[currentStep];

  const updateRect = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.selector);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setTargetRect(null);
    }
  }, [step]);

  useEffect(() => {
    if (!open) { setCurrentStep(0); return; }
    updateRect();
    const timer = setTimeout(updateRect, 300);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
      clearTimeout(timer);
    };
  }, [open, currentStep, updateRect]);

  if (!open || !step) return null;

  const isLast = currentStep === steps.length - 1;

  // Calculate tooltip position
  const pos = step.position || "bottom";
  let tooltipStyle: React.CSSProperties = {};
  if (targetRect) {
    const padding = 16;
    const cx = targetRect.left + targetRect.width / 2;
    const cy = targetRect.top + targetRect.height / 2;

    switch (pos) {
      case "bottom":
        tooltipStyle = { top: targetRect.bottom + padding, left: Math.max(16, Math.min(cx - 150, window.innerWidth - 316)) };
        break;
      case "top":
        tooltipStyle = { bottom: window.innerHeight - targetRect.top + padding, left: Math.max(16, Math.min(cx - 150, window.innerWidth - 316)) };
        break;
      case "left":
        tooltipStyle = { top: Math.max(16, cy - 50), right: window.innerWidth - targetRect.left + padding };
        break;
      case "right":
        tooltipStyle = { top: Math.max(16, cy - 50), left: targetRect.right + padding };
        break;
    }
  } else {
    tooltipStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999]" onClick={(e) => e.stopPropagation()}>
      {/* Overlay with hole */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 6}
                y={targetRect.top - 6}
                width={targetRect.width + 12}
                height={targetRect.height + 12}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0" width="100%" height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tour-mask)"
          style={{ pointerEvents: "all" }}
        />
      </svg>

      {/* Highlight ring around target */}
      {targetRect && (
        <div
          className="absolute border-2 border-primary rounded-lg pointer-events-none animate-pulse"
          style={{
            left: targetRect.left - 6,
            top: targetRect.top - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        >
          {/* Pulsing circle indicator */}
          <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
            <CircleDot className="h-3 w-3 text-primary-foreground" />
          </div>
        </div>
      )}

      {/* Tooltip card */}
      <div
        className="absolute z-10 w-[300px] bg-card border border-border rounded-xl shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-200"
        style={tooltipStyle}
      >
        {/* Close */}
        <button onClick={onClose} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>

        {/* Step counter */}
        <div className="flex items-center gap-1.5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === currentStep ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"
              )}
            />
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">{currentStep + 1}/{steps.length}</span>
        </div>

        {/* Content */}
        <div>
          <h4 className="font-semibold text-sm text-foreground">{step.title}</h4>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.description}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            className="h-7 text-xs gap-1"
          >
            <ChevronLeft className="h-3 w-3" />
            Anterior
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (isLast) {
                onClose();
              } else {
                setCurrentStep(currentStep + 1);
              }
            }}
            className="h-7 text-xs gap-1"
          >
            {isLast ? "Concluir" : "Próximo"}
            {!isLast && <ChevronRight className="h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { HelpCircle, Lightbulb, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findGuideForPath } from "@/config/featureGuides";
import { useAuthContext } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

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

interface TourStep {
  title: string;
  body: string;
  /** Texto usado pra localizar o botão na tela (ou seletor CSS explícito) */
  anchorLabel?: string;
  selector?: string;
  isIntro?: boolean;
  isTip?: boolean;
}

/**
 * Localiza na tela o elemento clicável cujo texto corresponde ao label do
 * passo. Tenta o label inteiro, sem parênteses/emoji e cada parte de "A / B".
 * Não achou → o balão aparece centralizado (sem destaque), e o tour segue.
 */
function findTargetForLabel(label: string, selector?: string): HTMLElement | null {
  if (selector) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.getBoundingClientRect().width > 0) return el;
  }

  const noEmoji = label
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .trim();
  const noParens = noEmoji.replace(/\(.*?\)/g, "").trim();
  const candidates = [noEmoji, noParens, ...noParens.split("/").map((p) => p.trim())]
    .filter((c) => c.length >= 3);

  const els = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], a, [role="tab"], label')
  );

  for (const cand of candidates) {
    const lc = cand.toLowerCase();
    const el = els.find((e) => {
      const rect = e.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const t = (e.textContent || "").trim().toLowerCase();
      // igual, ou contém com pouca sobra (evita casar com um container gigante)
      return t === lc || (t.includes(lc) && t.length <= lc.length + 20);
    });
    if (el) return el;
  }
  return null;
}

/**
 * Tour guiado das funcionalidades da seção atual: um balão por botão, com
 * Anterior/Próximo, destacando o elemento real na tela (spotlight). Abre
 * sozinho ao entrar numa seção com guia cadastrado (src/config/featureGuides.ts)
 * até o usuário clicar em "Não exibir mais". O "?" flutuante reabre o tour.
 */
export function FeatureGuidePopup() {
  const { pathname } = useLocation();
  const { user } = useAuthContext();
  const guide = user ? findGuideForPath(pathname) : undefined;
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const steps: TourStep[] = guide
    ? [
        { title: guide.title, body: guide.intro, isIntro: true },
        ...guide.items.map((i) => ({
          title: i.label,
          body: i.description,
          anchorLabel: i.label,
          selector: i.selector,
        })),
        ...(guide.tip
          ? [{ title: "Jeito mais prático", body: guide.tip, isTip: true }]
          : []),
      ]
    : [];

  useEffect(() => {
    if (!guide) return;
    if (readDismissed()[guide.id]) return;
    setStepIndex(0);
    setOpen(true);
    // Reabre só quando muda de seção (guide.id), não a cada re-render
  }, [guide?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Localiza e acompanha o elemento destacado do passo atual
  useEffect(() => {
    if (!open || !steps[stepIndex]) {
      setRect(null);
      return;
    }
    const step = steps[stepIndex];
    const el = step.anchorLabel ? findTargetForLabel(step.anchorLabel, step.selector) : null;
    targetRef.current = el;
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });

    const update = () => {
      const r = targetRef.current?.getBoundingClientRect() || null;
      setRect(r && r.width > 0 ? r : null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // acompanha animações/scroll suave/re-layout
    const iv = setInterval(update, 300);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex, guide?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setStepIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setStepIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, steps.length]);

  if (!guide) return null;

  const dismissForever = () => {
    const map = readDismissed();
    map[guide.id] = true;
    saveDismissed(map);
    setOpen(false);
  };

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  // Balão: abaixo do alvo se couber, senão acima; sem alvo → centralizado
  const BALLOON_W = Math.min(330, window.innerWidth - 16);
  const balloonStyle: React.CSSProperties = (() => {
    if (!rect) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: BALLOON_W,
      };
    }
    const margin = 10;
    const fitsBelow = window.innerHeight - rect.bottom > 220;
    let left = rect.left + rect.width / 2 - BALLOON_W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - BALLOON_W - 8));
    return {
      left,
      width: BALLOON_W,
      ...(fitsBelow
        ? { top: rect.bottom + margin }
        : { bottom: window.innerHeight - rect.top + margin }),
    };
  })();

  return (
    <>
      {open && step &&
        createPortal(
          <div className="fixed inset-0 z-[100]">
            {/* Bloqueia cliques na tela enquanto o tour está aberto */}
            <div
              className={cn("absolute inset-0", !rect && "bg-black/50")}
              onClick={() => setStepIndex((i) => Math.min(i + 1, steps.length - 1))}
            />

            {/* Spotlight: anel no elemento + escurece o resto via box-shadow */}
            {rect && (
              <div
                className="absolute rounded-lg border-2 border-primary pointer-events-none transition-all duration-200"
                style={{
                  left: rect.left - 5,
                  top: rect.top - 5,
                  width: rect.width + 10,
                  height: rect.height + 10,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
              />
            )}

            {/* Balão do passo */}
            <div
              className="absolute bg-popover text-popover-foreground border rounded-xl shadow-2xl p-3.5"
              style={balloonStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute top-2 right-2 p-1 rounded hover:bg-accent text-muted-foreground"
                aria-label="Fechar tour"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <div className="flex items-center gap-1.5 pr-6">
                {step.isIntro && <HelpCircle className="h-4 w-4 text-primary shrink-0" />}
                {step.isTip && <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />}
                <span className="text-sm font-semibold leading-tight">{step.title}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                {step.body}
              </p>
              {!step.isIntro && !step.isTip && !rect && (
                <p className="text-[10px] text-muted-foreground/70 mt-1 italic">
                  (procure este recurso na tela — ele pode estar dentro de um menu)
                </p>
              )}

              <div className="flex items-center justify-between mt-3 gap-2">
                <button
                  type="button"
                  onClick={dismissForever}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                >
                  Não exibir mais
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {stepIndex + 1}/{steps.length}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={stepIndex === 0}
                    onClick={() => setStepIndex((i) => Math.max(i - 1, 0))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs gap-1"
                    onClick={() =>
                      isLast ? setOpen(false) : setStepIndex((i) => i + 1)
                    }
                  >
                    {isLast ? "Concluir" : "Próximo"}
                    {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {!open && (
        <button
          type="button"
          onClick={() => {
            setStepIndex(0);
            setOpen(true);
          }}
          title={`Tour: ${guide.title}`}
          aria-label="Abrir tour de funcionalidades desta tela"
          className="fixed bottom-16 left-4 z-50 h-9 w-9 rounded-full border bg-background/95 shadow-lg backdrop-blur flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      )}
    </>
  );
}

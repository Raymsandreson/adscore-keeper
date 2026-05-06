import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Detecta swipe da borda esquerda para a direita no mobile e abre o sidebar.
 * Abre durante o touchmove (não espera touchend) para ficar orgânico.
 */
export function MobileSwipeHandler() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (!isMobile) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;
    let triggered = false;
    let wasOpen = false;

    const EDGE_ZONE = 28;
    const OPEN_TRIGGER = 36; // dispara cedo durante o movimento
    const CLOSE_TRIGGER = 60;
    const MAX_OFF_AXIS = 40;
    const MAX_DURATION = 700;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      wasOpen = openMobile;
      if (!wasOpen && t.clientX > EDGE_ZONE) {
        tracking = false;
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      tracking = true;
      triggered = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || triggered) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      const dt = Date.now() - startTime;

      if (dy > MAX_OFF_AXIS) {
        tracking = false;
        return;
      }
      if (dt > MAX_DURATION) {
        tracking = false;
        return;
      }

      // Abre cedo durante o movimento — sensação orgânica
      if (!wasOpen && dx > OPEN_TRIGGER) {
        triggered = true;
        setOpenMobile(true);
      } else if (wasOpen && dx < -CLOSE_TRIGGER) {
        triggered = true;
        setOpenMobile(false);
      }
    };

    const onTouchEnd = () => {
      tracking = false;
      triggered = false;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isMobile, openMobile, setOpenMobile]);

  return null;
}

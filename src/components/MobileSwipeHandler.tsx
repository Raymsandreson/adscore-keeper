import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Detecta swipe da borda esquerda para a direita no mobile e abre o sidebar.
 * Swipe da direita para esquerda fecha.
 */
export function MobileSwipeHandler() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (!isMobile) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    const EDGE_ZONE = 24; // px da borda esquerda para iniciar swipe-open
    const MIN_DISTANCE = 60;
    const MAX_OFF_AXIS = 50;
    const MAX_DURATION = 600;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      // Para abrir: precisa começar bem na borda esquerda
      // Para fechar: pode começar em qualquer lugar (sidebar aberto)
      if (!openMobile && t.clientX > EDGE_ZONE) {
        tracking = false;
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      tracking = true;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      const dt = Date.now() - startTime;

      if (dt > MAX_DURATION) return;
      if (dy > MAX_OFF_AXIS) return;

      if (!openMobile && dx > MIN_DISTANCE) {
        setOpenMobile(true);
      } else if (openMobile && dx < -MIN_DISTANCE) {
        setOpenMobile(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, openMobile, setOpenMobile]);

  return null;
}

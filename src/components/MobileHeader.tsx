import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Menu, PanelLeftOpen } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";

export function MobileHeader() {
  const { user } = useAuthContext();
  const { state, isMobile } = useSidebar();

  if (!user) return null;

  // Mobile: sticky header with prominent trigger + safe-area for iPhone notch
  if (isMobile) {
    return (
      <div
        className="sticky top-0 z-40 flex items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 shrink-0 md:hidden"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
          minHeight: 'calc(56px + env(safe-area-inset-top))',
        }}
      >
        <SidebarTrigger
          aria-label="Abrir menu"
          className="h-11 w-11 rounded-lg border bg-card shadow-sm hover:bg-accent active:scale-95 transition-transform"
        >
          <Menu className="!h-6 !w-6" />
        </SidebarTrigger>
        <span className="text-sm font-semibold tracking-tight">WhatsJUD</span>
      </div>
    );
  }

  // Desktop: show floating trigger only when sidebar is collapsed
  if (state === "collapsed") {
    return (
      <div className="hidden md:flex fixed top-2 left-2 z-50">
        <SidebarTrigger className="h-8 w-8 bg-background border shadow-sm rounded-md hover:bg-accent">
          <PanelLeftOpen className="h-4 w-4" />
        </SidebarTrigger>
      </div>
    );
  }

  return null;
}

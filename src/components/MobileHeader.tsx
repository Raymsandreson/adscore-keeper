import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Menu, PanelLeftOpen } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";

export function MobileHeader() {
  const { user } = useAuthContext();
  const { state, isMobile } = useSidebar();

  if (!user) return null;

  // Mobile: always show header with trigger
  if (isMobile) {
    return (
      <div className="h-12 flex items-center border-b bg-background px-2 shrink-0 md:hidden">
        <SidebarTrigger className="h-9 w-9">
          <Menu className="h-5 w-5" />
        </SidebarTrigger>
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

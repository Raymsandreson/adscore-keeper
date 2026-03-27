import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Menu } from "lucide-react";

export function MobileHeader() {
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  return (
    <div className="h-12 flex items-center border-b bg-background px-2 shrink-0 md:hidden">
      <SidebarTrigger className="h-9 w-9">
        <Menu className="h-5 w-5" />
      </SidebarTrigger>
    </div>
  );
}

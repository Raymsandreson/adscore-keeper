import { useEffect, useState } from "react";
import { UnifiedKanbanManager } from "@/components/kanban/UnifiedKanbanManager";

const LeadsCenter = () => {
  const [adAccountId, setAdAccountId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("unified_meta_credentials");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.accountId) {
          setAdAccountId(parsed.accountId);
          localStorage.setItem("selectedAdAccountId", parsed.accountId);
          return;
        }
      } catch {
        // ignore
      }
    }
    const fallback = localStorage.getItem("selectedAdAccountId");
    if (fallback) setAdAccountId(fallback);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <UnifiedKanbanManager adAccountId={adAccountId || undefined} />
    </div>
  );
};

export default LeadsCenter;

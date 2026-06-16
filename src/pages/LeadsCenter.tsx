import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UnifiedKanbanManager } from "@/components/kanban/UnifiedKanbanManager";

const LeadsCenter = () => {
  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const catParam = searchParams.get("cat");
  const category =
    catParam === "trabalhista" || catParam === "previdenciario" ? catParam : undefined;

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
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <UnifiedKanbanManager adAccountId={adAccountId || undefined} category={category} />
    </div>
  );
};

export default LeadsCenter;

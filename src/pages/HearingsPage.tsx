import { lazy, Suspense } from "react";

const HearingsModule = lazy(() => import("@/components/hearings/HearingsModule"));

export default function HearingsPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Carregando audiências...</div>}>
      <HearingsModule />
    </Suspense>
  );
}

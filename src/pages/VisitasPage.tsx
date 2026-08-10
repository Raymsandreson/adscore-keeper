import { lazy, Suspense } from 'react';

const SocialVisitsModule = lazy(() => import('@/components/visitas/SocialVisitsModule'));

export default function VisitasPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Carregando visitas...</div>}>
      <SocialVisitsModule />
    </Suspense>
  );
}

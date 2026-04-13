import { lazy } from 'react';

const ArchivedItemsPanel = lazy(() => import('@/components/archived/ArchivedItemsPanel'));

export default function ArchivedItemsPage() {
  return <ArchivedItemsPanel />;
}

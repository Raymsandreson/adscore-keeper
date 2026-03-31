import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Users, Trophy, BarChart3, Map } from 'lucide-react';
import { AmbassadorsList } from './AmbassadorsList';
import { AmbassadorCampaigns } from './AmbassadorCampaigns';
import { AmbassadorDashboard } from './AmbassadorDashboard';
import { AmbassadorMap } from './AmbassadorMap';

const SUB_TABS = [
  { key: 'dashboard', label: 'Painel', icon: BarChart3 },
  { key: 'ambassadors', label: 'Embaixadores', icon: Users },
  { key: 'campaigns', label: 'Campanhas & Metas', icon: Trophy },
  { key: 'map', label: 'Mapa', icon: Map },
] as const;

type SubTab = typeof SUB_TABS[number]['key'];

export function AmbassadorCentral() {
  const [activeTab, setActiveTab] = useState<SubTab>('dashboard');

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        {SUB_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                isActive
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === 'dashboard' && <AmbassadorDashboard />}
      {activeTab === 'ambassadors' && <AmbassadorsList />}
      {activeTab === 'campaigns' && <AmbassadorCampaigns />}
    </div>
  );
}

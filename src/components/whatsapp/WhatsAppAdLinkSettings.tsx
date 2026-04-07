import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Megaphone, MapPin } from 'lucide-react';
import { CTWACampaignAutomation } from './CTWACampaignAutomation';
import { AdSetGeoRulesConfig } from '@/components/ads/AdSetGeoRulesConfig';

const subTabs = [
  { id: 'ctwa', label: 'Automação CTWA', icon: <Megaphone className="h-4 w-4" /> },
  { id: 'geo', label: 'Geo-Segmentação', icon: <MapPin className="h-4 w-4" /> },
];

export function WhatsAppAdLinkSettings() {
  const [activeSubTab, setActiveSubTab] = useState('ctwa');

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-fit">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
              activeSubTab === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'ctwa' && <CTWACampaignAutomation />}
      {activeSubTab === 'geo' && <AdSetGeoRulesConfig />}
    </div>
  );
}

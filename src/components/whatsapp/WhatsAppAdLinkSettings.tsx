import { CTWACampaignAutomation } from './CTWACampaignAutomation';
import { AdSetGeoRulesConfig } from '@/components/ads/AdSetGeoRulesConfig';

export function WhatsAppAdLinkSettings() {
  return (
    <div className="space-y-6">
      <CTWACampaignAutomation />
      <AdSetGeoRulesConfig />
    </div>
  );
}

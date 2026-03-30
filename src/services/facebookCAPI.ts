import { supabase } from "@/integrations/supabase/client";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface CAPIUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  externalId?: string;
}

export interface CAPICustomData {
  value?: number;
  currency?: string;
  contentName?: string;
  contentCategory?: string;
  leadId?: string;
  status?: string;
}

export interface CAPIEvent {
  eventName: string;
  userData?: CAPIUserData;
  customData?: CAPICustomData;
}

interface CAPIResponse {
  success: boolean;
  events_received?: number;
  error?: string;
  details?: any;
}

class FacebookCAPIService {
  async sendEvent(event: CAPIEvent, testEventCode?: string): Promise<CAPIResponse> {
    return this.sendEvents([event], testEventCode);
  }

  async sendEvents(events: CAPIEvent[], testEventCode?: string): Promise<CAPIResponse> {
    try {
      const formattedEvents = events.map(event => ({
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system_generated' as const,
        user_data: event.userData ? {
          em: event.userData.email,
          ph: event.userData.phone,
          fn: event.userData.firstName,
          ln: event.userData.lastName,
          external_id: event.userData.externalId,
        } : undefined,
        custom_data: event.customData ? {
          value: event.customData.value,
          currency: event.customData.currency || 'BRL',
          content_name: event.customData.contentName,
          content_category: event.customData.contentCategory,
          lead_id: event.customData.leadId,
          status: event.customData.status,
        } : undefined,
      }));

      const { data, error } = await cloudFunctions.invoke('facebook-capi', {
        body: {
          events: formattedEvents,
          test_event_code: testEventCode,
        },
      });

      if (error) {
        console.error('CAPI invoke error:', error);
        return { success: false, error: error.message };
      }

      return data as CAPIResponse;
    } catch (error) {
      console.error('CAPI service error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Convenience methods for common events
  async sendLeadEvent(leadData: {
    leadId: string;
    email?: string;
    phone?: string;
    name?: string;
    campaignName?: string;
    value?: number;
  }, testEventCode?: string): Promise<CAPIResponse> {
    const nameParts = leadData.name?.split(' ') || [];
    
    return this.sendEvent({
      eventName: 'Lead',
      userData: {
        email: leadData.email,
        phone: leadData.phone,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' '),
        externalId: leadData.leadId,
      },
      customData: {
        leadId: leadData.leadId,
        contentName: leadData.campaignName,
        value: leadData.value,
      },
    }, testEventCode);
  }

  async sendQualifiedLeadEvent(leadData: {
    leadId: string;
    email?: string;
    phone?: string;
    name?: string;
    value?: number;
  }): Promise<CAPIResponse> {
    const nameParts = leadData.name?.split(' ') || [];
    
    return this.sendEvent({
      eventName: 'CompleteRegistration',
      userData: {
        email: leadData.email,
        phone: leadData.phone,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' '),
        externalId: leadData.leadId,
      },
      customData: {
        leadId: leadData.leadId,
        status: 'qualified',
        value: leadData.value,
      },
    });
  }

  async sendPurchaseEvent(leadData: {
    leadId: string;
    email?: string;
    phone?: string;
    name?: string;
    value: number;
    currency?: string;
  }): Promise<CAPIResponse> {
    const nameParts = leadData.name?.split(' ') || [];
    
    return this.sendEvent({
      eventName: 'Purchase',
      userData: {
        email: leadData.email,
        phone: leadData.phone,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' '),
        externalId: leadData.leadId,
      },
      customData: {
        leadId: leadData.leadId,
        status: 'converted',
        value: leadData.value,
        currency: leadData.currency || 'BRL',
      },
    });
  }
}

export const facebookCAPI = new FacebookCAPIService();

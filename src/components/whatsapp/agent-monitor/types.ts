export interface AgentData {
  id: string;
  shortcut_name: string;
  description: string | null;
  is_active: boolean | null;
}

export interface ConversationDetail {
  phone: string;
  instance_name: string;
  agent_name: string;
  agent_id: string;
  is_active: boolean;
  is_blocked: boolean;
  contact_name: string | null;
  lead_name: string | null;
  lead_id: string | null;
  lead_status: string | null;
  lead_city: string | null;
  lead_state: string | null;
  lead_acolhedor: string | null;
  board_id: string | null;
  board_name: string | null;
  stage_name: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  total_messages: number;
  inbound_count: number;
  outbound_count: number;
  followup_count: number;
  has_followup_config: boolean;
  time_without_response: number | null;
  campaign_name: string | null;
  activated_by: string | null;
  activated_at: string | null;
  whatsapp_group_id: string | null;
  created_at: string | null;
}

export interface AgentStats {
  agent_id: string;
  agent_name: string;
  total_conversations: number;
  active_conversations: number;
  paused_conversations: number;
  inactive_conversations: number;
  total_messages_sent: number;
  total_messages_received: number;
  response_rate: number;
  conversations_by_stage: Record<string, number>;
  followups_sent: number;
  leads_closed: number;
  leads_refused: number;
  without_response_count: number;
}

export interface ReferralData {
  id: string;
  ambassador_name: string;
  contact_name: string | null;
  lead_name: string | null;
  status: string;
  created_at: string;
  campaign_name: string | null;
}

export interface BoardData {
  id: string;
  name: string;
  stages: any[];
}

export type CaseStatus = 'sem_resposta' | 'em_andamento' | 'fechado' | 'recusado' | 'inviavel' | 'bloqueado';

export interface RedirectionData {
  id: string;
  agent_name: string | null;
  phone: string;
  instance_name: string;
  group_jid: string | null;
  notify_instance_name: string | null;
  group_message: string | null;
  private_notification: string | null;
  created_at: string;
}

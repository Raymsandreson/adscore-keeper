import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AgentData, BoardData } from '../types';

interface MonitorFilterBarProps {
  agents: AgentData[];
  uniqueInstances: string[];
  uniqueBoards: BoardData[];
  uniqueCampaigns: string[];
  agentFilter: string;
  setAgentFilter: (v: string) => void;
  instanceFilter: string;
  setInstanceFilter: (v: string) => void;
  boardFilter: string;
  setBoardFilter: (v: string) => void;
  campaignFilter: string;
  setCampaignFilter: (v: string) => void;
  agentActiveFilter: 'all' | 'ativo' | 'pausado';
  setAgentActiveFilter: (v: 'all' | 'ativo' | 'pausado') => void;
  followupConfigFilter: 'all' | 'com_followup' | 'sem_followup';
  setFollowupConfigFilter: (v: 'all' | 'com_followup' | 'sem_followup') => void;
}

export function MonitorFilterBar({
  agents, uniqueInstances, uniqueBoards, uniqueCampaigns,
  agentFilter, setAgentFilter, instanceFilter, setInstanceFilter,
  boardFilter, setBoardFilter, campaignFilter, setCampaignFilter,
  agentActiveFilter, setAgentActiveFilter, followupConfigFilter, setFollowupConfigFilter,
}: MonitorFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={agentFilter} onValueChange={setAgentFilter}>
        <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Agente IA" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Agentes</SelectItem>
          {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.shortcut_name}</SelectItem>)}
        </SelectContent>
      </Select>

      {uniqueInstances.length > 1 && (
        <Select value={instanceFilter} onValueChange={setInstanceFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Instância" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Instâncias</SelectItem>
            {uniqueInstances.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {uniqueBoards.length > 1 && (
        <Select value={boardFilter} onValueChange={setBoardFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Funil" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Funis</SelectItem>
            {uniqueBoards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {uniqueCampaigns.length > 0 && (
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Origem" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Origens</SelectItem>
            <SelectItem value="__none__">Sem Campanha</SelectItem>
            {uniqueCampaigns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <Select value={agentActiveFilter} onValueChange={(v) => setAgentActiveFilter(v as any)}>
        <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Status Agente" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Status</SelectItem>
          <SelectItem value="ativo">Ativo</SelectItem>
          <SelectItem value="pausado">Pausado</SelectItem>
        </SelectContent>
      </Select>

      <Select value={followupConfigFilter} onValueChange={(v) => setFollowupConfigFilter(v as any)}>
        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Follow-up" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Follow-up</SelectItem>
          <SelectItem value="com_followup">Com Follow-up</SelectItem>
          <SelectItem value="sem_followup">Sem Follow-up</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AgentData, BoardData, UserData } from '../types';

interface MonitorFilterBarProps {
  agents: AgentData[];
  uniqueInstances: string[];
  uniqueBoards: BoardData[];
  uniqueCampaigns: string[];
  uniqueAcolhedores: string[];
  uniqueUsers: UserData[];
  agentFilter: string;
  setAgentFilter: (v: string) => void;
  instanceFilter: string;
  setInstanceFilter: (v: string) => void;
  boardFilter: string;
  setBoardFilter: (v: string) => void;
  campaignFilter: string;
  setCampaignFilter: (v: string) => void;
  acolhedorFilter: string;
  setAcolhedorFilter: (v: string) => void;
  agentActiveFilter: 'all' | 'ativo';
  setAgentActiveFilter: (v: 'all' | 'ativo') => void;
  followupConfigFilter: 'all' | 'com_followup' | 'sem_followup';
  setFollowupConfigFilter: (v: 'all' | 'com_followup' | 'sem_followup') => void;
  userFilter: string;
  setUserFilter: (v: string) => void;
}

export function MonitorFilterBar({
  agents, uniqueInstances, uniqueBoards, uniqueCampaigns, uniqueAcolhedores, uniqueUsers,
  agentFilter, setAgentFilter, instanceFilter, setInstanceFilter,
  boardFilter, setBoardFilter, campaignFilter, setCampaignFilter,
  acolhedorFilter, setAcolhedorFilter,
  agentActiveFilter, setAgentActiveFilter, followupConfigFilter, setFollowupConfigFilter,
  userFilter, setUserFilter,
}: MonitorFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={agentFilter} onValueChange={setAgentFilter}>
        <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Agente IA" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Agentes</SelectItem>
          <SelectItem value="__none__">Sem Agente</SelectItem>
          {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.shortcut_name}</SelectItem>)}
        </SelectContent>
      </Select>

      {uniqueUsers.length > 1 && (
        <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); if (v !== 'all') setInstanceFilter('all'); }}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Usuário" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Usuários</SelectItem>
            {uniqueUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {uniqueInstances.length > 1 && (
        <Select value={instanceFilter} onValueChange={(v) => { setInstanceFilter(v); if (v !== 'all') setUserFilter('all'); }}>
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

      {uniqueAcolhedores.length > 0 && (
        <Select value={acolhedorFilter} onValueChange={setAcolhedorFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Acolhedor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Acolhedores</SelectItem>
            <SelectItem value="__none__">Sem Acolhedor</SelectItem>
            {uniqueAcolhedores.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

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

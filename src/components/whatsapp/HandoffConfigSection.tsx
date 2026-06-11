import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { UserCog } from 'lucide-react';

export type HandoffMode = 'transparent' | 'disguised';
export type HandoffFallback = 'process_responsible' | 'case_acolhedor' | 'lead_owner';
export type HandoffDeadline = 'end_of_day' | '+2h' | '+4h' | 'next_business_day';

export interface HandoffConfig {
  mode: HandoffMode;
  fallback_order: HandoffFallback[];
  deadline: HandoffDeadline;
  end_of_day_hour: number;
  notify_internal_chat: boolean;
  phrases: {
    retorno: string;
    ligacao: string;
    reuniao: string;
    fechamento: string;
  };
}

export const DEFAULT_HANDOFF_TRANSPARENT: HandoffConfig = {
  mode: 'transparent',
  fallback_order: ['process_responsible', 'case_acolhedor', 'lead_owner'],
  deadline: 'end_of_day',
  end_of_day_hour: 18,
  notify_internal_chat: true,
  phrases: {
    retorno: 'Deixa eu confirmar com o time e te retorno até o fim do dia.',
    ligacao: 'Vou pedir pra alguém do time te ligar pra explicar melhor.',
    reuniao: 'Vou alinhar uma reunião com o time pra fechar isso com você.',
    fechamento: 'Vou organizar tudo aqui internamente e já te confirmo.',
  },
};

export const DEFAULT_HANDOFF_DISGUISED: HandoffConfig = {
  mode: 'disguised',
  fallback_order: ['process_responsible', 'case_acolhedor', 'lead_owner'],
  deadline: 'end_of_day',
  end_of_day_hour: 18,
  notify_internal_chat: true,
  phrases: {
    retorno: 'Deixa eu olhar uma coisa aqui rapidinho e já te chamo, tá?',
    ligacao: 'Te ligo daqui a pouco pra explicar melhor, ok?',
    reuniao: 'Acho melhor a gente conversar com calma — qual horário você prefere?',
    fechamento: 'Vou organizar isso e já te confirmo.',
  },
};

const FALLBACK_LABELS: Record<HandoffFallback, string> = {
  process_responsible: 'Responsável do processo',
  case_acolhedor: 'Acolhedor do caso',
  lead_owner: 'Dono do lead',
};

interface Props {
  value: HandoffConfig | null | undefined;
  onChange: (v: HandoffConfig | null) => void;
}

export function HandoffConfigSection({ value, onChange }: Props) {
  const enabled = !!value;
  const cfg = value ?? DEFAULT_HANDOFF_TRANSPARENT;

  const update = (patch: Partial<HandoffConfig>) => {
    onChange({ ...cfg, ...patch });
  };
  const updatePhrase = (k: keyof HandoffConfig['phrases'], v: string) => {
    onChange({ ...cfg, phrases: { ...cfg.phrases, [k]: v } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 border rounded-lg p-3 bg-muted/30">
        <div className="flex-1">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <UserCog className="h-4 w-4" />
            Handoff humano
          </Label>
          <p className="text-[11px] text-muted-foreground mt-1">
            Quando o agente precisar de ação humana (retorno, ligação, reunião ou fechamento),
            ele escreve um marcador invisível que o sistema converte em atividade pendente
            para o responsável escolhido aqui.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onChange(v ? DEFAULT_HANDOFF_TRANSPARENT : null)}
        />
      </div>

      {enabled && (
        <>
          <div>
            <Label className="text-xs font-semibold">Modo do agente</Label>
            <Select value={cfg.mode} onValueChange={(v) => {
              const base = v === 'disguised' ? DEFAULT_HANDOFF_DISGUISED : DEFAULT_HANDOFF_TRANSPARENT;
              // mantém fallback/deadline/end_of_day/notify atuais, só troca frases default + mode
              onChange({ ...cfg, mode: v as HandoffMode, phrases: cfg.phrases.retorno === DEFAULT_HANDOFF_TRANSPARENT.phrases.retorno || cfg.phrases.retorno === DEFAULT_HANDOFF_DISGUISED.phrases.retorno ? base.phrases : cfg.phrases });
            }}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transparent">Transparente — pode dizer que vai falar com o time</SelectItem>
                <SelectItem value="disguised">Disfarçado — fala como se fosse o próprio atendente humano</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold">Quem assume (ordem de fallback)</Label>
            <div className="space-y-1.5 mt-1">
              {cfg.fallback_order.map((f, idx) => (
                <div key={f} className="flex items-center gap-2 text-xs border rounded-md px-2 py-1.5 bg-background">
                  <Badge variant="outline" className="text-[10px]">{idx + 1}º</Badge>
                  <span className="flex-1">{FALLBACK_LABELS[f]}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => {
                        const arr = [...cfg.fallback_order];
                        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                        update({ fallback_order: arr });
                      }}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                    >↑</button>
                    <button
                      type="button"
                      disabled={idx === cfg.fallback_order.length - 1}
                      onClick={() => {
                        const arr = [...cfg.fallback_order];
                        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                        update({ fallback_order: arr });
                      }}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                    >↓</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Se o primeiro estiver vazio no caso, tenta o próximo da lista.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Prazo padrão</Label>
              <Select value={cfg.deadline} onValueChange={(v) => update({ deadline: v as HandoffDeadline })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="end_of_day">Fim do expediente</SelectItem>
                  <SelectItem value="+2h">Em 2 horas</SelectItem>
                  <SelectItem value="+4h">Em 4 horas</SelectItem>
                  <SelectItem value="next_business_day">Próximo dia útil</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Hora fim do expediente</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={cfg.end_of_day_hour}
                onChange={(e) => update({ end_of_day_hour: parseInt(e.target.value) || 18 })}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border rounded-md px-3 py-2">
            <div>
              <Label className="text-xs">Notificar responsável no chat interno</Label>
              <p className="text-[10px] text-muted-foreground">DM direta, só ele vê.</p>
            </div>
            <Switch
              checked={cfg.notify_internal_chat}
              onCheckedChange={(v) => update({ notify_internal_chat: v })}
            />
          </div>

          <div className="space-y-2 border rounded-lg p-3">
            <Label className="text-xs font-semibold">Frases que o agente fala ao cliente</Label>
            <p className="text-[10px] text-muted-foreground">
              O agente escolhe a frase conforme o tipo de handoff. {cfg.mode === 'disguised' && 'No modo disfarçado, ele NUNCA menciona "time" ou "equipe".'}
            </p>

            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Retorno (confirmar algo)</Label>
              <Textarea rows={2} value={cfg.phrases.retorno} onChange={(e) => updatePhrase('retorno', e.target.value)} className="text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Ligação</Label>
              <Textarea rows={2} value={cfg.phrases.ligacao} onChange={(e) => updatePhrase('ligacao', e.target.value)} className="text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Reunião</Label>
              <Textarea rows={2} value={cfg.phrases.reuniao} onChange={(e) => updatePhrase('reuniao', e.target.value)} className="text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Fechamento</Label>
              <Textarea rows={2} value={cfg.phrases.fechamento} onChange={(e) => updatePhrase('fechamento', e.target.value)} className="text-xs" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

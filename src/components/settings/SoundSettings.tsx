import { Volume2, Play } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useSoundSettings } from '@/hooks/useSoundSettings';
import type { SoundKey } from '@/lib/soundSettings';
import { playAlarmSound, playUrgentChime } from '@/lib/sounds';

interface SoundOption {
  key: SoundKey;
  label: string;
  description: string;
  /** Som que o botão "Testar" toca — o mesmo que o aviso emite. */
  preview: () => void;
}

const GROUPS: { title: string; options: SoundOption[] }[] = [
  {
    title: 'Cronômetro de atividades',
    options: [
      {
        key: 'timerIdle',
        label: 'Você está ocioso',
        description: 'A cada 5 minutos parado, sem atividade vinculada.',
        preview: playAlarmSound,
      },
      {
        key: 'timerStillWorking',
        label: 'Ainda está fazendo?',
        description: '5 minutos sem mexer no sistema com uma atividade rodando.',
        preview: playAlarmSound,
      },
      {
        key: 'timerBreakOverdue',
        label: 'Pausa acabou',
        description: 'A pausa passou da previsão de retorno que você definiu.',
        preview: playAlarmSound,
      },
      {
        key: 'timerEstimateOverdue',
        label: 'Previsão estourada',
        description: 'A atividade passou do tempo que você previu para ela.',
        preview: playAlarmSound,
      },
    ],
  },
  {
    title: 'Chat interno',
    options: [
      {
        key: 'chatUrgent',
        label: 'Mensagem urgente',
        description: 'Mensagem marcada como urgente de outro membro da equipe.',
        preview: playUrgentChime,
      },
    ],
  },
  {
    title: 'Gestão',
    options: [
      {
        key: 'managerAlert',
        label: 'Chamado da gestão',
        description: 'Quando a gestão pausa seu cronômetro, encerra seu expediente ou te chama.',
        preview: playAlarmSound,
      },
    ],
  },
  {
    title: 'Ligações',
    options: [
      {
        key: 'newDialableLead',
        label: 'Lead novo para ligar',
        description: 'Um lead com telefone válido acabou de entrar. O aviso na tela aparece de todo jeito.',
        preview: playUrgentChime,
      },
    ],
  },
];

/**
 * Liga/desliga cada aviso sonoro. Todos vêm desligados; a escolha vale por
 * dispositivo (localStorage) e vale na hora, sem recarregar a página.
 */
export function SoundSettings() {
  const { settings, toggle } = useSoundSettings();

  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Volume2 className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Sons do sistema</h3>
          <p className="text-xs text-muted-foreground">
            Todos vêm desligados. O aviso continua aparecendo na tela — o que você liga aqui é só o som.
          </p>
        </div>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            {group.title}
          </p>
          <div className="space-y-1">
            {group.options.map((option) => (
              <div
                key={option.key}
                className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <Label htmlFor={`sound-${option.key}`} className="text-sm font-medium cursor-pointer">
                    {option.label}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 shrink-0 text-muted-foreground"
                  onClick={option.preview}
                  title="Ouvir este som"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline text-xs">Testar</span>
                </Button>
                <Switch
                  id={`sound-${option.key}`}
                  checked={settings[option.key]}
                  onCheckedChange={(checked) => toggle(option.key, checked)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        A escolha vale neste navegador. Em outro aparelho — ou depois de limpar os dados do site —
        tudo volta a nascer desligado.
      </p>
    </div>
  );
}

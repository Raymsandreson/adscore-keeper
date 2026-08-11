import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MessageSquare, Save, Moon, Users, Smartphone, Info } from 'lucide-react';

/**
 * Configuração do push de MENSAGEM NOVA do WhatsApp.
 *
 * Não confundir com WhatsAppNotificationSettings (que dispara relatórios PARA
 * números de WhatsApp). Aqui é o contrário: a mensagem que chega numa conversa
 * vira notificação nativa no aparelho, com link direto pra conversa no WhatsJUD.
 *
 * Escopo de quem recebe é fixo por regra de negócio, não é escolha da tela:
 *   - conversa PRIVADA → dono da instância que recebeu;
 *   - GRUPO → só quem é responsável pelo processo ou acolhedor do lead.
 * A tela só liga/desliga cada um desses canais e ajusta volume e horário.
 */

interface PushPrefs {
  enabled: boolean;
  notify_owned_instance: boolean;
  notify_process_groups: boolean;
  group_window_minutes: number;
  quiet_start_hour: number;
  quiet_end_hour: number;
  weekdays_only: boolean;
}

const DEFAULT_PREFS: PushPrefs = {
  enabled: true,
  notify_owned_instance: true,
  notify_process_groups: true,
  group_window_minutes: 5,
  quiet_start_hour: 22,
  quiet_end_hour: 7,
  weekdays_only: false,
};

const WINDOW_OPTIONS = [
  { value: 0, label: 'Sem agrupar — uma notificação por mensagem' },
  { value: 1, label: '1 minuto' },
  { value: 5, label: '5 minutos (recomendado)' },
  { value: 15, label: '15 minutos' },
  { value: 30, label: '30 minutos' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number) {
  return `${String(h).padStart(2, '0')}:00`;
}

export function WhatsAppPushSettings() {
  const { user } = useAuthContext();
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PREFS);
  const [ownedInstances, setOwnedInstances] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        await ensureExternalSession();
        // Tudo aqui vive no EXTERNO e é chaveado pelo id de LÁ: a RLS de
        // whatsapp_push_prefs compara `auth.uid() = user_id`, e owner_user_id
        // guarda o id do Externo. Gravar com o id do Cloud fazia o save ser
        // recusado pela RLS (tabela estava vazia) e a tela dizer que a pessoa
        // não é dona de instância nenhuma — vale para os 26 cadastros em que os
        // dois ids diferem.
        const extUserId = (await remapToExternal(user.id)) || user.id;
        // `as any`: whatsapp_push_prefs e whatsapp_instances.owner_user_id nasceram
        // na migration 20260804213000 e ainda não estão no types.ts gerado.
        const [prefsRes, instRes] = await Promise.all([
          (db as any).from('whatsapp_push_prefs').select('*').eq('user_id', extUserId).maybeSingle(),
          (db as any).from('whatsapp_instances').select('instance_name').eq('owner_user_id', extUserId),
        ]);
        if (cancelled) return;

        if (prefsRes.data) {
          setPrefs({ ...DEFAULT_PREFS, ...(prefsRes.data as Partial<PushPrefs>) });
        }
        setOwnedInstances(
          ((instRes.data || []) as { instance_name: string }[]).map((i) => i.instance_name).filter(Boolean)
        );
      } catch (e) {
        console.error('[wa-push-settings] falha ao carregar:', e);
        if (!cancelled) toast.error('Não foi possível carregar suas preferências');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const save = useCallback(async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await ensureExternalSession();
      // Id do Externo — é o que a RLS e o servidor de push enxergam.
      const extUserId = (await remapToExternal(user.id)) || user.id;
      const { error } = await (db as any)
        .from('whatsapp_push_prefs')
        .upsert({ user_id: extUserId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
      toast.success('Preferências salvas');
    } catch (e) {
      console.error('[wa-push-settings] falha ao salvar:', e);
      toast.error('Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  }, [user?.id, prefs]);

  const set = <K extends keyof PushPrefs>(key: K, value: PushPrefs[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const quietDisabled = prefs.quiet_start_hour === prefs.quiet_end_hour;

  const scopeSummary = useMemo(() => {
    if (ownedInstances.length === 0) return null;
    return ownedInstances.join(', ');
  }, [ownedInstances]);

  if (loading) {
    return (
      <div className="rounded-xl border p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
          <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Mensagem nova do WhatsApp</h3>
          <p className="text-xs text-muted-foreground">
            Avisa aqui quando chega mensagem, e abre direto na conversa dentro do WhatsJUD.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <Label className="text-sm font-medium">Receber notificação de mensagem nova</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Desligando aqui, nada abaixo se aplica.
          </p>
        </div>
        <Switch checked={prefs.enabled} onCheckedChange={(v) => set('enabled', v)} />
      </div>

      <fieldset disabled={!prefs.enabled} className="space-y-4 disabled:opacity-50">
        {/* ---- O que notificar ---- */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">O que notificar</p>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" /> Conversas privadas da minha instância
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {scopeSummary
                  ? <>Mensagens diretas (não de grupo) que chegam em <b className="text-foreground">{scopeSummary}</b>.</>
                  : 'Você ainda não consta como dono de nenhuma instância — peça à diretoria para definir isso em Instâncias.'}
              </p>
            </div>
            <Switch
              checked={prefs.notify_owned_instance}
              onCheckedChange={(v) => set('notify_owned_instance', v)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Meus grupos de cliente
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Só os grupos em que você é responsável pelo processo ou acolhedor do lead.
                Grupo em que você só participa não notifica.
              </p>
            </div>
            <Switch
              checked={prefs.notify_process_groups}
              onCheckedChange={(v) => set('notify_process_groups', v)}
            />
          </div>
        </div>

        {/* ---- Volume ---- */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Volume</p>
          <div className="rounded-lg border p-3 space-y-2">
            <Label className="text-sm font-medium">Agrupar mensagens da mesma conversa</Label>
            <Select
              value={String(prefs.group_window_minutes)}
              onValueChange={(v) => set('group_window_minutes', Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A primeira mensagem avisa na hora. Dentro da janela escolhida, as seguintes da
              mesma conversa não tocam de novo — só somam na contagem.
            </p>
            {prefs.group_window_minutes === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/30 p-2.5">
                <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground">
                  Sem agrupamento, uma conversa movimentada pode gerar centenas de notificações por dia.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ---- Horário ---- */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Horário</p>
          <div className="rounded-lg border p-3 space-y-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Moon className="h-3.5 w-3.5" /> Silêncio noturno
              </Label>
              <div className="flex items-center gap-2 mt-2">
                <Select
                  value={String(prefs.quiet_start_hour)}
                  onValueChange={(v) => set('quiet_start_hour', Number(v))}
                >
                  <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">até</span>
                <Select
                  value={String(prefs.quiet_end_hour)}
                  onValueChange={(v) => set('quiet_end_hour', Number(v))}
                >
                  <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {quietDisabled && <Badge variant="secondary" className="text-[10px]">desligado</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Horário de Brasília. Deixe os dois iguais para nunca silenciar.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <Label className="text-sm font-medium">Só em dias úteis</Label>
              <Switch
                checked={prefs.weekdays_only}
                onCheckedChange={(v) => set('weekdays_only', v)}
              />
            </div>
          </div>
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Precisa ter as notificações do dispositivo ativadas no cartão acima — sem isso, nada chega.
      </p>
    </div>
  );
}

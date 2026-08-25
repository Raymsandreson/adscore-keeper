/**
 * Hora da Notificação da atividade.
 *
 * O campo "🔔 Notificação" guardava só o dia: `lead_activities.notification_date`
 * é DATE desde fev/2026, e o único lugar que já oferecia hora
 * (ConfirmDialogDateFields, um `datetime-local`) mandava o instante para essa
 * coluna, que truncava em silêncio. Em 25/08/2026 nasceu `notification_at`
 * (timestamptz, migration 20260825120000) para guardar o instante completo.
 *
 * O par continua partido de propósito: `notification_date` segue sendo a data
 * pura e é ela que alimenta agenda, Google Calendar, BulkReassign e a contagem
 * de carga do dia. A hora vive só em `notification_at`.
 *
 * Convenção: meia-noite = SEM hora definida. As 22.247 atividades anteriores à
 * coluna não têm hora nenhuma para exibir, e "às 00:00" numa mensagem ao
 * cliente seria pior do que não dizer nada.
 */
import { format, parseISO } from 'date-fns';

/** `yyyy-MM-dd` + `HH:mm` (fuso do navegador) → ISO de `notification_at`. */
export function buildNotificationAt(dia: string, hora: string): string | null {
  if (!dia) return null;
  const d = new Date(`${dia.slice(0, 10)}T${(hora || '00:00').slice(0, 5)}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Instante gravado → `HH:mm` local para o input. Meia-noite volta vazio. */
export function hydrateNotificationTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const hhmm = format(parseISO(iso), 'HH:mm');
    return hhmm === '00:00' ? '' : hhmm;
  } catch {
    return '';
  }
}

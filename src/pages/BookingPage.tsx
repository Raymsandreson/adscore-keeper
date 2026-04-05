import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Calendar, Clock, Video, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, startOfDay, isSameDay, isAfter, setHours, setMinutes, addMinutes, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface MeetingConfig {
  id: string;
  meeting_duration_minutes: number;
  buffer_minutes: number;
  available_days: number[];
  start_hour: number;
  end_hour: number;
  meeting_type: string;
  host_user_id: string;
}

interface Booking {
  slot_id: string;
  start_time: string;
  end_time: string;
}

export default function BookingPage() {
  const { configId, token } = useParams<{ configId: string; token?: string }>();
  const [config, setConfig] = useState<MeetingConfig | null>(null);
  const [hostName, setHostName] = useState('');
  const [existingBookings, setExistingBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedTime, setConfirmedTime] = useState<Date | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchConfig();
  }, [configId]);

  const fetchConfig = async () => {
    setLoading(true);
    const { data, error: err } = await (supabase as any)
      .from('onboarding_meeting_configs')
      .select('*')
      .eq('id', configId)
      .eq('is_active', true)
      .maybeSingle();

    if (!data || err) {
      setError('Link de agendamento inválido ou expirado.');
      setLoading(false);
      return;
    }

    setConfig(data);

    // Fetch host name
    if (data.host_user_id) {
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('user_id', data.host_user_id).maybeSingle();
      if (profile) setHostName(profile.full_name || '');
    }

    // Fetch existing bookings to block taken slots
    const { data: bookings } = await (supabase as any)
      .from('onboarding_meeting_bookings')
      .select('slot_id, config_id, created_at')
      .eq('config_id', data.id)
      .in('status', ['pending', 'confirmed']);

    // Get slot times for bookings
    if (bookings && bookings.length > 0) {
      const slotIds = bookings.map((b: any) => b.slot_id).filter(Boolean);
      if (slotIds.length > 0) {
        const { data: slots } = await (supabase as any)
          .from('onboarding_meeting_slots')
          .select('id, start_time, end_time')
          .in('id', slotIds);
        setExistingBookings(
          (slots || []).map((s: any) => ({ slot_id: s.id, start_time: s.start_time, end_time: s.end_time }))
        );
      }
    }

    // Check if this token already has a booking
    if (token) {
      const { data: existingBooking } = await (supabase as any)
        .from('onboarding_meeting_bookings')
        .select('*, onboarding_meeting_slots(start_time, end_time)')
        .eq('booking_token', token)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle();

      if (existingBooking?.onboarding_meeting_slots?.start_time) {
        setConfirmed(true);
        setConfirmedTime(new Date(existingBooking.onboarding_meeting_slots.start_time));
      }
    }

    setLoading(false);
  };

  // Generate available dates for the week view
  const availableDates = useMemo(() => {
    if (!config) return [];
    const dates: Date[] = [];
    const today = startOfDay(new Date());
    const baseStart = addDays(today, weekOffset * 7);

    for (let i = 0; i < 14; i++) {
      const date = addDays(baseStart, i);
      if (isAfter(date, addDays(today, -1)) && config.available_days.includes(date.getDay())) {
        dates.push(date);
      }
    }
    return dates.slice(0, 7);
  }, [config, weekOffset]);

  // Generate time slots for selected date
  const timeSlots = useMemo(() => {
    if (!config || !selectedDate) return [];
    const slots: { start: Date; end: Date; available: boolean }[] = [];
    const slotSize = config.meeting_duration_minutes + config.buffer_minutes;

    let current = setMinutes(setHours(selectedDate, config.start_hour), 0);
    const endOfDay = setMinutes(setHours(selectedDate, config.end_hour), 0);
    const now = new Date();

    while (current < endOfDay) {
      const slotEnd = addMinutes(current, config.meeting_duration_minutes);
      if (slotEnd > endOfDay) break;

      const isPast = current <= now;
      const isBooked = existingBookings.some(b => {
        const bookStart = new Date(b.start_time);
        const bookEnd = new Date(b.end_time);
        return (current < bookEnd && slotEnd > bookStart);
      });

      slots.push({ start: new Date(current), end: new Date(slotEnd), available: !isPast && !isBooked });
      current = addMinutes(current, slotSize);
    }

    return slots;
  }, [config, selectedDate, existingBookings]);

  const handleBook = async () => {
    if (!selectedSlot || !config) return;
    setBooking(true);

    try {
      // Create slot
      const { data: slot } = await (supabase as any)
        .from('onboarding_meeting_slots')
        .insert({
          config_id: config.id,
          start_time: selectedSlot.start.toISOString(),
          end_time: selectedSlot.end.toISOString(),
          is_available: false,
        })
        .select()
        .single();

      if (!slot) throw new Error('Erro ao criar slot');

      // Create or update booking
      if (token) {
        await (supabase as any)
          .from('onboarding_meeting_bookings')
          .update({ slot_id: slot.id, status: 'confirmed' })
          .eq('booking_token', token);
      } else {
        await (supabase as any)
          .from('onboarding_meeting_bookings')
          .insert({
            slot_id: slot.id,
            config_id: config.id,
            status: 'confirmed',
          });
      }

      setConfirmed(true);
      setConfirmedTime(selectedSlot.start);
    } catch (err) {
      setError('Erro ao confirmar agendamento. Tente novamente.');
    }
    setBooking(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">Reunião Agendada! 🎉</h2>
            {confirmedTime && (
              <div className="space-y-2">
                <p className="text-lg font-semibold text-primary">
                  {format(confirmedTime, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                </p>
                <p className="text-2xl font-bold">
                  {format(confirmedTime, 'HH:mm')}
                </p>
                <Badge variant="secondary" className="text-xs">
                  <Video className="h-3 w-3 mr-1" />
                  Chamada de vídeo via WhatsApp
                </Badge>
              </div>
            )}
            {hostName && (
              <p className="text-sm text-muted-foreground">
                Com: <strong>{hostName}</strong>
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-4">
              Você receberá um lembrete no WhatsApp antes da reunião.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-4 flex items-start justify-center pt-8">
      <Card className="max-w-lg w-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5 text-primary" />
            Agende sua Reunião de Onboarding
          </CardTitle>
          {hostName && (
            <p className="text-sm text-muted-foreground">
              Com: <strong>{hostName}</strong> • <Badge variant="outline" className="text-[10px]"><Video className="h-3 w-3 mr-1" /> WhatsApp</Badge>
            </p>
          )}
          {config && (
            <p className="text-xs text-muted-foreground">
              Duração: {config.meeting_duration_minutes} minutos
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Escolha o dia</Label>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))} disabled={weekOffset === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset(weekOffset + 1)} disabled={weekOffset >= 4}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {availableDates.map(date => {
                const isSelected = selectedDate && isSameDay(date, selectedDate);
                const isToday = isSameDay(date, new Date());
                return (
                  <button
                    key={date.toISOString()}
                    onClick={() => { setSelectedDate(date); setSelectedSlot(null); }}
                    className={`flex flex-col items-center p-2 rounded-lg border transition-all text-xs
                      ${isSelected ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border hover:border-primary/50 hover:bg-muted/50'}
                      ${isToday ? 'ring-1 ring-primary/30' : ''}`}
                  >
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {format(date, 'EEE', { locale: ptBR })}
                    </span>
                    <span className="text-sm font-semibold">{format(date, 'dd')}</span>
                    <span className="text-[10px] text-muted-foreground">{format(date, 'MMM', { locale: ptBR })}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time slots */}
          {selectedDate && (
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Horários disponíveis — {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}
              </Label>
              {timeSlots.filter(s => s.available).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum horário disponível neste dia. Tente outro dia.
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {timeSlots.map((slot, i) => {
                    const isSelected = selectedSlot && slot.start.getTime() === selectedSlot.start.getTime();
                    return (
                      <button
                        key={i}
                        disabled={!slot.available}
                        onClick={() => setSelectedSlot({ start: slot.start, end: slot.end })}
                        className={`p-2 rounded-lg border text-sm font-medium transition-all
                          ${!slot.available ? 'opacity-30 cursor-not-allowed bg-muted line-through' : ''}
                          ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/50'}
                        `}
                      >
                        {format(slot.start, 'HH:mm')}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Confirm */}
          {selectedSlot && (
            <div className="pt-2 space-y-3">
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 text-center">
                <p className="text-sm font-medium">
                  {format(selectedSlot.start, "EEEE, dd 'de' MMMM", { locale: ptBR })} às{' '}
                  <strong>{format(selectedSlot.start, 'HH:mm')}</strong> - {format(selectedSlot.end, 'HH:mm')}
                </p>
              </div>
              <Button onClick={handleBook} disabled={booking} className="w-full" size="lg">
                {booking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Confirmar Agendamento
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-destructive text-center">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

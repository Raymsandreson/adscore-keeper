import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGoogleIntegration } from '@/hooks/useGoogleIntegration';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Link,
  Loader2,
  User,
  CalendarPlus,
  MessageCircle,
  Phone,
  ExternalLink,
  Download,
} from 'lucide-react';

export function GoogleIntegrationPanel() {
  const { isConnected, loading, connecting, connect, saveContact, createCalendarEvent, importContacts } = useGoogleIntegration();

  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', instagram_username: '', notes: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [importing, setImporting] = useState(false);

  const [scheduleForm, setScheduleForm] = useState({
    action_type: 'whatsapp_message' as 'whatsapp_message' | 'call',
    contact_name: '',
    contact_phone: '',
    message_text: '',
    scheduled_at: '',
    notes: '',
  });
  const [scheduling, setScheduling] = useState(false);
  const [lastCalendarLink, setLastCalendarLink] = useState<string | null>(null);

  const handleSaveContact = async () => {
    if (!contactForm.name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setSavingContact(true);
    try {
      await saveContact(contactForm);
      toast.success('Contato salvo no Google Contacts!');
      setContactForm({ name: '', phone: '', email: '', instagram_username: '', notes: '' });
    } catch (e: any) {
      if (e.message === 'google_not_connected') {
        toast.error('Conecte sua conta Google primeiro');
      } else {
        toast.error('Erro ao salvar contato');
      }
    } finally {
      setSavingContact(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleForm.contact_name.trim() || !scheduleForm.scheduled_at) {
      toast.error('Contato e data/hora são obrigatórios');
      return;
    }
    setScheduling(true);
    try {
      const result = await createCalendarEvent(scheduleForm);
      toast.success('Evento criado no Google Calendar!');
      setLastCalendarLink(result.calendar_link);
      setScheduleForm({ action_type: 'whatsapp_message', contact_name: '', contact_phone: '', message_text: '', scheduled_at: '', notes: '' });
    } catch (e: any) {
      if (e.message === 'google_not_connected') {
        toast.error('Conecte sua conta Google primeiro');
      } else {
        toast.error('Erro ao criar evento');
      }
    } finally {
      setScheduling(false);
    }
  };

  const handleImportContacts = async () => {
    setImporting(true);
    try {
      const result = await importContacts();
      toast.success(`Importação concluída! ${result.imported} novos contatos, ${result.skipped} já existentes.`);
    } catch (e: any) {
      if (e.message === 'google_not_connected') {
        toast.error('Conecte sua conta Google primeiro');
      } else {
        toast.error('Erro ao importar contatos');
        console.error(e);
      }
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google Workspace
            {isConnected && (
              <Badge variant="outline" className="ml-auto border-primary text-primary gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Conectado
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        {!isConnected && (
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Conecte sua conta Google para salvar contatos e criar lembretes no Calendar.
            </p>
            <Button onClick={connect} disabled={connecting} className="gap-2">
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
              {connecting ? 'Conectando...' : 'Conectar Google'}
            </Button>
          </CardContent>
        )}
      </Card>

      {isConnected && (
        <>
          {/* Import Contacts */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Download className="h-4 w-4 text-primary" />
                Importar Contatos do Google
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Puxe todos os contatos salvos na sua conta Google para o CRM. Contatos duplicados (mesmo telefone ou e-mail) serão ignorados.
              </p>
              <Button onClick={handleImportContacts} disabled={importing} className="w-full gap-2">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {importing ? 'Importando contatos...' : 'Importar do Google Contacts'}
              </Button>
            </CardContent>
          </Card>

          {/* Save Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4 text-primary" />
                Salvar Contato no Google
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Nome *</Label>
                  <Input
                    value={contactForm.name}
                    onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Nome completo"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Telefone</Label>
                  <Input
                    value={contactForm.phone}
                    onChange={e => setContactForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="space-y-1">
                  <Label>E-mail</Label>
                  <Input
                    value={contactForm.email}
                    onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="email@exemplo.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Instagram</Label>
                  <Input
                    value={contactForm.instagram_username}
                    onChange={e => setContactForm(p => ({ ...p, instagram_username: e.target.value }))}
                    placeholder="@usuario"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Observações</Label>
                <Textarea
                  value={contactForm.notes}
                  onChange={e => setContactForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Notas sobre o contato..."
                  rows={2}
                />
              </div>
              <Button onClick={handleSaveContact} disabled={savingContact} className="w-full gap-2">
                {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                {savingContact ? 'Salvando...' : 'Salvar no Google Contacts'}
              </Button>
            </CardContent>
          </Card>

          {/* Schedule Action */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarPlus className="h-4 w-4 text-primary" />
                Agendar no Google Calendar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Tipo de ação</Label>
                <Select
                  value={scheduleForm.action_type}
                  onValueChange={v => setScheduleForm(p => ({ ...p, action_type: v as any }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp_message">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-primary" />
                        Enviar mensagem WhatsApp
                      </div>
                    </SelectItem>
                    <SelectItem value="call">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-primary" />
                        Fazer ligação
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Contato *</Label>
                  <Input
                    value={scheduleForm.contact_name}
                    onChange={e => setScheduleForm(p => ({ ...p, contact_name: e.target.value }))}
                    placeholder="Nome do contato"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Telefone</Label>
                  <Input
                    value={scheduleForm.contact_phone}
                    onChange={e => setScheduleForm(p => ({ ...p, contact_phone: e.target.value }))}
                    placeholder="(00) 00000-0000"
                  />
                </div>
              </div>

              {scheduleForm.action_type === 'whatsapp_message' && (
                <div className="space-y-1">
                  <Label>Mensagem</Label>
                  <Textarea
                    value={scheduleForm.message_text}
                    onChange={e => setScheduleForm(p => ({ ...p, message_text: e.target.value }))}
                    placeholder="Texto da mensagem a ser enviada..."
                    rows={2}
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label>Data e hora *</Label>
                <Input
                  type="datetime-local"
                  value={scheduleForm.scheduled_at}
                  onChange={e => setScheduleForm(p => ({ ...p, scheduled_at: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label>Observações</Label>
                <Textarea
                  value={scheduleForm.notes}
                  onChange={e => setScheduleForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Notas adicionais..."
                  rows={2}
                />
              </div>

              <Button onClick={handleSchedule} disabled={scheduling} className="w-full gap-2">
                {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                {scheduling ? 'Criando evento...' : 'Criar no Google Calendar'}
              </Button>

              {lastCalendarLink && (
                <Button variant="outline" size="sm" className="w-full gap-2" asChild>
                  <a href={lastCalendarLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Ver último evento criado
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

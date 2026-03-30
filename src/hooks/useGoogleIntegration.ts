import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export function useGoogleIntegration() {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const checkConnection = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await cloudFunctions.invoke('google-check-connection');
      if (!error && data) {
        setIsConnected(data.connected);
      }
    } catch (e) {
      console.error('Error checking Google connection:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const { data, error } = await cloudFunctions.invoke('google-auth-url');
      if (error || !data?.url) throw new Error('Não foi possível gerar URL de autenticação');

      const popup = window.open(data.url, 'google-oauth', 'width=600,height=700,scrollbars=yes');

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'google-oauth-success') {
          toast.success('Google conectado com sucesso!');
          setIsConnected(true);
          setConnecting(false);
          window.removeEventListener('message', handleMessage);
          popup?.close();
        } else if (event.data?.type === 'google-oauth-error') {
          toast.error('Erro ao conectar com Google');
          setConnecting(false);
          window.removeEventListener('message', handleMessage);
        }
      };

      window.addEventListener('message', handleMessage);

      // Fallback: poll if popup is closed
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          setConnecting(false);
          checkConnection();
        }
      }, 1000);
    } catch (e) {
      console.error('Error connecting Google:', e);
      toast.error('Erro ao conectar com Google');
      setConnecting(false);
    }
  }, [checkConnection]);

  const saveContact = useCallback(async (params: {
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
    instagram_username?: string;
  }) => {
    const { data, error } = await cloudFunctions.invoke('google-save-contact', { body: params });
    if (error || data?.error) throw new Error(data?.error || error?.message);
    return data;
  }, []);

  const createCalendarEvent = useCallback(async (params: {
    title?: string;
    description?: string;
    scheduled_at: string;
    action_type: 'whatsapp_message' | 'call';
    contact_name?: string;
    contact_phone?: string;
    contact_instagram?: string;
    message_text?: string;
    notes?: string;
  }) => {
    const { data, error } = await cloudFunctions.invoke('google-calendar-event', { body: params });
    if (error || data?.error) throw new Error(data?.error || error?.message);
    return data;
  }, []);

  const importContacts = useCallback(async () => {
    const { data, error } = await cloudFunctions.invoke('google-import-contacts');
    if (error || data?.error) throw new Error(data?.error || error?.message);
    return data as { total: number; imported: number; skipped: number };
  }, []);

  return { isConnected, loading, connecting, connect, saveContact, createCalendarEvent, importContacts, checkConnection };
}

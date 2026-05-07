// Reprocessa uma etapa de onboarding já concluída.
// Reseta o checkpoint para 'pending' (mantém payload), limpa result/error,
// e devolve o checkpoint_id pra UI chamar onboarding-checkpoint-execute em seguida.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { checkpoint_id } = (req.body || {}) as { checkpoint_id?: string };
    if (!checkpoint_id) return ok({ success: false, error: 'checkpoint_id required' });

    const { data: ckpt } = await ext
      .from('onboarding_checkpoints')
      .select('id, step, status, result')
      .eq('id', checkpoint_id)
      .maybeSingle();
    if (!ckpt) return ok({ success: false, error: 'checkpoint not found' });

    const { error: updErr } = await ext
      .from('onboarding_checkpoints')
      .update({
        status: 'pending',
        result: { ...(ckpt.result || {}), reprocessed_from: ckpt.status, reprocessed_at: new Date().toISOString() },
        error_message: null,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', checkpoint_id);
    if (updErr) return ok({ success: false, error: updErr.message });

    return ok({ success: true, checkpoint_id, step: ckpt.step });
  } catch (e: any) {
    return ok({ success: false, error: e?.message || String(e) });
  }
};

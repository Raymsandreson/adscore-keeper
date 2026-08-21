/**
 * Os avisos sonoros do app, num lugar só.
 *
 * Nenhum deles decide se deve tocar: quem chama consulta `isSoundEnabled()` em
 * `soundSettings.ts` antes. Assim o botão "Testar" das Configurações toca o som
 * mesmo com a opção desligada.
 */

type AudioCtor = typeof AudioContext;

function audioContext(): AudioContext | null {
  try {
    const Ctor: AudioCtor | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null; // navegador sem Web Audio ou áudio bloqueado antes de interação
  }
}

/**
 * Alarme longo e incômodo: 6 bipes alternando 660/990 Hz por ~2s. Usado pelos
 * avisos do cronômetro de atividades e pelo chamado da gestão.
 */
export function playAlarmSound() {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    ctx.resume().catch(() => {});
    const beep = (t: number, freq: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.5, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + 0.28);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    };
    [0, 0.35, 0.7, 1.05, 1.4, 1.75].forEach((t, i) => beep(t, i % 2 ? 660 : 990));
    setTimeout(() => { ctx.close().catch(() => {}); }, 2600);
  } catch { /* sem suporte de áudio */ }
}

/** Bip curto (880 Hz, 0,18s) — mensagem urgente com o painel do chat aberto. */
export function playUrgentBeep() {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch { /* silêncio se o navegador bloquear áudio */ }
}

/** Três bipes (880 Hz) — mensagem urgente chegando pelo toast global de notificação. */
export function playUrgentChime() {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    [0, 0.25, 0.5].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch { /* navegador pode bloquear áudio antes de interação do usuário */ }
}

/**
 * Preferências de som do app — uma chave por aviso sonoro.
 *
 * Todas nascem DESLIGADAS por decisão do usuário (19/08/2026): som que toca
 * sozinho vira ruído, e cada um desses avisos já aparece em toast, notificação
 * do sistema ou dialog. Quem quiser o apito liga em Configurações →
 * Notificações → Sons do sistema.
 *
 * Mora no localStorage porque é preferência de DISPOSITIVO, igual ao resto das
 * configurações de interface da casa (useCommentCardSettings, Web Push por
 * aparelho). Navegador novo começa do zero — ou seja, mudo.
 */

export const SOUND_KEYS = [
  'timerIdle',
  'timerStillWorking',
  'timerBreakOverdue',
  'timerEstimateOverdue',
  'chatUrgent',
  'managerAlert',
] as const;

export type SoundKey = (typeof SOUND_KEYS)[number];
export type SoundSettings = Record<SoundKey, boolean>;

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  timerIdle: false,
  timerStillWorking: false,
  timerBreakOverdue: false,
  timerEstimateOverdue: false,
  chatUrgent: false,
  managerAlert: false,
};

const STORAGE_KEY = 'sound-settings';

function isSoundKey(key: string): key is SoundKey {
  return (SOUND_KEYS as readonly string[]).includes(key);
}

/**
 * Lê direto do localStorage a cada chamada — sem cache. O custo é irrelevante
 * (só roda no instante em que um aviso ia apitar) e evita o clássico "desliguei
 * numa aba e a outra continuou tocando".
 */
export function readSoundSettings(): SoundSettings {
  const settings = { ...DEFAULT_SOUND_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return settings;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed || {})) {
      // Chave desconhecida ou valor que não é booleano não entra: preferência
      // corrompida cai no default, que é o silêncio.
      if (isSoundKey(key) && typeof value === 'boolean') settings[key] = value;
    }
  } catch {
    /* JSON inválido ou storage bloqueado: fica no default (mudo) */
  }
  return settings;
}

export function isSoundEnabled(key: SoundKey): boolean {
  return readSoundSettings()[key];
}

const listeners = new Set<(settings: SoundSettings) => void>();

export function setSoundEnabled(key: SoundKey, enabled: boolean): SoundSettings {
  const next = { ...readSoundSettings(), [key]: enabled };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage cheio ou modo privado: a sessão atual ainda respeita a escolha */
  }
  listeners.forEach((fn) => fn(next));
  return next;
}

/** Avisa a UI quando a preferência muda — nesta aba (listeners) e nas outras (evento storage). */
export function subscribeSoundSettings(fn: (settings: SoundSettings) => void): () => void {
  listeners.add(fn);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) fn(readSoundSettings());
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

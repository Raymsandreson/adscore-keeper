import { useCallback, useEffect, useState } from 'react';
import {
  readSoundSettings,
  setSoundEnabled,
  subscribeSoundSettings,
  type SoundKey,
  type SoundSettings,
} from '@/lib/soundSettings';

/** Estado reativo das preferências de som — para a tela de Configurações. */
export function useSoundSettings() {
  const [settings, setSettings] = useState<SoundSettings>(readSoundSettings);

  useEffect(() => subscribeSoundSettings(setSettings), []);

  const toggle = useCallback((key: SoundKey, enabled: boolean) => {
    setSettings(setSoundEnabled(key, enabled));
  }, []);

  return { settings, toggle };
}

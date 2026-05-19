// Força download do arquivo na mesma aba, evitando navegação.
// `download` HTML attribute é ignorado em URLs cross-origin -> precisamos baixar como blob.
import type { MouseEvent } from 'react';

export async function downloadFile(url: string, filename?: string): Promise<void> {
  const fallbackName = (() => {
    if (filename) return filename;
    try {
      return new URL(url).pathname.split('/').pop() || 'arquivo';
    } catch {
      return 'arquivo';
    }
  })();

  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fallbackName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  } catch (error) {
    console.warn('Download bloqueado pelo navegador/CORS, sem navegar para fora da página.', error);
  }
}

export function bindDownload(url: string, filename?: string) {
  return (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent?.stopImmediatePropagation?.();
    e.currentTarget.removeAttribute?.('href');
    void downloadFile(url, filename);
  };
}

/**
 * Cópia robusta pra área de transferência.
 *
 * O padrão antigo (`navigator.clipboard.writeText(...)` sem await) mostrava
 * "copiado!" mesmo quando a escrita era rejeitada — o que acontece em WebView
 * Android, PWA embutido, documento fora de foco ou permissão negada.
 * Aqui: tenta a API moderna; se falhar, cai pro execCommand legado (funciona
 * em WebViews antigas); retorna se copiou de verdade pra UI avisar certo.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // continua no fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length); // necessário no iOS
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

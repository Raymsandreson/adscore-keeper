import React from 'react';

/**
 * Renderiza texto no estilo WhatsApp:
 * *negrito*  _itálico_  ~tachado~  ```mono```
 * Mantém quebras de linha. Linkifica URLs simples.
 */
export function renderWhatsAppText(text: string): React.ReactNode {
  if (!text) return null;

  // primeiro: code blocks ```...``` (multi-line ok)
  const parts: React.ReactNode[] = [];
  const codeRe = /```([\s\S]+?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) parts.push(renderInline(text.slice(last, m.index), key++));
    parts.push(
      <code
        key={`c${key++}`}
        className="block whitespace-pre-wrap font-mono text-[11px] bg-black/5 dark:bg-white/10 rounded px-1.5 py-1 my-1"
      >
        {m[1]}
      </code>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(renderInline(text.slice(last), key++));
  return <>{parts}</>;
}

function renderInline(text: string, baseKey: number): React.ReactNode {
  // Tokeniza por padrões: *bold* _italic_ ~strike~ `mono` URL
  // Faz um match único por estrela/sublinha/til pra evitar ambiguidade
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`|https?:\/\/\S+)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(withBreaks(text.slice(last, m.index), `${baseKey}-${i++}`));
    const tok = m[0];
    const k = `${baseKey}-${i++}`;
    if (tok.startsWith('*')) out.push(<strong key={k}>{withBreaks(tok.slice(1, -1), k)}</strong>);
    else if (tok.startsWith('_')) out.push(<em key={k}>{withBreaks(tok.slice(1, -1), k)}</em>);
    else if (tok.startsWith('~')) out.push(<s key={k}>{withBreaks(tok.slice(1, -1), k)}</s>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="font-mono text-[11px] bg-black/5 dark:bg-white/10 rounded px-1">{tok.slice(1, -1)}</code>);
    else out.push(
      <a key={k} href={tok} target="_blank" rel="noreferrer" className="underline break-all">{tok}</a>
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(withBreaks(text.slice(last), `${baseKey}-${i++}`));
  return <>{out}</>;
}

function withBreaks(text: string, key: string): React.ReactNode {
  const lines = text.split('\n');
  return (
    <React.Fragment key={key}>
      {lines.map((ln, idx) => (
        <React.Fragment key={idx}>
          {ln}
          {idx < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </React.Fragment>
  );
}

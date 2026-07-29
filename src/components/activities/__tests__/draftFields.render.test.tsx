/**
 * Prova o fix contra o componente de verdade (RichTextEditor + SyncPlugin),
 * não contra uma réplica: o mesmo valor que o rascunho da IA coloca no state
 * é renderizado aqui. Texto puro tem que sumir (bug) e draftRichText tem que aparecer.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { draftRichText } from '../richTextFields';

const PLAIN = 'Luana questionou o andamento do caso 38 com a Oriz.';

describe('RichTextEditor com rascunho da IA', () => {
  it('texto puro não chega a aparecer no campo (bug original)', async () => {
    const { container } = render(<RichTextEditor value={PLAIN} onChange={() => {}} />);
    await new Promise((r) => setTimeout(r, 80));
    expect(container.textContent).not.toContain('caso 38');
  });

  it('depois de draftRichText o texto aparece no campo', async () => {
    const { container } = render(<RichTextEditor value={draftRichText(PLAIN)} onChange={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain('caso 38'));
    expect(container.textContent).toContain('Oriz');
  });
});

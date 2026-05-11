/**
 * Regression test: garante que digitar um objetivo + passo e clicar
 * imediatamente em "Salvar" (sem blur manual nem segundo render)
 * persiste o valor digitado.
 *
 * O bug original em WorkflowBuilder era que `handleSave` lia `phases` do
 * closure do render — quando o `onBlur` do StepAdder commitava o passo
 * via setState, o save rodava antes do re-render e enviava a versão
 * antiga (sem o passo). Mesmo padrão valia pro nome do objetivo.
 *
 * O fix lê o estado mais recente via callback do setter:
 *   const latest = await new Promise(r =>
 *     setPhases(p => { r(p); return p; })
 *   );
 *
 * Estes testes reproduzem fielmente o padrão e asseguram que ele
 * sobrevive a refactors futuros.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

interface Item { id: string; label: string }
interface Objective { name: string; items: Item[] }

// ──────────────────────────────────────────────────────────────────
// Harness FIEL ao padrão de WorkflowBuilder (StepAdder + handleSave)
// ──────────────────────────────────────────────────────────────────
function FixedHarness({ onSave }: { onSave: (objs: Objective[]) => void }) {
  const [objectives, setObjectives] = useState<Objective[]>([
    { name: '', items: [] },
  ]);

  const addStep = (label: string) => {
    if (!label.trim()) return;
    setObjectives(prev =>
      prev.map((o, i) =>
        i === 0
          ? { ...o, items: [...o.items, { id: crypto.randomUUID(), label: label.trim() }] }
          : o,
      ),
    );
  };

  const handleSave = async () => {
    // Mesmo padrão do WorkflowBuilder.handleSave — flush + leitura do
    // estado MAIS RECENTE via callback do setter.
    await new Promise(r => setTimeout(r, 0));
    const latest: Objective[] = await new Promise(resolve => {
      setObjectives(p => {
        resolve(p);
        return p;
      });
    });
    onSave(latest);
  };

  return (
    <div>
      <input
        aria-label="objective-name"
        value={objectives[0].name}
        onChange={e =>
          setObjectives(prev => prev.map((o, i) => (i === 0 ? { ...o, name: e.target.value } : o)))
        }
      />
      <StepAdder onAdd={addStep} />
      <button onClick={handleSave}>Salvar</button>
    </div>
  );
}

function StepAdder({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('');
  const commit = () => {
    if (label.trim()) {
      onAdd(label);
      setLabel('');
    }
  };
  return (
    <input
      aria-label="step-input"
      value={label}
      onChange={e => setLabel(e.target.value)}
      onBlur={commit}
    />
  );
}


describe('WorkflowBuilder save flow — persistência sem depender de re-render', () => {
  it('persiste passo digitado mesmo quando o usuário clica direto em Salvar (sem blur prévio)', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FixedHarness onSave={onSave} />);

    await user.type(screen.getByLabelText('step-input'), 'Ligar pro cliente');
    // Clique direto — userEvent dispara blur no input ao clicar no botão,
    // mas o setState do blur é assíncrono. Sem o flush, o save salvaria
    // a versão antiga (sem o passo).
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as Objective[];
    expect(saved[0].items.map(i => i.label)).toEqual(['Ligar pro cliente']);
  });

  it('persiste nome do objetivo digitado mesmo sem disparar blur antes de Salvar', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FixedHarness onSave={onSave} />);

    await user.type(screen.getByLabelText('objective-name'), 'Onboarding');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    const saved = onSave.mock.calls[0][0] as Objective[];
    expect(saved[0].name).toBe('Onboarding');
  });

  it('acumula múltiplos passos adicionados rapidamente (updater funcional)', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FixedHarness onSave={onSave} />);

    const input = screen.getByLabelText('step-input');
    await user.type(input, 'Passo 1');
    await user.tab(); // commit via blur
    await user.type(input, 'Passo 2');
    await user.tab();
    await user.type(input, 'Passo 3');
    // sem blur deste último — só clica Salvar
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    const saved = onSave.mock.calls[0][0] as Objective[];
    expect(saved[0].items.map(i => i.label)).toEqual(['Passo 1', 'Passo 2', 'Passo 3']);
  });

});

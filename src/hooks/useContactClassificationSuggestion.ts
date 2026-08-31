/**
 * Preenche sozinho o "Relacionamento Conosco" de quem está em "Sem status".
 *
 * Duas camadas, nessa ordem:
 *  1. o nome — "Alex motorista parceiro Ibirarema/SP" já diz tudo. Instantâneo,
 *     sem custo, sem chance de alucinar (`detectClassificationFromName`).
 *  2. a IA — para o que exige leitura da observação/profissão/casos ligados
 *     (edge function `suggest-contact-classification`).
 *
 * Age uma vez por contato e só quando o campo está VAZIO: nunca discute com o
 * que o usuário (ou outro assessor) já escolheu. E preenche o formulário sem
 * salvar — quem confirma é o botão Salvar, igual à cidade detectada pelo nome.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { detectClassificationFromName } from '@/lib/detectClassificationFromName';

/** Espera antes de chamar a IA: deixa o contexto assíncrono (casos ligados)
 *  chegar e não gasta chamada em ficha que a pessoa só abriu de passagem. */
const ESPERA_IA_MS = 700;

export interface ClassificationSuggestion {
  slugs: string[];
  /** de onde veio: o nome do contato ou a leitura da IA. */
  source: 'nome' | 'ia';
  /** trecho que sustenta a escolha, para a pessoa conferir sem abrir nada. */
  reason: string;
}

interface Params {
  /** só roda com a ficha aberta. */
  enabled: boolean;
  contactId?: string | null;
  /** nome salvo do contato (não o do formulário, que ainda pode ser do anterior). */
  name: string;
  /** o que já está gravado no campo — com qualquer coisa aqui, o hook não age. */
  current: string[];
  /** status que existem neste workspace. */
  available: { name: string; label: string }[];
  context?: {
    notes?: string | null;
    profession?: string | null;
    city?: string | null;
    state?: string | null;
    leads?: string[];
  };
  /** aplica no formulário (sem salvar). */
  onApply: (slugs: string[]) => void;
}

export function useContactClassificationSuggestion({
  enabled,
  contactId,
  name,
  current,
  available,
  context,
  onApply,
}: Params) {
  const [suggestion, setSuggestion] = useState<ClassificationSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  /** contato já resolvido — não repete a cada re-render nem a cada reabrir. */
  const doneRef = useRef<string | null>(null);

  // Callback e contexto entram por ref: só o contato (e o campo estar vazio)
  // decide quando rodar. Sem isso, cada tecla digitada dispararia a IA de novo.
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const contextRef = useRef(context);
  contextRef.current = context;
  const availableRef = useRef(available);
  availableRef.current = available;
  const nameRef = useRef(name);
  nameRef.current = name;

  const dismiss = useCallback(() => setSuggestion(null), []);

  useEffect(() => {
    if (!enabled || !contactId) return;
    if (current.length > 0) return;
    if (doneRef.current === contactId) return;
    const nome = (nameRef.current || '').trim();
    if (nome.length < 3) return;
    const options = availableRef.current;
    if (!options || options.length === 0) return; // lista de status ainda carregando

    doneRef.current = contactId;
    const rotulo = (slug: string) => options.find((o) => o.name === slug)?.label || slug;

    // 1) O nome entrega o papel — resolve na hora, sem IA.
    const doNome = detectClassificationFromName(nome, options.map((o) => o.name));
    if (doNome.length > 0) {
      applyRef.current(doNome.map((h) => h.slug));
      setSuggestion({
        slugs: doNome.map((h) => h.slug),
        source: 'nome',
        reason: `o nome traz "${doNome.map((h) => h.matched).join('", "')}"`,
      });
      return;
    }

    // 2) O nome não entrega — a IA lê o resto da ficha.
    let cancelled = false;
    setSuggesting(true);

    const perguntarIA = async () => {
      try {
        const ctx = contextRef.current || {};
        const { data, error } = await cloudFunctions.invoke('suggest-contact-classification', {
          body: {
            contact: {
              name: nome,
              notes: ctx.notes || undefined,
              profession: ctx.profession || undefined,
              city: ctx.city || undefined,
              state: ctx.state || undefined,
              leads: ctx.leads?.length ? ctx.leads : undefined,
            },
            allowed: options.map((o) => ({ name: o.name, label: o.label })),
          },
        });
        if (cancelled || error) return;

        const slugs: string[] = Array.isArray(data?.suggested) ? data.suggested : [];
        // Confiança baixa não preenche nada: campo vazio é melhor que campo errado.
        if (slugs.length === 0 || data?.confidence === 'baixa') return;

        applyRef.current(slugs);
        setSuggestion({
          slugs,
          source: 'ia',
          reason: data?.reason || `identificado como ${slugs.map(rotulo).join(', ')}`,
        });
      } catch {
        /* silencioso: sem sugestão, a tela segue exatamente como estava */
      } finally {
        if (!cancelled) setSuggesting(false);
      }
    };

    const timer = setTimeout(() => { perguntarIA(); }, ESPERA_IA_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // `available.length` entra porque a lista de status chega do banco depois do
    // primeiro render — sem ela, a ficha aberta nesse intervalo nunca seria lida.
  }, [enabled, contactId, current.length, available.length]);

  // Trocou de contato: a nota da sugestão anterior some junto.
  useEffect(() => { setSuggestion(null); }, [contactId]);

  return { suggestion, suggesting, dismiss };
}

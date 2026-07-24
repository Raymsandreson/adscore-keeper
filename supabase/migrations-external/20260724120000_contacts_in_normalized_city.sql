-- Match de contatos por cidade normalizada (Externo).
-- contacts.city vem gravado em formatos inconsistentes (ex: "Itapecuru-Mirim",
-- "Itapecuru mirim") enquanto o lead usa o nome IBGE ("Itapecuru Mirim").
-- Esta função normaliza os dois lados (acento/hífen/espaço/caixa) para o popup
-- de "contatos nossos na mesma cidade" no formulário de lead.
CREATE OR REPLACE FUNCTION public.contacts_in_normalized_city(p_city text, p_state text)
RETURNS SETOF public.contacts
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.contacts
  WHERE deleted_at IS NULL
    AND whatsapp_group_id IS NULL
    AND state = p_state
    AND city IS NOT NULL
    AND regexp_replace(lower(translate(city,
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]', '', 'g')
      = regexp_replace(lower(translate(p_city,
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]', '', 'g')
$$;

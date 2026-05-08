CREATE OR REPLACE FUNCTION public.generate_case_number(p_nucleus_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix TEXT;
  v_next_seq INTEGER;
  v_case_number TEXT;
BEGIN
  IF p_nucleus_id IS NULL THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(case_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_next_seq
    FROM legal_cases
    WHERE nucleus_id IS NULL;
    v_case_number := 'CASO-' || v_next_seq::TEXT;
  ELSE
    SELECT prefix INTO v_prefix FROM specialized_nuclei WHERE id = p_nucleus_id;
    UPDATE specialized_nuclei
    SET sequence_counter = sequence_counter + 1, updated_at = now()
    WHERE id = p_nucleus_id
    RETURNING sequence_counter INTO v_next_seq;
    v_case_number := v_prefix || '-' || v_next_seq::TEXT;
  END IF;
  RETURN v_case_number;
END;
$function$;
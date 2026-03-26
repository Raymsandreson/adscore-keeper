
ALTER TABLE public.legal_cases 
ADD COLUMN IF NOT EXISTS benefit_type text,
ADD COLUMN IF NOT EXISTS acolhedor text;

COMMENT ON COLUMN public.legal_cases.benefit_type IS 'Tipo de benefício: BPC, Auxílio Doença, Pensão por Morte, Salário Maternidade, Auxílio Rural, etc.';
COMMENT ON COLUMN public.legal_cases.acolhedor IS 'Nome do acolhedor/responsável pela captação do caso';

-- Add product_service_id to kanban_boards
ALTER TABLE public.kanban_boards 
ADD COLUMN IF NOT EXISTS product_service_id uuid REFERENCES public.products_services(id) ON DELETE SET NULL;

-- Add product_service_id to leads
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS product_service_id uuid REFERENCES public.products_services(id) ON DELETE SET NULL;

-- Create trigger to auto-fill product_service_id on lead when board_id is set
CREATE OR REPLACE FUNCTION public.auto_fill_lead_product_from_board()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When board_id changes and lead doesn't have a product set, inherit from board
  IF NEW.board_id IS NOT NULL AND (NEW.product_service_id IS NULL OR OLD.board_id IS DISTINCT FROM NEW.board_id) THEN
    SELECT product_service_id INTO NEW.product_service_id
    FROM kanban_boards
    WHERE id = NEW.board_id::uuid AND product_service_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_fill_lead_product
  BEFORE INSERT OR UPDATE OF board_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_fill_lead_product_from_board();
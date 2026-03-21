UPDATE public.wjia_collection_sessions 
SET 
  status = 'cancelled',
  updated_at = now()
WHERE id = '6f0e2677-62d6-4f19-a45d-e6728adbf946';
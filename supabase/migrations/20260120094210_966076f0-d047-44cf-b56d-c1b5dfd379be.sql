-- Change prospect_classification from text to text[] to support multiple classifications
ALTER TABLE public.instagram_comments 
ALTER COLUMN prospect_classification TYPE text[] 
USING CASE 
  WHEN prospect_classification IS NULL THEN NULL 
  ELSE ARRAY[prospect_classification] 
END;

-- Update the comment
COMMENT ON COLUMN public.instagram_comments.prospect_classification IS 'Multiple classifications: client, closer, sdr, team, prospect, other';
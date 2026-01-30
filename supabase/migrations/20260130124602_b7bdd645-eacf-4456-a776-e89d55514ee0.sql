-- Update RLS policy to allow updating expense_categories (including system ones)
-- System categories should be editable for limit settings

DROP POLICY IF EXISTS "Anyone can update expense_categories" ON expense_categories;

CREATE POLICY "Anyone can update expense_categories"
ON expense_categories
FOR UPDATE
USING (true);

-- Also, let's set existing categories to non-system so they can be fully edited
-- Keep is_system only for truly immutable system categories
UPDATE expense_categories 
SET is_system = false 
WHERE is_system = true;
-- Update ambassador_referrals FK to point to contacts instead of ambassadors
ALTER TABLE ambassador_referrals DROP CONSTRAINT ambassador_referrals_ambassador_id_fkey;
ALTER TABLE ambassador_referrals ADD CONSTRAINT ambassador_referrals_ambassador_id_fkey 
  FOREIGN KEY (ambassador_id) REFERENCES contacts(id) ON DELETE CASCADE;
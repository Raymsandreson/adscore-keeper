-- Remove duplicates keeping the newest entry per cbo_code
DELETE FROM cbo_professions a
USING cbo_professions b
WHERE a.id < b.id AND a.cbo_code = b.cbo_code;

-- Add unique constraint on cbo_code
ALTER TABLE cbo_professions ADD CONSTRAINT cbo_professions_cbo_code_unique UNIQUE (cbo_code);

-- Add GIN trigram indexes for fast ilike searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_cbo_professions_title_trgm ON cbo_professions USING gin (title gin_trgm_ops);
CREATE INDEX idx_cbo_professions_family_title_trgm ON cbo_professions USING gin (family_title gin_trgm_ops);
ALTER TABLE member_assistant_config ADD COLUMN instance_id uuid REFERENCES whatsapp_instances(id) ON DELETE SET NULL;

UPDATE member_assistant_config SET instance_id = (SELECT id FROM whatsapp_instances WHERE instance_name = member_assistant_config.instance_name LIMIT 1) WHERE instance_name IS NOT NULL;
-- Productgenerator lessons sync
-- Generated: 2026-05-19

INSERT INTO memory_chunks (id, project_id, title, content, summary, tags, source_type, importance, confidence, trust_score)
VALUES (
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'productgenerator',
  'Test entry',
  'Test content for productgenerator project',
  'Test summary',
  ARRAY['test', 'productgenerator'],
  'lesson',
  5,
  0.8,
  0.7
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  updated_at = NOW();

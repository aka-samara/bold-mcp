-- Error kind for the weekly "top failures" report.
ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS error_kind text;

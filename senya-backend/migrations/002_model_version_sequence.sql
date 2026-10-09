-- Version numbers come from a sequence so a number is never handed out twice, even after the newest version is
-- deleted. Reusing one would break phones: a phone holding the old "v3" would think a new "v3" is already installed.
CREATE SEQUENCE IF NOT EXISTS model_version_seq;

-- Next number = 1 + the larger of (highest existing version, last number the sequence handed out).
-- Runs on every start and only ever moves the sequence forward; covers databases from before this file.
SELECT setval(
    'model_version_seq',
    GREATEST(
        (SELECT COALESCE(MAX(version), 0) FROM model_versions),
        (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM model_version_seq)
    ) + 1,
    false
);

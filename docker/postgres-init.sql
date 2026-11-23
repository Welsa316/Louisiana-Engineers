-- Runs once when the local Postgres volume is first created.
-- POSTGRES_DB already created "mest"; the test harness creates its own
-- "mest_test_<WORKTREE_ID>" databases from this maintenance database.
CREATE DATABASE mest_test;

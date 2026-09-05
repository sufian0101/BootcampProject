-- ============================================================================
-- schema.sql
-- Database structure for the LaunchPath bootcamp app.
-- This file is run once, automatically, the first time the app starts
-- (see database.py -> init_db()). Re-running it is safe: every table
-- uses "IF NOT EXISTS" so it never wipes existing data.
-- ============================================================================

-- Every person who can log in: both learners and admins live in this
-- single table, distinguished by the "role" column. Keeping one table
-- (instead of separate "learners" / "admins" tables) keeps auth logic
-- in one place and avoids duplicate email-uniqueness rules.
CREATE TABLE IF NOT EXISTS users (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT    NOT NULL,
    email              TEXT    NOT NULL UNIQUE,
    password_hash      TEXT    NOT NULL,           -- never store plain-text passwords
    role               TEXT    NOT NULL CHECK (role IN ('learner', 'admin')),
    track              TEXT,                        -- NULL for admins
    cohort_id          INTEGER REFERENCES cohorts(id),
    completed_modules  INTEGER NOT NULL DEFAULT 0,  -- 0-8, how far along the skill path
    placed             INTEGER NOT NULL DEFAULT 0,  -- 1 if an admin has manually marked them "placed"
    created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A cohort is one intake of one track (e.g. "Cohort 14" of "Web Development").
-- Learners are assigned to a cohort when they sign up.
CREATE TABLE IF NOT EXISTS cohorts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    track      TEXT NOT NULL,
    start_date TEXT NOT NULL
);

-- The eight milestones every learner walks through, in order, regardless
-- of track. "position" is 0-indexed and drives the skill-path visual on
-- the frontend. A learner's "completed_modules" count is simply how many
-- of these (in order, starting at position 0) they have finished.
CREATE TABLE IF NOT EXISTS modules (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    position INTEGER NOT NULL UNIQUE,
    title    TEXT    NOT NULL,
    blurb    TEXT    NOT NULL
);

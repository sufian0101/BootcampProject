# ============================================================================
# database.py
#
# Everything related to talking to the SQLite database lives here, so
# app.py can stay focused on routes/business logic instead of SQL.
#
# SQLite is used because it needs no separate server to install or run --
# the whole database is one file (instance/launchpath.db). For a bigger
# production deployment you would swap this file's connection logic for
# something like PostgreSQL, but every route in app.py would stay the same
# because they all go through the helper functions defined here.
# ============================================================================

import sqlite3
from pathlib import Path
from werkzeug.security import generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "instance" / "launchpath.db"
SCHEMA_PATH = BASE_DIR / "schema.sql"

# The eight fixed milestones every learner walks through. Seeded into the
# `modules` table on first run. Keeping the source-of-truth text here (not
# hardcoded in the frontend) means the API is the single place that knows
# the curriculum, which is what "the backend owns the data" means in practice.
DEFAULT_MODULES = [
    ("Orientation & Digital Basics", "Laptop setup, email, and cohort norms."),
    ("Core Track Foundations", "Track-specific fundamentals and first exercises."),
    ("Hands-on Skill Building", "Guided practice with mentor feedback."),
    ("Team Project Sprint", "Ship a group project in one week."),
    ("Mock Interviews", "Practice technical and behavioral rounds."),
    ("Portfolio Review", "1:1 mentor review of your portfolio."),
    ("Employer Meetups", "Meet hiring partners at demo day."),
    ("Graduation & Placement", "Graduate and start placement support."),
]

# The four tracks a learner can enrol in. "code" is the short course-code
# style label used throughout the UI (badges, roster table, etc).
TRACKS = [
    {"name": "Web Development", "code": "WD-101",
     "blurb": "HTML, CSS, JavaScript and Git, ending with a deployed personal project."},
    {"name": "Digital Marketing", "code": "DM-101",
     "blurb": "SEO, social campaigns, and analytics for small business clients."},
    {"name": "Data & Analytics", "code": "DA-101",
     "blurb": "Spreadsheets, SQL basics, and dashboards using real public datasets."},
    {"name": "IT Support & Networking", "code": "IT-101",
     "blurb": "Troubleshooting, ticketing systems, and entry-level networking."},
]


def get_connection():
    """
    Open a new connection to the SQLite database file.

    `row_factory = sqlite3.Row` lets us access columns by name
    (row["email"]) instead of only by index (row[1]), which makes the
    route code in app.py much easier to read.

    Foreign keys are off by default in SQLite, so we turn them on for
    every connection -- this makes cohort_id actually enforce that the
    referenced cohort exists.
    """
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    """
    Create the database file and tables if they don't exist yet, then
    make sure the fixed reference data (modules, a couple of starter
    cohorts, and demo accounts) is present.

    Safe to call every time the app starts -- it never deletes data.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    connection = get_connection()
    with connection:
        # Run the table-creation statements from schema.sql
        connection.executescript(SCHEMA_PATH.read_text())

        _seed_modules(connection)
        _seed_cohorts_and_demo_accounts(connection)
        connection.execute(
            "UPDATE users SET email = ? WHERE email = ? AND role = 'admin'",
            ("admin@skillsdeveloper.org", "admin@launchpath.org"),
        )

    connection.close()


def _seed_modules(connection):
    """Insert the 8 fixed milestones, but only if the table is empty."""
    existing = connection.execute("SELECT COUNT(*) AS n FROM modules").fetchone()["n"]
    if existing > 0:
        return

    for position, (title, blurb) in enumerate(DEFAULT_MODULES):
        connection.execute(
            "INSERT INTO modules (position, title, blurb) VALUES (?, ?, ?)",
            (position, title, blurb),
        )


def _seed_cohorts_and_demo_accounts(connection):
    """
    Populate a few starter cohorts and demo login accounts so the app is
    immediately explorable after `python app.py`, without an empty,
    confusing dashboard. Only runs once (checks if any user already exists).
    """
    existing_users = connection.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    if existing_users > 0:
        return

    cohorts = [
        ("Cohort 14", "Web Development", "Aug 2026"),
        ("Cohort 14", "Digital Marketing", "Aug 2026"),
        ("Cohort 13", "Data & Analytics", "Jun 2026"),
        ("Cohort 13", "IT Support & Networking", "Jun 2026"),
    ]
    cohort_ids = {}
    for name, track, start_date in cohorts:
        cursor = connection.execute(
            "INSERT INTO cohorts (name, track, start_date) VALUES (?, ?, ?)",
            (name, track, start_date),
        )
        cohort_ids[track] = cursor.lastrowid

    # One admin account and a handful of learners at different stages of
    # the program, so both dashboards have something meaningful to show.
    demo_admin = {
        "name": "Program Admin", "email": "admin@skillsdeveloper.org",
        "password": "admin123", "role": "admin", "track": None,
        "cohort_id": None, "completed_modules": 0,
    }
    demo_learners = [
        {"name": "Amara Chen", "email": "amara@example.com", "password": "demo1234",
         "track": "Web Development", "completed_modules": 3},
        {"name": "Devon Ruiz", "email": "devon@example.com", "password": "demo1234",
         "track": "Web Development", "completed_modules": 8},
        {"name": "Priya Nair", "email": "priya@example.com", "password": "demo1234",
         "track": "Digital Marketing", "completed_modules": 5},
        {"name": "Kwame Boateng", "email": "kwame@example.com", "password": "demo1234",
         "track": "Data & Analytics", "completed_modules": 7},
        {"name": "Lena Kowalski", "email": "lena@example.com", "password": "demo1234",
         "track": "IT Support & Networking", "completed_modules": 2},
        {"name": "Tariq Osei", "email": "tariq@example.com", "password": "demo1234",
         "track": "Web Development", "completed_modules": 1},
        {"name": "Sofia Mendes", "email": "sofia@example.com", "password": "demo1234",
         "track": "Digital Marketing", "completed_modules": 8},
        {"name": "Noah Whitfield", "email": "noah@example.com", "password": "demo1234",
         "track": "Data & Analytics", "completed_modules": 4},
    ]

    connection.execute(
        "INSERT INTO users (name, email, password_hash, role, track, cohort_id, completed_modules) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (demo_admin["name"], demo_admin["email"], generate_password_hash(demo_admin["password"]),
         demo_admin["role"], demo_admin["track"], demo_admin["cohort_id"], demo_admin["completed_modules"]),
    )

    for learner in demo_learners:
        connection.execute(
            "INSERT INTO users (name, email, password_hash, role, track, cohort_id, completed_modules) "
            "VALUES (?, ?, ?, 'learner', ?, ?, ?)",
            (learner["name"], learner["email"], generate_password_hash(learner["password"]),
             learner["track"], cohort_ids[learner["track"]], learner["completed_modules"]),
        )

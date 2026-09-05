# LaunchPath — Digital Skills Bootcamp Platform

A full-stack web app for a tuition-free digital skills bootcamp for
unemployed youth, with two real, working portals:

- **Learner portal** — apply/sign up, track progress along an 8-stop
  "skill path," see a job-readiness score, upcoming sessions, and resources.
- **Admin portal** — program KPIs, enrollment-by-track chart, cohort
  management, and a learner roster with placement tracking.

Unlike a front-end-only prototype, this version has a real backend: a
Flask REST API backed by a SQLite database, with hashed passwords and
session-based login. Data you create (signups, completed modules, new
cohorts, placements) is saved to disk and is still there after a restart.

---

## Project structure

```
launchpath_app/
├── app.py               # Flask app: every API route lives here
├── database.py           # DB connection, table creation, demo data seeding
├── schema.sql             # Table definitions (users, cohorts, modules)
├── requirements.txt
├── templates/
│   └── index.html         # Single HTML shell — the whole UI is injected into it
├── static/
│   ├── styles.css         # All visual design
│   └── app.js              # All frontend logic (calls the API, renders the UI)
└── instance/
    └── launchpath.db      # Created automatically on first run — not committed to git
```

## How to run it

```bash
# 1. Create and activate a virtual environment (recommended)
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install the one dependency
pip install -r requirements.txt

# 3. Start the app
python app.py

# 4. Open it in your browser
#    http://127.0.0.1:5000
```

The database and demo data are created automatically the first time you
run `python app.py` — there's no separate setup step.

## Demo accounts

| Role    | Email                 | Password   |
|---------|------------------------|------------|
| Admin   | admin@SkillDeveloper.org   | admin123   |
| Learner | amara@example.com      | demo1234   |

You can also sign up as a brand-new learner from the landing page — new
signups are written straight into the database and immediately show up
in the admin roster.

## How the pieces fit together

- **Frontend → Backend**: `static/app.js` never touches a database
  directly. Every action (signing in, completing a module, adding a
  cohort) sends a `fetch()` request to a JSON endpoint in `app.py`.
- **Backend → Database**: `app.py` never writes raw SQL inline for
  connection setup — it calls `database.get_connection()`, which returns
  a SQLite connection pointed at `instance/launchpath.db`.
- **Auth**: passwords are hashed with Werkzeug's `generate_password_hash`
  / `check_password_hash` (never stored or compared in plain text).
  Logging in sets a signed session cookie; routes that need a login use
  the `@login_required` decorator, and admin-only routes add
  `@admin_required` on top.

## Extending this

A few things are intentionally simple, called out here so they're easy
to pick up later:

- **`app.secret_key`** in `app.py` is a placeholder. Before deploying
  anywhere real, set it from an environment variable
  (`os.environ["SECRET_KEY"]`) so it isn't sitting in source control.
- **SQLite** is great for development and small deployments. For a
  production app with concurrent writers, swap `database.py`'s
  connection logic for PostgreSQL (e.g. via `psycopg`) — every route in
  `app.py` calls the same `get_connection()` / `execute()` pattern, so
  the rest of the code barely changes.
- **The 8 milestones** (`modules` table) are shared across all tracks by
  design — there's no admin UI to edit them yet, but the table is there
  if you want to add one.
- **CSRF protection**: the forms here use JSON `fetch()` POSTs rather
  than classic HTML form submissions, which sidesteps the most common
  CSRF vector, but a production deployment should still add a CSRF
  token (e.g. via `flask-wtf`) on state-changing routes.

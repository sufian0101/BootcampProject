# ============================================================================
# app.py
#
# LaunchPath -- a digital skills bootcamp platform for unemployed youth.
#
# This is the whole backend: a Flask app that serves the frontend page and
# exposes a small JSON REST API under /api/*. Authentication uses signed
# session cookies (Flask's built-in `session`), and passwords are hashed
# with werkzeug's password-hashing helpers -- nothing is ever stored or
# sent back in plain text.
#
# HOW TO RUN THIS APP
#   1. python -m venv venv && source venv/bin/activate   (Windows: venv\Scripts\activate)
#   2. pip install -r requirements.txt
#   3. python app.py
#   4. open http://127.0.0.1:5000 in your browser
#
# Demo accounts (also shown on the login screen):
#   Admin:   admin@launchpath.org   / admin123
#   Learner: amara@example.com      / demo1234
# ============================================================================

from functools import wraps

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import database

app = Flask(__name__)

# The secret key signs the session cookie so users can't forge or tamper
# with it. In a real deployment this MUST come from an environment
# variable / secrets manager, not be hardcoded -- see README.md.
app.secret_key = "dev-secret-key-change-this-before-deploying"

# Create the database (and seed demo data) the first time the app starts.
database.init_db()


# ----------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------

def json_error(message, status_code=400):
    """Return a consistent {"error": "..."} JSON body with an HTTP status code."""
    return jsonify({"error": message}), status_code


def current_user_row(connection):
    """
    Look up the full database row for whoever is logged in (via the
    user_id stored in their session cookie). Returns None if nobody is
    logged in, or if the session refers to a user that no longer exists.
    """
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view_function):
    """Route decorator: reject the request with 401 if nobody is logged in."""
    @wraps(view_function)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return json_error("You need to sign in first.", 401)
        return view_function(*args, **kwargs)
    return wrapped


def admin_required(view_function):
    """Route decorator: reject the request with 403 unless the user is an admin."""
    @wraps(view_function)
    def wrapped(*args, **kwargs):
        if session.get("role") != "admin":
            return json_error("Admin access required.", 403)
        return view_function(*args, **kwargs)
    return wrapped


def serialize_user(row, connection):
    """Turn a `users` database row into the JSON shape the frontend expects."""
    cohort_name = None
    if row["cohort_id"] is not None:
        cohort = connection.execute(
            "SELECT name FROM cohorts WHERE id = ?", (row["cohort_id"],)
        ).fetchone()
        cohort_name = cohort["name"] if cohort else None

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "track": row["track"],
        "cohort": cohort_name,
        "completedModules": row["completed_modules"],
        "placed": bool(row["placed"]),
    }


# ----------------------------------------------------------------------------
# Page route -- serves the single-page frontend. All navigation between
# "landing / auth / dashboard" happens client-side in static/app.js; the
# server's job is just the API below.
# ----------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ----------------------------------------------------------------------------
# Auth API
# ----------------------------------------------------------------------------

@app.route("/api/auth/signup", methods=["POST"])
def signup():
    """
    Create a new learner account and log them in immediately.
    Admin accounts are intentionally NOT self-serve signup -- they're
    created directly in the database (see database.py) the way a real
    program would provision staff accounts.
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    track = data.get("track") or ""

    if not name or not email or not password:
        return json_error("Name, email, and password are all required.")
    if "@" not in email or "." not in email:
        return json_error("That doesn't look like a valid email address.")
    if len(password) < 6:
        return json_error("Password must be at least 6 characters.")

    valid_tracks = [t["name"] for t in database.TRACKS]
    if track not in valid_tracks:
        return json_error("Please choose a valid track.")

    connection = database.get_connection()
    try:
        already_exists = connection.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()
        if already_exists:
            return json_error("An account with that email already exists.", 409)

        # Enrol the new learner into the most recent cohort for their track
        # (falls back to creating one if none exists yet for that track).
        cohort = connection.execute(
            "SELECT id FROM cohorts WHERE track = ? ORDER BY id DESC LIMIT 1", (track,)
        ).fetchone()
        if cohort is None:
            cursor = connection.execute(
                "INSERT INTO cohorts (name, track, start_date) VALUES (?, ?, ?)",
                ("Cohort 15", track, "Rolling admission"),
            )
            cohort_id = cursor.lastrowid
            connection.commit()
        else:
            cohort_id = cohort["id"]

        password_hash = generate_password_hash(password)
        cursor = connection.execute(
            "INSERT INTO users (name, email, password_hash, role, track, cohort_id, completed_modules) "
            "VALUES (?, ?, ?, 'learner', ?, ?, 0)",
            (name, email, password_hash, track, cohort_id),
        )
        connection.commit()

        user_row = connection.execute(
            "SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()

        session["user_id"] = user_row["id"]
        session["role"] = "learner"

        return jsonify({"user": serialize_user(user_row, connection)}), 201
    finally:
        connection.close()


@app.route("/api/auth/login", methods=["POST"])
def login():
    """Verify email + password and, if they match, start a session."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    expected_role = data.get("role")  # "learner" or "admin" -- which tab the user picked

    if not email or not password:
        return json_error("Email and password are required.")

    connection = database.get_connection()
    try:
        user_row = connection.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()

        if user_row is None or not check_password_hash(user_row["password_hash"], password):
            return json_error("Incorrect email or password.", 401)

        if expected_role and user_row["role"] != expected_role:
            return json_error(
                f"This account is a {user_row['role']} account -- try the {user_row['role']} tab.", 401
            )

        session["user_id"] = user_row["id"]
        session["role"] = user_row["role"]

        return jsonify({"user": serialize_user(user_row, connection)})
    finally:
        connection.close()


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"success": True})


@app.route("/api/auth/me")
def me():
    """
    Called once when the page loads to check "is someone already logged
    in?" (via the session cookie) so a page refresh doesn't kick the user
    back to the landing page.
    """
    connection = database.get_connection()
    try:
        user_row = current_user_row(connection)
        if user_row is None:
            return jsonify({"user": None})
        return jsonify({"user": serialize_user(user_row, connection)})
    finally:
        connection.close()


# ----------------------------------------------------------------------------
# Shared reference data -- available whether or not you're logged in, since
# the marketing page displays tracks and the roadmap too.
# ----------------------------------------------------------------------------

@app.route("/api/tracks")
def get_tracks():
    return jsonify({"tracks": database.TRACKS})


@app.route("/api/roadmap")
def get_roadmap():
    connection = database.get_connection()
    try:
        rows = connection.execute(
            "SELECT position, title, blurb FROM modules ORDER BY position"
        ).fetchall()
        return jsonify({"roadmap": [dict(row) for row in rows]})
    finally:
        connection.close()


# ----------------------------------------------------------------------------
# Learner API
# ----------------------------------------------------------------------------

@app.route("/api/learner/dashboard")
@login_required
def learner_dashboard():
    """Everything the learner dashboard needs in one call: profile + roadmap."""
    if session.get("role") != "learner":
        return json_error("This endpoint is for learner accounts.", 403)

    connection = database.get_connection()
    try:
        user_row = current_user_row(connection)
        roadmap = connection.execute(
            "SELECT position, title, blurb FROM modules ORDER BY position"
        ).fetchall()
        return jsonify({
            "user": serialize_user(user_row, connection),
            "roadmap": [dict(row) for row in roadmap],
        })
    finally:
        connection.close()


@app.route("/api/learner/complete-module", methods=["POST"])
@login_required
def complete_module():
    """
    Mark the learner's next module complete. Modules are completed
    strictly in order, so this simply increments the counter -- it
    doesn't take a module id, because "the next one" is always
    unambiguous (completed_modules + 1).
    """
    if session.get("role") != "learner":
        return json_error("This endpoint is for learner accounts.", 403)

    connection = database.get_connection()
    try:
        user_row = current_user_row(connection)
        total_modules = connection.execute("SELECT COUNT(*) AS n FROM modules").fetchone()["n"]

        if user_row["completed_modules"] >= total_modules:
            return json_error("You've already completed the whole skill path.", 400)

        new_count = user_row["completed_modules"] + 1
        connection.execute(
            "UPDATE users SET completed_modules = ? WHERE id = ?", (new_count, user_row["id"])
        )
        connection.commit()

        updated_row = connection.execute(
            "SELECT * FROM users WHERE id = ?", (user_row["id"],)
        ).fetchone()
        return jsonify({"user": serialize_user(updated_row, connection)})
    finally:
        connection.close()


# ----------------------------------------------------------------------------
# Admin API
# ----------------------------------------------------------------------------

@app.route("/api/admin/overview")
@login_required
@admin_required
def admin_overview():
    """KPI numbers for the top of the admin dashboard."""
    connection = database.get_connection()
    try:
        learners = connection.execute("SELECT * FROM users WHERE role = 'learner'").fetchall()
        total_modules = connection.execute("SELECT COUNT(*) AS n FROM modules").fetchone()["n"]

        total_learners = len(learners)
        if total_learners == 0:
            avg_completion, placement_rate = 0, 0
        else:
            avg_completion = round(
                sum(l["completed_modules"] for l in learners) / total_learners / total_modules * 100
            )
            placed_count = sum(1 for l in learners if l["placed"] or l["completed_modules"] >= total_modules)
            placement_rate = round(placed_count / total_learners * 100)

        active_cohorts = connection.execute("SELECT COUNT(*) AS n FROM cohorts").fetchone()["n"]

        enrollment_by_track = []
        for track in database.TRACKS:
            count = sum(1 for l in learners if l["track"] == track["name"])
            enrollment_by_track.append({"track": track["name"], "code": track["code"], "count": count})

        return jsonify({
            "totalLearners": total_learners,
            "activeCohorts": active_cohorts,
            "avgCompletion": avg_completion,
            "placementRate": placement_rate,
            "enrollmentByTrack": enrollment_by_track,
        })
    finally:
        connection.close()


@app.route("/api/admin/learners")
@login_required
@admin_required
def admin_learners():
    """
    The roster table. Supports an optional ?track= filter, e.g.
    /api/admin/learners?track=Web%20Development
    """
    track_filter = request.args.get("track")

    connection = database.get_connection()
    try:
        if track_filter:
            rows = connection.execute(
                "SELECT * FROM users WHERE role = 'learner' AND track = ? ORDER BY name",
                (track_filter,),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM users WHERE role = 'learner' ORDER BY name"
            ).fetchall()

        return jsonify({"learners": [serialize_user(row, connection) for row in rows]})
    finally:
        connection.close()


@app.route("/api/admin/learners/<int:learner_id>/mark-placed", methods=["POST"])
@login_required
@admin_required
def mark_placed(learner_id):
    """An admin manually flags a learner as having been placed in a job."""
    connection = database.get_connection()
    try:
        learner = connection.execute(
            "SELECT * FROM users WHERE id = ? AND role = 'learner'", (learner_id,)
        ).fetchone()
        if learner is None:
            return json_error("Learner not found.", 404)

        connection.execute("UPDATE users SET placed = 1 WHERE id = ?", (learner_id,))
        connection.commit()

        updated = connection.execute("SELECT * FROM users WHERE id = ?", (learner_id,)).fetchone()
        return jsonify({"learner": serialize_user(updated, connection)})
    finally:
        connection.close()


@app.route("/api/admin/cohorts", methods=["GET", "POST"])
@login_required
@admin_required
def admin_cohorts():
    connection = database.get_connection()
    try:
        if request.method == "GET":
            rows = connection.execute("SELECT * FROM cohorts ORDER BY id DESC").fetchall()
            cohorts = []
            for row in rows:
                enrolled = connection.execute(
                    "SELECT COUNT(*) AS n FROM users WHERE cohort_id = ?", (row["id"],)
                ).fetchone()["n"]
                cohorts.append({
                    "id": row["id"], "name": row["name"], "track": row["track"],
                    "startDate": row["start_date"], "enrolled": enrolled,
                })
            return jsonify({"cohorts": cohorts})

        # POST -- create a new cohort
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        track = data.get("track") or ""
        start_date = (data.get("startDate") or "").strip()

        if not name or not start_date:
            return json_error("Cohort name and start date are required.")
        valid_tracks = [t["name"] for t in database.TRACKS]
        if track not in valid_tracks:
            return json_error("Please choose a valid track.")

        cursor = connection.execute(
            "INSERT INTO cohorts (name, track, start_date) VALUES (?, ?, ?)",
            (name, track, start_date),
        )
        connection.commit()
        return jsonify({
            "cohort": {"id": cursor.lastrowid, "name": name, "track": track,
                       "startDate": start_date, "enrolled": 0}
        }), 201
    finally:
        connection.close()


if __name__ == "__main__":
    # debug=True gives auto-reload + readable error pages during development.
    # Turn this off (or use a production server like gunicorn) before deploying.
    app.run(debug=True)

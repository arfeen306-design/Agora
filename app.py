import os
import sqlite3
from functools import wraps

from flask import Flask, g, redirect, render_template, request, session, url_for

app = Flask(__name__)
app.secret_key = "my_super_secret_key_123"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "school.db")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    cur = db.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('parent', 'teacher'))
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS children (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            attendance_today TEXT NOT NULL,
            attendance_this_month INTEGER NOT NULL DEFAULT 0,
            punctuality INTEGER NOT NULL DEFAULT 0,
            discipline INTEGER NOT NULL DEFAULT 0,
            upcoming_events TEXT NOT NULL DEFAULT ''
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS parent_children (
            parent_user_id INTEGER NOT NULL,
            child_id INTEGER NOT NULL,
            PRIMARY KEY (parent_user_id, child_id),
            FOREIGN KEY (parent_user_id) REFERENCES users(id),
            FOREIGN KEY (child_id) REFERENCES children(id)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS homework (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            child_id INTEGER NOT NULL,
            subject TEXT NOT NULL,
            task TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (child_id) REFERENCES children(id)
        )
        """
    )

    cur.executemany(
        "INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)",
        [
            ("parent1", "pass123", "parent"),
            ("zainmom", "zain2025", "parent"),
            ("teacher1", "teach123", "teacher"),
        ],
    )

    cur.executemany(
        """
        INSERT OR IGNORE INTO children
            (code, name, attendance_today, attendance_this_month, punctuality, discipline, upcoming_events)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "zain",
                "Zain Jr.",
                "Yes - arrived at 7:55 AM",
                92,
                88,
                95,
                "Zoo trip\nSports day",
            ),
            (
                "sara",
                "Sara",
                "Yes - arrived at 8:10 AM",
                85,
                78,
                90,
                "Parent meeting\nLibrary visit",
            ),
        ],
    )

    parent1_id = cur.execute("SELECT id FROM users WHERE username = ?", ("parent1",)).fetchone()[0]
    zainmom_id = cur.execute("SELECT id FROM users WHERE username = ?", ("zainmom",)).fetchone()[0]
    zain_id = cur.execute("SELECT id FROM children WHERE code = ?", ("zain",)).fetchone()[0]
    sara_id = cur.execute("SELECT id FROM children WHERE code = ?", ("sara",)).fetchone()[0]
    cur.executemany(
        "INSERT OR IGNORE INTO parent_children (parent_user_id, child_id) VALUES (?, ?)",
        [
            (parent1_id, zain_id),
            (parent1_id, sara_id),
            (zainmom_id, zain_id),
        ],
    )

    homework_count = cur.execute("SELECT COUNT(*) FROM homework").fetchone()[0]
    if homework_count == 0:
        zain_id = cur.execute("SELECT id FROM children WHERE code = ?", ("zain",)).fetchone()[0]
        sara_id = cur.execute("SELECT id FROM children WHERE code = ?", ("sara",)).fetchone()[0]
        cur.executemany(
            "INSERT INTO homework (child_id, subject, task, done) VALUES (?, ?, ?, ?)",
            [
                (zain_id, "Math", "Page 45-50", 1),
                (zain_id, "English", "5 sentences", 1),
                (zain_id, "Science", "Plant drawing", 0),
                (sara_id, "Math", "Worksheet 3", 0),
                (sara_id, "Art", "Clay model", 1),
            ],
        )

    db.commit()
    db.close()


def login_required(role=None):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not session.get("logged_in"):
                return redirect(url_for("login"))
            if role and session.get("role") != role:
                if session.get("role") == "teacher":
                    return redirect(url_for("teacher_dashboard"))
                return redirect(url_for("parent_dashboard"))
            return view(*args, **kwargs)

        return wrapped

    return decorator


def parse_events(events_text):
    if not events_text:
        return []
    return [line.strip() for line in events_text.splitlines() if line.strip()]


def clamp_percent(value):
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return 0


@app.before_request
def ensure_db_initialized():
    if not app.config.get("DB_READY"):
        init_db()
        app.config["DB_READY"] = True


@app.route("/", methods=["GET", "POST"])
def login():
    if session.get("logged_in"):
        if session.get("role") == "teacher":
            return redirect(url_for("teacher_dashboard"))
        return redirect(url_for("parent_dashboard"))

    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        db = get_db()
        user = db.execute(
            "SELECT id, username, role FROM users WHERE username = ? AND password = ?",
            (username, password),
        ).fetchone()
        if user:
            session["logged_in"] = True
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["role"] = user["role"]
            if user["role"] == "teacher":
                return redirect(url_for("teacher_dashboard"))
            return redirect(url_for("parent_dashboard"))
        error = "Wrong username or password! Try again."

    return render_template("login.html", error=error)


@app.route("/parent")
@login_required(role="parent")
def parent_dashboard():
    db = get_db()
    parent_id = session.get("user_id")

    children = db.execute(
        """
        SELECT c.id, c.name, c.attendance_today, c.attendance_this_month, c.punctuality, c.discipline, c.upcoming_events
        FROM children c
        JOIN parent_children pc ON pc.child_id = c.id
        WHERE pc.parent_user_id = ?
        ORDER BY c.name
        """,
        (parent_id,),
    ).fetchall()

    if not children:
        empty_data = {
            "name": "No child found",
            "attendance_today": "N/A",
            "attendance_this_month": 0,
            "punctuality": 0,
            "discipline": 0,
            "homework_done": 0,
            "homework_total": 0,
            "homework": [],
            "hw_percent": 0,
            "upcoming_events": [],
        }
        return render_template("parent_dashboard.html", data=empty_data, children=[], selected_id=None)

    requested_child_id = request.args.get("child", type=int)
    selected_child = next((child for child in children if child["id"] == requested_child_id), children[0])

    homework = db.execute(
        "SELECT id, subject, task, done FROM homework WHERE child_id = ? ORDER BY id DESC",
        (selected_child["id"],),
    ).fetchall()
    homework_done = sum(1 for h in homework if h["done"])
    homework_total = len(homework)
    hw_percent = (homework_done / homework_total * 100) if homework_total else 0

    upcoming_events = parse_events(selected_child["upcoming_events"])
    first_name = selected_child["name"].split()[0] if selected_child["name"] else "Student"
    notifications = [
        {
            "type": "success",
            "title": "Arrival Update",
            "message": f"{first_name} arrived at school!",
        },
        {
            "type": "info",
            "title": "Homework Progress",
            "message": f"{homework_done} of {homework_total} homework tasks completed.",
        },
        {
            "type": "alert",
            "title": "Upcoming Event",
            "message": upcoming_events[0] if upcoming_events else "No upcoming events this week.",
        },
    ]

    data = {
        "name": selected_child["name"],
        "attendance_today": selected_child["attendance_today"],
        "attendance_this_month": selected_child["attendance_this_month"],
        "punctuality": selected_child["punctuality"],
        "discipline": selected_child["discipline"],
        "homework_done": homework_done,
        "homework_total": homework_total,
        "homework": [{"id": h["id"], "subject": h["subject"], "task": h["task"], "done": bool(h["done"])} for h in homework],
        "hw_percent": hw_percent,
        "upcoming_events": upcoming_events,
        "notifications": notifications,
    }
    child_picker = [{"id": c["id"], "name": c["name"]} for c in children]

    return render_template(
        "parent_dashboard.html",
        data=data,
        children=child_picker,
        selected_id=selected_child["id"],
    )


@app.route("/teacher")
@login_required(role="teacher")
def teacher_dashboard():
    db = get_db()
    children = db.execute("SELECT id, name FROM children ORDER BY name").fetchall()
    selected_child_id = request.args.get("child", type=int)
    if not selected_child_id and children:
        selected_child_id = children[0]["id"]
    if children and selected_child_id not in [child["id"] for child in children]:
        selected_child_id = children[0]["id"]

    selected_child = None
    if selected_child_id:
        selected_child = db.execute(
            """
            SELECT id, name, attendance_today, attendance_this_month, punctuality, discipline
            FROM children
            WHERE id = ?
            """,
            (selected_child_id,),
        ).fetchone()

    homework = []
    if selected_child:
        homework = db.execute(
            """
            SELECT h.id, h.subject, h.task, h.done, h.created_at, c.name AS child_name
            FROM homework h
            JOIN children c ON c.id = h.child_id
            WHERE h.child_id = ?
            ORDER BY h.id DESC
            """,
            (selected_child_id,),
        ).fetchall()

    return render_template(
        "teacher_dashboard.html",
        children=children,
        selected_child_id=selected_child_id,
        selected_child=selected_child,
        homework=homework,
        saved=request.args.get("saved") == "1",
        deleted=request.args.get("deleted") == "1",
    )


@app.route("/teacher/homework/add", methods=["POST"])
@login_required(role="teacher")
def add_homework():
    child_id = request.form.get("child_id", type=int)
    subject = request.form.get("subject", "").strip()
    task = request.form.get("task", "").strip()
    done = 1 if request.form.get("done") == "on" else 0

    if child_id and subject and task:
        db = get_db()
        db.execute(
            "INSERT INTO homework (child_id, subject, task, done) VALUES (?, ?, ?, ?)",
            (child_id, subject, task, done),
        )
        db.commit()

    return redirect(url_for("teacher_dashboard", child=child_id))


@app.route("/teacher/child/<int:child_id>/update", methods=["POST"])
@login_required(role="teacher")
def update_child_metrics(child_id):
    db = get_db()
    child = db.execute("SELECT id FROM children WHERE id = ?", (child_id,)).fetchone()
    if not child:
        return redirect(url_for("teacher_dashboard"))

    attendance_today = request.form.get("attendance_today", "").strip()
    if not attendance_today:
        attendance_today = "N/A"

    attendance_this_month = clamp_percent(request.form.get("attendance_this_month"))
    punctuality = clamp_percent(request.form.get("punctuality"))
    discipline = clamp_percent(request.form.get("discipline"))

    db.execute(
        """
        UPDATE children
        SET attendance_today = ?, attendance_this_month = ?, punctuality = ?, discipline = ?
        WHERE id = ?
        """,
        (attendance_today, attendance_this_month, punctuality, discipline, child_id),
    )
    db.commit()
    return redirect(url_for("teacher_dashboard", child=child_id, saved=1))


@app.route("/teacher/homework/<int:homework_id>/edit", methods=["GET", "POST"])
@login_required(role="teacher")
def edit_homework(homework_id):
    db = get_db()
    children = db.execute("SELECT id, name FROM children ORDER BY name").fetchall()
    item = db.execute(
        "SELECT id, child_id, subject, task, done FROM homework WHERE id = ?",
        (homework_id,),
    ).fetchone()
    if not item:
        return redirect(url_for("teacher_dashboard"))

    if request.method == "POST":
        child_id = request.form.get("child_id", type=int)
        subject = request.form.get("subject", "").strip()
        task = request.form.get("task", "").strip()
        done = 1 if request.form.get("done") == "on" else 0
        if child_id and subject and task:
            db.execute(
                "UPDATE homework SET child_id = ?, subject = ?, task = ?, done = ? WHERE id = ?",
                (child_id, subject, task, done, homework_id),
            )
            db.commit()
            return redirect(url_for("teacher_dashboard", child=child_id))

    return render_template("teacher_edit_homework.html", item=item, children=children)


@app.route("/teacher/homework/<int:homework_id>/delete", methods=["POST"])
@login_required(role="teacher")
def delete_homework(homework_id):
    db = get_db()
    item = db.execute("SELECT id, child_id FROM homework WHERE id = ?", (homework_id,)).fetchone()
    fallback_child_id = request.form.get("child_id", type=int)
    if not item:
        return redirect(url_for("teacher_dashboard", child=fallback_child_id))

    db.execute("DELETE FROM homework WHERE id = ?", (homework_id,))
    db.commit()
    return redirect(url_for("teacher_dashboard", child=item["child_id"], deleted=1))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


if __name__ == "__main__":
    init_db()
    print("Magic school is running...")
    print("Parent login: parent1 / pass123")
    print("Teacher login: teacher1 / teach123")
    print("Open: http://127.0.0.1:5000/")
    app.run(debug=True)

import functools
import os
import sqlite3
from functools import lru_cache

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from flask_cors import CORS
from groq import Groq
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(32)
CORS(app)
DATABASE = os.path.join(app.instance_path, "biaty.sqlite3")


@lru_cache(maxsize=1)
def get_groq_client(api_key):
    return Groq(api_key=api_key)


def get_db():
    os.makedirs(app.instance_path, exist_ok=True)
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_db():
    with get_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                display_name TEXT NOT NULL,
                email TEXT UNIQUE,
                password_hash TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author TEXT NOT NULL,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                material TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                read_at TEXT
            );
            """
        )
        post_columns = {row[1] for row in connection.execute("PRAGMA table_info(posts)")}
        if "user_id" not in post_columns:
            connection.execute("ALTER TABLE posts ADD COLUMN user_id INTEGER REFERENCES users(id)")

        if connection.execute("SELECT COUNT(*) FROM posts").fetchone()[0] == 0:
            connection.executemany(
                """INSERT INTO posts (author, title, category, material, description)
                   VALUES (?, ?, ?, ?, ?)""",
                [
                    (
                        "Sameh Hedheli",
                        "تحويل القوارير البلاستيكية إلى أصيص نباتات",
                        "مشروع تطبيقي",
                        "بلاستيك",
                        "فكرة بسيطة لإعادة استخدام القوارير الفارغة وزراعة النباتات المنزلية بها.",
                    ),
                    (
                        "Jhonny sins",
                        "نقطة فرز للورق والبلاستيك في الحي",
                        "نقطة تجميع",
                        "ورق وبلاستيك",
                        "تنسيق أسبوعي مع الجيران لجمع المواد القابلة للتدوير وفرزها.",
                    ),
                ],
            )

        legacy_authors = connection.execute(
            "SELECT DISTINCT author FROM posts WHERE user_id IS NULL"
        ).fetchall()
        for (author,) in legacy_authors:
            profile = connection.execute(
                "SELECT id FROM users WHERE display_name = ? AND email IS NULL ORDER BY id LIMIT 1",
                (author,),
            ).fetchone()
            if profile is None:
                cursor = connection.execute(
                    "INSERT INTO users (display_name) VALUES (?)", (author,)
                )
                profile_id = cursor.lastrowid
            else:
                profile_id = profile["id"]
            connection.execute(
                "UPDATE posts SET user_id = ? WHERE author = ? AND user_id IS NULL",
                (profile_id, author),
            )


def get_current_user():
    user_id = session.get("user_id")
    if user_id is None:
        return None
    with get_db() as connection:
        user = connection.execute(
            "SELECT id, display_name, email FROM users WHERE id = ? AND password_hash IS NOT NULL",
            (user_id,),
        ).fetchone()
    if user is None:
        session.clear()
        return None
    return dict(user)


@app.context_processor
def inject_current_user():
    return {"current_user": get_current_user()}


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if get_current_user() is None:
            if request.path.startswith("/api/"):
                return jsonify({"error": "سجّل الدخول لمتابعة هذه العملية."}), 401
            return redirect(url_for("login_page"))
        return view(*args, **kwargs)

    return wrapped


def get_conversations(user_id):
    with get_db() as connection:
        conversations = connection.execute(
            """SELECT users.id, users.display_name,
                      (SELECT body FROM messages
                       WHERE (sender_id = users.id AND recipient_id = ?)
                          OR (sender_id = ? AND recipient_id = users.id)
                       ORDER BY id DESC LIMIT 1) AS last_message,
                      (SELECT created_at FROM messages
                       WHERE (sender_id = users.id AND recipient_id = ?)
                          OR (sender_id = ? AND recipient_id = users.id)
                       ORDER BY id DESC LIMIT 1) AS last_at,
                      (SELECT COUNT(*) FROM messages
                       WHERE sender_id = users.id AND recipient_id = ? AND read_at IS NULL) AS unread_count
               FROM users
               WHERE users.id != ? AND users.password_hash IS NOT NULL
                 AND EXISTS (SELECT 1 FROM messages
                             WHERE (sender_id = users.id AND recipient_id = ?)
                                OR (sender_id = ? AND recipient_id = users.id))
               ORDER BY last_at DESC""",
            (user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id),
        ).fetchall()
    return [dict(conversation) for conversation in conversations]


@app.route("/")
def login_page():
    if get_current_user():
        return redirect(url_for("home_page"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login():
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    with get_db() as connection:
        user = connection.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()
    if user is None or user["password_hash"] is None or not check_password_hash(user["password_hash"], password):
        return render_template("login.html", login_error="البريد الإلكتروني أو كلمة السر غير صحيحة."), 401

    session.clear()
    session["user_id"] = user["id"]
    return redirect(url_for("home_page"))


@app.route("/register", methods=["POST"])
def register():
    display_name = request.form.get("display_name", "").strip()
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    if len(display_name) < 2 or len(display_name) > 80 or "@" not in email or len(email) > 254 or len(password) < 8:
        return render_template(
            "login.html",
            register_error="أدخل اسماً وبريداً صالحاً وكلمة سر من 8 أحرف على الأقل.",
            register_name=display_name,
            register_email=email,
        ), 400

    try:
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO users (display_name, email, password_hash) VALUES (?, ?, ?)",
                (display_name, email, generate_password_hash(password)),
            )
    except sqlite3.IntegrityError:
        return render_template(
            "login.html",
            register_error="هذا البريد مسجل بالفعل. سجّل الدخول بدلاً من ذلك.",
            register_name=display_name,
            register_email=email,
        ), 409

    session.clear()
    session["user_id"] = cursor.lastrowid
    return redirect(url_for("home_page"))


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login_page"))


@app.route("/home")
def home_page():
    return render_template("home.html")


@app.route("/index")
def index_page():
    return render_template("index.html")


@app.route("/users/<int:user_id>")
def profile_page(user_id):
    with get_db() as connection:
        profile = connection.execute(
            "SELECT id, display_name, password_hash IS NOT NULL AS can_message FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if profile is None:
            return render_template("profile.html", profile=None, posts=[]), 404
        posts = connection.execute(
            """SELECT posts.*, COUNT(comments.id) AS comments_count
               FROM posts LEFT JOIN comments ON comments.post_id = posts.id
               WHERE posts.user_id = ? GROUP BY posts.id ORDER BY posts.id DESC""",
            (user_id,),
        ).fetchall()
    return render_template("profile.html", profile=dict(profile), posts=[dict(post) for post in posts])


@app.route("/messages")
@login_required
def inbox_page():
    current_user = get_current_user()
    return render_template("messages.html", recipient=None, conversations=get_conversations(current_user["id"]))


@app.route("/messages/<int:user_id>")
@login_required
def conversation_page(user_id):
    current_user = get_current_user()
    with get_db() as connection:
        recipient = connection.execute(
            "SELECT id, display_name FROM users WHERE id = ? AND password_hash IS NOT NULL",
            (user_id,),
        ).fetchone()
    if recipient is None or user_id == current_user["id"]:
        return redirect(url_for("inbox_page"))
    return render_template(
        "messages.html",
        recipient=dict(recipient),
        conversations=get_conversations(current_user["id"]),
    )


@app.route("/api/posts", methods=["GET", "POST"])
def posts_api():
    if request.method == "GET":
        with get_db() as connection:
            posts = connection.execute(
                """SELECT posts.*, posts.user_id AS author_id,
                          COUNT(comments.id) AS comments_count
                   FROM posts LEFT JOIN comments ON comments.post_id = posts.id
                   GROUP BY posts.id ORDER BY posts.id DESC"""
            ).fetchall()
        return jsonify([dict(post) for post in posts])

    payload = request.get_json(silent=True) or {}
    current_user = get_current_user()
    if current_user is None:
        return jsonify({"error": "سجّل الدخول قبل إضافة منشور."}), 401
    fields = {name: str(payload.get(name, "")).strip() for name in (
        "title", "category", "material", "description"
    )}
    fields["author"] = current_user["display_name"]
    fields["user_id"] = current_user["id"]
    limits = {"title": 160, "category": 60, "material": 120, "description": 2000}
    if any(not fields[name] or len(fields[name]) > limit for name, limit in limits.items()):
        return jsonify({"error": "يرجى تعبئة جميع الحقول ضمن الطول المسموح."}), 400

    with get_db() as connection:
        cursor = connection.execute(
            """INSERT INTO posts (author, title, category, material, description, user_id)
               VALUES (:author, :title, :category, :material, :description, :user_id)""",
            fields,
        )
        post = connection.execute(
            "SELECT *, user_id AS author_id, 0 AS comments_count FROM posts WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return jsonify(dict(post)), 201


@app.route("/api/posts/<int:post_id>/comments", methods=["GET", "POST"])
def comments_api(post_id):
    with get_db() as connection:
        if connection.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone() is None:
            return jsonify({"error": "المنشور غير موجود."}), 404

        if request.method == "GET":
            comments = connection.execute(
                "SELECT * FROM comments WHERE post_id = ? ORDER BY id", (post_id,)
            ).fetchall()
            return jsonify([dict(comment) for comment in comments])

        payload = request.get_json(silent=True) or {}
        author = str(payload.get("author", "")).strip()
        body = str(payload.get("body", "")).strip()
        if not author or len(author) > 80 or not body or len(body) > 1000:
            return jsonify({"error": "اكتب اسمك وتعليقاً لا يتجاوز 1000 حرف."}), 400

        cursor = connection.execute(
            "INSERT INTO comments (post_id, author, body) VALUES (?, ?, ?)",
            (post_id, author, body),
        )
        comment = connection.execute(
            "SELECT * FROM comments WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return jsonify(dict(comment)), 201


@app.route("/api/conversations/<int:other_user_id>/messages", methods=["GET", "POST"])
@login_required
def messages_api(other_user_id):
    current_user = get_current_user()
    if other_user_id == current_user["id"]:
        return jsonify({"error": "لا يمكنك بدء محادثة مع حسابك."}), 400

    with get_db() as connection:
        recipient = connection.execute(
            "SELECT id FROM users WHERE id = ? AND password_hash IS NOT NULL",
            (other_user_id,),
        ).fetchone()
        if recipient is None:
            return jsonify({"error": "الحساب غير موجود."}), 404

        if request.method == "GET":
            connection.execute(
                """UPDATE messages SET read_at = CURRENT_TIMESTAMP
                   WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL""",
                (other_user_id, current_user["id"]),
            )
            messages = connection.execute(
                """SELECT messages.*, sender.display_name AS sender_name
                   FROM messages JOIN users AS sender ON sender.id = messages.sender_id
                   WHERE (sender_id = ? AND recipient_id = ?)
                      OR (sender_id = ? AND recipient_id = ?)
                   ORDER BY messages.id""",
                (current_user["id"], other_user_id, other_user_id, current_user["id"]),
            ).fetchall()
            return jsonify([dict(message) for message in messages])

        payload = request.get_json(silent=True) or {}
        body = str(payload.get("body", "")).strip()
        if not body or len(body) > 2000:
            return jsonify({"error": "اكتب رسالة لا تتجاوز 2000 حرفاً."}), 400

        cursor = connection.execute(
            "INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)",
            (current_user["id"], other_user_id, body),
        )
        message = connection.execute(
            """SELECT messages.*, users.display_name AS sender_name
               FROM messages JOIN users ON users.id = messages.sender_id
               WHERE messages.id = ?""",
            (cursor.lastrowid,),
        ).fetchone()
    return jsonify(dict(message)), 201


@app.route("/api/labib-chat", methods=["POST"])
def labib_chat():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "أرسل سؤالاً صالحاً للمساعد لبيب."}), 400

    user_message = data.get("message", "")
    if not isinstance(user_message, str) or not user_message.strip():
        return jsonify({"error": "لا يمكن إرسال رسالة فارغة."}), 400
    user_message = user_message.strip()
    if len(user_message) > 2000:
        return jsonify({"error": "يجب ألا يتجاوز السؤال 2000 حرف."}), 400

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return jsonify({"error": "المساعد لبيب غير مهيأ بعد. أضف GROQ_API_KEY إلى إعدادات الخادم."}), 503

    try:
        response = get_groq_client(api_key).chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": "أنت لبيب، مساعد بيئي ذكي لمنصة بيئتي في تونس. أجب بأسلوب مشجع وعملي باللغة العربية أو باللهجة التونسية حسب سياق السؤال. لا تختلق معلومات محلية مؤكدة.",
                },
                {"role": "user", "content": user_message},
            ],
            max_tokens=300,
            timeout=30.0,
        )
        reply = response.choices[0].message.content
        if not isinstance(reply, str) or not reply.strip():
            raise ValueError("Groq returned an empty assistant response")
        return jsonify({"reply": reply.strip()})
    except Exception as error:
        provider_error = getattr(error, "body", None)
        if isinstance(provider_error, dict):
            provider_error = provider_error.get("error", provider_error)
        if not isinstance(provider_error, dict):
            provider_error = {}
        app.logger.error(
            "Labib Groq diagnostic status=%s code=%s type=%s param=%s message=%s request_id=%s",
            getattr(error, "status_code", None),
            provider_error.get("code"),
            provider_error.get("type"),
            provider_error.get("param"),
            provider_error.get("message"),
            getattr(error, "request_id", None),
        )
        app.logger.exception(
            "Labib Groq request failed (%s): %s",
            type(error).__name__,
            error,
        )
        return jsonify({"error": "عذراً، تعذر على لبيب الرد الآن. حاول مرة أخرى."}), 502


initialize_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)

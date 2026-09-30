from flask import Flask, render_template
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route("/")
def login_page():
    return render_template("login.html")


@app.route("/home")
def home_page():
    return render_template("home.html")


@app.route("/index")
def index_page():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)

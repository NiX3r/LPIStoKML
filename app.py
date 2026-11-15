"""Optional local/self-hosted server. The app itself is static (web/) and converts everything in the browser,
so any static host works too: GitHub Pages, `python -m http.server --directory web`, nginx, ..."""
from pathlib import Path

from flask import Flask, redirect, send_from_directory

WEB = Path(__file__).parent / "web"

app = Flask(__name__, static_folder=str(WEB), static_url_path="")


@app.route("/")
def index():
    return send_from_directory(WEB, "index.html")


@app.route("/wiki")
def wiki():
    return redirect("wiki.html", code=301)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

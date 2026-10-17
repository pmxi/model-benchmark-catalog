"""Serve the local catalog viewer and a read-only snapshot of the SQLite data.

Run from anywhere: uv run --no-project python /path/to/website/server.py
No third-party packages or build step are required.
"""

import argparse
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
TABLES = {
    "organizations": "organization", "models": "model", "benchmarks": "benchmark",
    "measures": "benchmark_measure", "sources": "source",
    "assertions": "score_assertion", "citations": "score_citation",
}
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
    "/data.mjs": ("data.mjs", "text/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}


def load_catalog(database):
    """Read all relations from a consistent snapshot; never create or write a DB."""
    with closing(sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only = ON")
        db.execute("BEGIN")
        if "url" not in {row[1] for row in db.execute("PRAGMA table_info(source)")}:
            raise ValueError("Unsupported catalog schema: source.url is missing. Use the current catalog.sqlite.")
        catalog = {name: [dict(row) for row in db.execute(f"SELECT * FROM {table} ORDER BY id")]
                   for name, table in TABLES.items()}
        catalog["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return catalog


def create_server(database, host="127.0.0.1", port=8765):
    database = Path(database).resolve()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.respond()

        def do_HEAD(self):
            self.respond(head_only=True)

        def respond(self, head_only=False):
            path = urlsplit(self.path).path
            if path == "/api/catalog":
                try:
                    body = json.dumps(load_catalog(database), ensure_ascii=False, allow_nan=False).encode()
                except (sqlite3.Error, ValueError) as error:
                    self.log_error("Catalog could not be read: %s", error)
                    self.send_error(503, "Catalog is unavailable. Check the local server log.")
                    return
                mime = "application/json; charset=utf-8"
            elif path in ASSETS:
                filename, mime = ASSETS[path]
                body = (ROOT / filename).read_bytes()
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store" if path == "/api/catalog" else "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if not head_only:
                self.wfile.write(body)

    return ThreadingHTTPServer((host, port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=ROOT.parent / "catalog.sqlite")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    try:
        load_catalog(args.db)
    except (sqlite3.Error, ValueError) as error:
        parser.error(str(error))
    with create_server(args.db, args.host, args.port) as server:
        print(f"Catalog viewer: http://{args.host}:{server.server_port}", flush=True)
        print(f"Reading {args.db.resolve()} (read-only)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

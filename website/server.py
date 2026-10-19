"""Preview the static catalog viewer with a fresh SQLite snapshot on each load.

Run from anywhere: uv run --no-project python /path/to/website/server.py
Requires Python 3.11 or later. The browser queries SQLite using bundled sql.js.
"""

import argparse
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
    "/data.mjs": ("data.mjs", "text/javascript; charset=utf-8"),
    "/catalog.mjs": ("catalog.mjs", "text/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
    "/vendor/sql.js/sql-wasm.js": ("vendor/sql.js/sql-wasm.js", "text/javascript; charset=utf-8"),
    "/vendor/sql.js/sql-wasm.wasm": ("vendor/sql.js/sql-wasm.wasm", "application/wasm"),
    "/vendor/sql.js/LICENSE": ("vendor/sql.js/LICENSE", "text/plain; charset=utf-8"),
}


def database_snapshot(database):
    """Return a standalone SQLite snapshot, including any committed WAL data."""
    with closing(sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("PRAGMA query_only = ON")
        if "url" not in {row[1] for row in db.execute("PRAGMA table_info(source)")}:
            raise ValueError("Unsupported catalog schema: source.url is missing. Use the current catalog.sqlite.")
        with closing(sqlite3.connect(":memory:")) as snapshot:
            db.backup(snapshot)
            data = bytearray(snapshot.serialize())
            # Backup includes committed WAL pages but retains the source header.
            # SQLite's deserialize API requires rollback-mode header bytes:
            # https://www.sqlite.org/c3ref/deserialize.html
            data[18:20] = b"\x01\x01"
            return bytes(data)


def create_server(database, host="127.0.0.1", port=8765):
    database = Path(database).resolve()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.respond()

        def do_HEAD(self):
            self.respond(head_only=True)

        def respond(self, head_only=False):
            path = urlsplit(self.path).path
            if path == "/catalog.sqlite":
                try:
                    body = database_snapshot(database)
                except (sqlite3.Error, ValueError) as error:
                    self.log_error("Catalog could not be read: %s", error)
                    self.send_error(503, "Catalog is unavailable. Check the local server log.")
                    return
                mime = "application/vnd.sqlite3"
            elif path in ASSETS:
                filename, mime = ASSETS[path]
                body = (ROOT / filename).read_bytes()
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store" if path == "/catalog.sqlite" else "no-cache")
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
        database_snapshot(args.db)
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

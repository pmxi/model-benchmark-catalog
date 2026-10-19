"""Package the static site: python -m website.build [--output _site]."""

import argparse
import hashlib
from pathlib import Path

from website.server import ASSETS, ROOT, database_snapshot


def build_site(output, database=ROOT.parent / "catalog.sqlite"):
    output = Path(output).resolve()
    # Never overwrite source files when given an incorrect output directory.
    if output == ROOT or output in ROOT.parents:
        raise ValueError("Output must be a separate directory, such as _site.")
    snapshot = database_snapshot(database)
    assets = {filename: (ROOT / filename).read_bytes()
              for filename in sorted({asset[0] for asset in ASSETS.values()})}
    version = hashlib.sha256(b"".join(assets.values())).hexdigest()[:16]
    output.mkdir(parents=True, exist_ok=True)
    for filename, content in assets.items():
        destination = output / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        if filename.endswith((".html", ".mjs")):
            text = content.decode()
            # Version entry points and their module imports as one release.
            # Otherwise a cached script can refer to controls removed in HTML.
            for asset in assets:
                for prefix in ("", "./"):
                    for quote in ('"', "'"):
                        reference = f"{quote}{prefix}{asset}{quote}"
                        text = text.replace(reference, f"{quote}{prefix}{asset}?v={version}{quote}")
            content = text.encode()
        destination.write_bytes(content)
    (output / "catalog.sqlite").write_bytes(snapshot)
    (output / ".nojekyll").touch()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "_site")
    args = parser.parse_args()
    build_site(args.output)
    print(f"Static site written to {args.output.resolve()}")

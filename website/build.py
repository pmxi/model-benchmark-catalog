"""Package the static site: python -m website.build [--output _site]."""

import argparse
from pathlib import Path
import shutil

from website.server import ASSETS, ROOT, database_snapshot


def build_site(output, database=ROOT.parent / "catalog.sqlite"):
    output = Path(output).resolve()
    # Never overwrite source files when given an incorrect output directory.
    if output == ROOT or output in ROOT.parents:
        raise ValueError("Output must be a separate directory, such as _site.")
    snapshot = database_snapshot(database)
    output.mkdir(parents=True, exist_ok=True)
    for filename in {asset[0] for asset in ASSETS.values()}:
        destination = output / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / filename, destination)
    (output / "catalog.sqlite").write_bytes(snapshot)
    (output / ".nojekyll").touch()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "_site")
    args = parser.parse_args()
    build_site(args.output)
    print(f"Static site written to {args.output.resolve()}")

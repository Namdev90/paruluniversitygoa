#!/usr/bin/env python3
"""Pin optional public artwork to its git revision and exact source bytes.

Only images are remote: executable UI, scanner and essential branding stay local.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ARTWORK = ('art/navrang-parul-combined.png', 'art/dancer-male.webp', 'art/dancer-female.webp')

def manifest():
    images = {}
    for name in ARTWORK:
        path = 'app/assets/' + name
        revision = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', path], cwd=ROOT, text=True).strip()
        data = (ROOT / path).read_bytes()
        committed = subprocess.check_output(['git', 'show', revision + ':' + path], cwd=ROOT)
        if data != committed or len(data) > 2 * 1024 * 1024:
            raise SystemExit('Commit and verify changed artwork before generating its delivery manifest: ' + name)
        images[name] = dict(revision=revision, sha256=hashlib.sha256(data).hexdigest(), size=len(data),
                            mime='image/png' if name.endswith('.png') else 'image/webp')
    return dict(schema=1, images=images)

if __name__ == '__main__':
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'remote-artwork.json').write_text(json.dumps(manifest(), indent=2) + '\n')

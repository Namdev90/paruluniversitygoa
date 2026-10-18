#!/usr/bin/env python3
"""Export the browser/admin companion without private data or native-only files."""
from pathlib import Path
import shutil,sys,subprocess,tempfile
root=Path(__file__).resolve().parents[1];dest=Path(sys.argv[1]).resolve();dest.mkdir(parents=True,exist_ok=True)
for name in ['index.html','style.css','core.js','live-core.js','config.js','client.js','desk-core.js','desk.js','report-export.js','reports.js','gate.js']:
 shutil.copy2(root/'app/assets'/name,dest/name)
for name in ['art','audio']:shutil.copytree(root/'app/assets'/name,dest/name,dirs_exist_ok=True)
# The browser favicon and downloadable official crop use the same verified
# original artwork as Android, without packaging native resources or any key.
with tempfile.TemporaryDirectory(prefix='navrang-web-brand-') as temporary:
 subprocess.run(['java','-Djava.awt.headless=true',str(root/'tools/PrepareBrands.java'),str(root),temporary],check=True)
 for name in ['navrang-wordmark.png','app-icon.png']:
  shutil.copy2(Path(temporary)/'app/assets/art'/name,dest/'art'/name)
print('Browser companion exported to',dest)

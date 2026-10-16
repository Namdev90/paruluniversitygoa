#!/usr/bin/env python3
"""Export the browser/admin companion without private data or native-only files."""
from pathlib import Path
import shutil,sys
root=Path(__file__).resolve().parents[1];dest=Path(sys.argv[1]).resolve();dest.mkdir(parents=True,exist_ok=True)
for name in ['index.html','style.css','core.js','workbook.js','package.js','live-core.js','store.js','config.js','client.js','gate.js']:
 shutil.copy2(root/'app/assets'/name,dest/name)
for name in ['art','vendor']:shutil.copytree(root/'app/assets'/name,dest/name,dirs_exist_ok=True)
print('Browser companion exported to',dest)

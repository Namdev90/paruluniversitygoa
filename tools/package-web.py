#!/usr/bin/env python3
"""Export the browser/admin companion without private data or native-only files."""
from pathlib import Path
import shutil,sys
root=Path(__file__).resolve().parents[1];dest=Path(sys.argv[1]).resolve();dest.mkdir(parents=True,exist_ok=True)
for name in ['index.html','style.css','core.js','live-core.js','config.js','client.js','desk-core.js','desk.js','report-export.js','reports.js','gate.js','auth-flow.js','pagination.js','presentation-motion.js','report-layout.js','notifications.js','notifications.css']:
 shutil.copy2(root/'app/assets'/name,dest/name)
for name in ['art','audio']:shutil.copytree(root/'app/assets'/name,dest/name,dirs_exist_ok=True)
# Preserve the owner-requested original logo bytes; do not replace them with a brochure crop.
print('Browser companion exported to',dest)

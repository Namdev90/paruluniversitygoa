#!/usr/bin/env python3
"""Publish a built, signed APK and its discovery metadata into this Git checkout."""
from pathlib import Path
import hashlib,json,shutil
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
def prepare():
 release=json.loads((ROOT/'release.json').read_text())
 name=release['versionName'];code=release['versionCode'];source=ROOT/'dist'/f'Navrang-Gate-{name}.apk'
 if not source.is_file():raise SystemExit('Build the signed APK first.')
 destination=ROOT/'downloads'/source.name;destination.parent.mkdir(exist_ok=True);shutil.copy2(source,destination)
 digest=hashlib.sha256(destination.read_bytes()).hexdigest()
 meta={'packageName':'in.navrang.gate','versionCode':code,'versionName':name,'apkUrl':f'https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/{source.name}','size':destination.stat().st_size,'sha256':digest,'notes':release['notes'],'publishedAt':datetime.now(timezone.utc).isoformat()}
 (ROOT/'updates').mkdir(exist_ok=True);(ROOT/'updates/latest.json').write_text(json.dumps(meta,indent=2)+'\n')
 sums=ROOT/'SHA256SUMS.txt';prior=sums.read_text().splitlines() if sums.exists() else []
 sums.write_text(f'{digest}  downloads/{source.name}\n'+'\n'.join(line for line in prior if f'downloads/{source.name}' not in line)+'\n')
 print(json.dumps({'releasePrepared':name,'versionCode':code,'bytes':meta['size'],'sha256':digest}))
if __name__=='__main__':prepare()

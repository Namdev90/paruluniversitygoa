#!/usr/bin/env python3
"""Publish a built, signed APK and its discovery metadata into this Git checkout."""
from pathlib import Path
import json,shutil,os
from datetime import datetime,timezone
from release_policy import verify_apk,check_publication
ROOT=Path(__file__).resolve().parents[1]
def prepare():
 release=json.loads((ROOT/'release.json').read_text())
 name=release['versionName'];code=release['versionCode'];source=ROOT/'dist'/f'Navrang-Gate-{name}.apk'
 if not source.is_file():raise SystemExit('Build the signed APK first.')
 sdk=Path(os.environ.get('NAVRANG_ANDROID_SDK',str(ROOT/'.build/tools')))
 build_tools=Path(os.environ.get('NAVRANG_BUILD_TOOLS',str(sdk/'android-15')))
 digest=verify_apk(source,release,build_tools)
 destination=ROOT/'downloads'/source.name
 manifest=ROOT/'updates/latest.json'
 latest=json.loads(manifest.read_text()) if manifest.exists() else None
 check_publication(release,source,destination,latest)
 destination.parent.mkdir(exist_ok=True);shutil.copy2(source,destination)
 meta={'packageName':'in.navrang.gate','versionCode':code,'versionName':name,'apkUrl':f'https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/{source.name}','size':destination.stat().st_size,'sha256':digest,'notes':release['notes'],'publishedAt':datetime.now(timezone.utc).isoformat()}
 (ROOT/'updates').mkdir(exist_ok=True);(ROOT/'updates/latest.json').write_text(json.dumps(meta,indent=2)+'\n')
 sums=ROOT/'SHA256SUMS.txt';prior=sums.read_text().splitlines() if sums.exists() else []
 sums.write_text(f'{digest}  downloads/{source.name}\n'+'\n'.join(line for line in prior if f'downloads/{source.name}' not in line)+'\n')
 print(json.dumps({'releasePrepared':name,'versionCode':code,'bytes':meta['size'],'sha256':digest}))
if __name__=='__main__':prepare()

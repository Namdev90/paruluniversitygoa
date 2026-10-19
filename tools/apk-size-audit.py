#!/usr/bin/env python3
"""Read-only APK compressed-size and duplicate-content inventory, no signing secrets."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import zipfile

def audit(path):
    groups = collections.defaultdict(lambda: dict(bytes=0, expandedBytes=0, files=0))
    duplicates = collections.defaultdict(list)
    largest = []
    unwanted = []
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if item.is_dir(): continue
            name = item.filename
            if name.endswith('.dex'): group = 'Compiled app and library code'
            elif name.startswith('lib/'): group = 'Native libraries'
            elif name.startswith('res/') or name == 'resources.arsc': group = 'Android resources'
            elif name.startswith('assets/audio/'): group = 'Audio'
            elif name.startswith('assets/art/') and name.endswith(('.png', '.webp', '.jpg', '.svg')): group = 'Artwork'
            elif name.startswith('assets/'): group = 'Interface, scripts and public config'
            else: group = 'Metadata and other'
            entry = groups[group]
            entry['bytes'] += item.compress_size; entry['expandedBytes'] += item.file_size; entry['files'] += 1
            record = dict(path=name, bytes=item.compress_size)
            largest.append(record)
            if item.file_size > 1024: duplicates[hashlib.sha256(archive.read(name)).hexdigest()].append(record)
            if name.lower().endswith(('.xlsx', '.xls', '.csv', '.db', '.sqlite', '.sqlite3', '.p12', '.jks', '.keystore')): unwanted.append(name)
    total = Path(path).stat().st_size
    groups['ZIP headers, signature and alignment'] = dict(bytes=total-sum(g['bytes'] for g in groups.values()))
    return dict(apkBytes=total, sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest(), groups=dict(groups),
                largest=sorted(largest, key=lambda v:v['bytes'], reverse=True)[:20],
                duplicateGroups=[v for v in duplicates.values() if len(v)>1], databaseSpreadsheetOrSigningFiles=unwanted)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('apk', type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args();result=json.dumps(audit(args.apk),indent=2)+'\n'
    if args.output: args.output.write_text(result)
    print(result)

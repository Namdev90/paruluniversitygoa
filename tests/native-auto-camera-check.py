#!/usr/bin/env python3
"""Compile and exercise the real native-only QR reader and assist policy without Android."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='navrang-auto-camera-') as temporary:
    jar = root / 'libs/core-3.5.3.jar'
    sources = [root / 'native-app/src/main/java/in/navrang/gate' / name for name in ['ScannerQrReader.java', 'ScannerAssist.java']]
    sources.append(root / 'tests/qr/ScannerAssistCheck.java')
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-cp', str(jar), '-d', temporary, *map(str, sources)], check=True)
    subprocess.run(['java', '-Djava.awt.headless=true', '-cp', f'{temporary}:{jar}', 'in.navrang.gate.ScannerAssistCheck'], check=True, timeout=30)

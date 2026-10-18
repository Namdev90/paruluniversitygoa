#!/usr/bin/env python3
"""Share the original interface host with the AndroidX authentication/scanner app."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
source = (root / 'app/java/in/navrang/gate/MainActivity.java').read_text()
def replace(old, new, multiple=False):
    global source
    count = source.count(old)
    if not count or (not multiple and count != 1):
        sys.exit(f'prepare-classic-host: expected source pattern {old!r}; found {count} matches')
    source = source.replace(old, new)

replace('public final class MainActivity extends Activity', 'public class ClassicActivity extends androidx.activity.ComponentActivity')
replace('MainActivity.this', 'ClassicActivity.this', multiple=True)
replace('return ScanActivity.class;', 'return ClassicScannerActivity.class;')
replace('@Override public void onBackPressed()', 'protected void classicBack()')
replace('setContentView(frame);frame.requestApplyInsets();', 'setContentView(frame);frame.requestApplyInsets();getOnBackPressedDispatcher().addCallback(this,new androidx.activity.OnBackPressedCallback(true){@Override public void handleOnBackPressed(){classicBack();}});')

target = Path(sys.argv[1]) / 'in/navrang/gate/ClassicActivity.java'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(source)

#!/usr/bin/env python3
"""Share the original interface host with the AndroidX authentication/scanner app."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
source = (root / 'app/java/in/navrang/gate/MainActivity.java').read_text()
old = 'public final class MainActivity extends Activity'
assert old in source
source = source.replace(old, 'public class ClassicActivity extends androidx.activity.ComponentActivity')
source = source.replace('MainActivity.this', 'ClassicActivity.this')
source = source.replace('return ScanActivity.class;', 'return ClassicScannerActivity.class;')
source = source.replace('@Override public void onBackPressed()', 'protected void classicBack()')
source = source.replace('setContentView(frame);frame.requestApplyInsets();', 'setContentView(frame);frame.requestApplyInsets();getOnBackPressedDispatcher().addCallback(this,new androidx.activity.OnBackPressedCallback(true){@Override public void handleOnBackPressed(){classicBack();}});')

target = Path(sys.argv[1]) / 'in/navrang/gate/ClassicActivity.java'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(source)

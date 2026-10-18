#!/usr/bin/env python3
"""Source contract checks supplement the native Compose/domain tests when Android is absent.
These are not claimed as Android execution or screenshot evidence.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
KOTLIN = ROOT / 'native-app/src/main/kotlin/in/navrang/gate'


class ClassicScannerContract(unittest.TestCase):
    def test_id_entry_uses_existing_submit_without_leaving_or_rebinding_camera(self):
        scanner = (KOTLIN / 'ScannerScreen.kt').read_text()
        self.assertIn('DisposableEffect(owner, preview)', scanner)
        self.assertIn('s.held != null || s.profile?.canScan != true || exactIdOpen || inspectedResult != null', scanner)
        self.assertEqual(scanner.count('onVerify = vm::submit'), 2)
        self.assertIn('onClick = { onExactIdOpen(!exactIdOpen) }', scanner)
        self.assertIn('onExactIdOpen = { exactIdOpen = it }', scanner)
        self.assertNotIn('onClick = exit) { Text("Exact ID")', scanner)
        self.assertIn('if (!active.get() || held || now - last < 100)', scanner)
        self.assertIn('if (active.get() && !held)', scanner)
        # Opening the ID panel must not become a camera-effect key.
        effect = scanner.split('DisposableEffect(', 1)[1].split(')', 1)[0]
        self.assertNotIn('exactId', effect)

    def test_submit_is_explicit_permission_gated_and_never_truncates_ids(self):
        ui = (KOTLIN / 'ClassicScannerComponents.kt').read_text()
        model = (KOTLIN / 'GateModels.kt').read_text()
        vm = (KOTLIN / 'GateViewModel.kt').read_text()
        self.assertIn('Text("Verify entry")', ui)
        self.assertIn('records admission for an eligible ticket', ui)
        self.assertIn('enabled && normalized != null', ui)
        self.assertNotIn('.take(8)', ui)
        self.assertIn('uppercase(Locale.ROOT)', model)
        submit = vm.split('fun submit(raw: String)', 1)[1].split('fun scanned(', 1)[0]
        self.assertLess(submit.index('profile?.canScan != true'), submit.index('repo().submit(id)'))
        self.assertIn('exactScannerId(raw)', submit)

    def test_details_use_only_returned_registration_and_original_receipt(self):
        ui = (KOTLIN / 'ClassicScannerComponents.kt').read_text()
        model = (KOTLIN / 'GateModels.kt').read_text()
        self.assertIn('o.optJSONObject("record")?.let(ScanRecordDetails::from)', model)
        for key in ('amount', 'quantity', 'refund', 'description', 'reason', 'paymentAt', 'paymentMethod', 'paymentReference'):
            self.assertIn(f'o.text("{key}")', model)
        self.assertIn('Previous accepted entry', ui)
        self.assertNotIn('Not recorded', ui)
        self.assertIn('if (value.isBlank()) return', ui)
        self.assertIn('record?.hasValues == true', ui)
        self.assertIn('receipt.hasScanDetails', ui)
        self.assertIn('Organizer-confirmed correction', ui)
        self.assertNotIn('result.receipt?.time', ui.split('ScannerDetail("Payment date and time"', 1)[1].split('\n', 1)[0])
        for forbidden in ('repository', 'allEntries', 'tickets.first', 'helpdesk-list', 'api.call'):
            self.assertNotIn(forbidden, ui)

    def test_classic_branding_and_requested_screenshots_remain_available(self):
        activity = (KOTLIN / 'ClassicScannerActivity.kt').read_text()
        ui = (KOTLIN / 'ClassicScannerComponents.kt').read_text()
        self.assertNotIn('FLAG_SECURE', activity)
        self.assertIn('ClassicScannerTheme', activity)
        self.assertIn('R.drawable.app_icon', activity)
        self.assertIn('Color(0xffe5be7d)', ui)
        self.assertIn('Color(0xff402333)', ui)
        self.assertIn('Brush.verticalGradient', ui)
        self.assertIn('.verticalScroll(rememberScrollState())', ui)
        self.assertIn('ClassicScanReceipt(result)', activity)


if __name__ == '__main__':
    unittest.main()

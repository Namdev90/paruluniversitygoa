#!/usr/bin/env python3
"""Login source contracts only; not Android compilation, rendering or accessibility proof."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'native-app/src/main/kotlin/in/navrang/gate/GateApp.kt').read_text()
LOGIN = APP.split('private fun LoginScreen(', 1)[1].split('private fun StationScreen(', 1)[0]


class LoginPresentationContract(unittest.TestCase):
    def test_login_keeps_single_secret_and_existing_auth_contract(self):
        self.assertEqual(LOGIN.count('OutlinedTextField('), 1)
        self.assertIn('visualTransformation = PasswordVisualTransformation()', LOGIN)
        self.assertIn('enabled = !busy && secret.isNotBlank()', LOGIN)
        self.assertIn('if (mode == "Admin") "login" else "checker-login"', LOGIN)
        self.assertIn('(if (mode == "Admin") "password" else "code") to secret', LOGIN)
        self.assertIn('"username" to if (mode == "Admin") "namdev" else ""', LOGIN)
        self.assertEqual(LOGIN.count('secret = ""'), 3)
        for mode in ('Code', 'Admin'):
            self.assertIn(f'mode = "{mode}"\n                        secret = ""', LOGIN)
        self.assertEqual(LOGIN.count('enabled = !busy'), 3)
        self.assertIn('onClick = google', LOGIN)
        self.assertIn('onClick = browser', LOGIN)

    def test_controls_wrap_and_form_remains_scrollable(self):
        self.assertIn('LazyColumn(', LOGIN)
        self.assertIn('.widthIn(max = 560.dp)', LOGIN)
        self.assertIn('FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp))', LOGIN)
        self.assertEqual(LOGIN.count('heightIn(min = 48.dp)'), 5)
        self.assertIn('singleLine = true', LOGIN)

    def test_field_colors_follow_current_theme_with_visible_focus(self):
        self.assertIn('.compositeOver(MaterialTheme.colorScheme.surface)', LOGIN)
        self.assertIn('focusedContainerColor = fieldContainer', LOGIN)
        self.assertIn('unfocusedContainerColor = fieldContainer', LOGIN)
        self.assertIn('focusedBorderColor = MaterialTheme.colorScheme.onSurface', LOGIN)
        self.assertIn('cursorColor = MaterialTheme.colorScheme.onSurface', LOGIN)
        for forbidden in ('Brush.', 'animate', 'Verified', 'CheckCircle'):
            self.assertNotIn(forbidden, LOGIN)

    def test_brand_appearance_and_motion_preferences_remain(self):
        self.assertIn('private val Wine = Color(0xff702449)', APP)
        self.assertIn('primary = Wine', APP)
        self.assertIn('dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)', APP)
        self.assertIn('"dark" -> true', APP)
        self.assertIn('"light" -> false', APP)
        self.assertIn('R.drawable.navrang_wordmark', APP)
        self.assertIn('R.drawable.parul_line', APP)
        self.assertIn('Settings.Global.ANIMATOR_DURATION_SCALE', APP)
        self.assertIn('rotationZ = if (noMotion) 0f else sway', APP)


if __name__ == '__main__':
    unittest.main()

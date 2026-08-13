from pathlib import Path
import json

# 1) Active app: remove broad photo permission request and add Privacy Policy link.
p = Path('DashboardApp.tsx')
s = p.read_text()

s = s.replace('  Image,\n  Modal,', '  Image,\n  Linking,\n  Modal,')

s = s.replace(
    "const DEFAULT_PREFS: SavePreferences = { directoryUri: null, autoSave: false };\n",
    "const DEFAULT_PREFS: SavePreferences = { directoryUri: null, autoSave: false };\nconst PRIVACY_URL = 'https://github.com/codecsverige/Pdf/blob/main/privacy.html';\n",
)

s = s.replace(
    "      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();\n      if (!permission.granted) throw new Error('Photo access is required.');\n      const response = await ImagePicker.launchImageLibraryAsync({",
    "      const response = await ImagePicker.launchImageLibraryAsync({",
)

old_settings = '''                <View style={styles.settingSwitchRow}><View style={styles.settingIcon}><Icon name="download-circle-outline" color="#2563EB" /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Auto-download</Text><Text style={styles.settingSub}>Save every result right after processing</Text></View><Switch value={prefs.autoSave} onValueChange={value => persistPrefs({ ...prefs, autoSave: value })} trackColor={{ false: '#D7DCE5', true: '#FDA4AF' }} thumbColor={prefs.autoSave ? BRAND : '#FFFFFF'} /></View>\n              </View>\n              <View style={styles.privacyCard}><View style={styles.privacyIcon}><Icon name="shield-lock-outline" color="#059669" size={25} /></View><View style={{ flex: 1 }}><Text style={styles.privacyTitle}>Local-first processing</Text><Text style={styles.privacyText}>The current PDF tools run on the device. PDF Pro does not expose placeholder OCR or fake cloud features.</Text></View></View>'''
new_settings = '''                <View style={styles.settingSwitchRow}><View style={styles.settingIcon}><Icon name="download-circle-outline" color="#2563EB" /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Auto-download</Text><Text style={styles.settingSub}>Save every result right after processing</Text></View><Switch value={prefs.autoSave} onValueChange={value => persistPrefs({ ...prefs, autoSave: value })} trackColor={{ false: '#D7DCE5', true: '#FDA4AF' }} thumbColor={prefs.autoSave ? BRAND : '#FFFFFF'} /></View>\n                <View style={styles.settingDivider} />\n                <SettingRow icon="shield-account-outline" title="Privacy policy" subtitle="Local processing, storage and data handling" action="View" onPress={() => Linking.openURL(PRIVACY_URL).catch(() => Alert.alert('Could not open privacy policy', PRIVACY_URL))} />\n              </View>\n              <View style={styles.privacyCard}><View style={styles.privacyIcon}><Icon name="shield-lock-outline" color="#059669" size={25} /></View><View style={{ flex: 1 }}><Text style={styles.privacyTitle}>Local-first processing</Text><Text style={styles.privacyText}>PDFs, images, signatures and passwords are processed on this device. This production build contains no advertising, analytics or cloud-processing SDK.</Text><Text style={[styles.privacyText, { marginTop: 7, fontWeight: '800' }]}>PDF Pro 1.5.1 · production</Text></View></View>'''
if old_settings not in s:
    raise SystemExit('settings anchor not found')
s = s.replace(old_settings, new_settings)
p.write_text(s)

# 2) Production app metadata and explicit permission blocking.
app_path = Path('app.json')
app = json.loads(app_path.read_text())
expo = app['expo']
expo['version'] = '1.5.1'
android = expo['android']
android['versionCode'] = 9
android['blockedPermissions'] = [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    'android.permission.SYSTEM_ALERT_WINDOW',
]
app_path.write_text(json.dumps(app, indent=2) + '\n')

# 3) Remove unused analytics/ads/purchases/media-library dependencies.
pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text())
for dep in [
    'expo-media-library',
    'react-native-google-mobile-ads',
    'react-native-purchases',
    'base64-js',
]:
    pkg.get('dependencies', {}).pop(dep, None)
# No native packages need exclusion anymore.
pkg.pop('expo', None)
pkg_path.write_text(json.dumps(pkg, indent=2) + '\n')

# 4) Remove obsolete screens/components so removed SDKs cannot accidentally return to the bundle.
for old in [
    'App.tsx',
    'ProApp.tsx',
    'components/AdBanner.tsx',
    'components/AdBanner.web.tsx',
    'components/Paywall.tsx',
    'components/Paywall.web.tsx',
]:
    Path(old).unlink(missing_ok=True)

# 5) Keep smoke test aligned with production version.
smoke_path = Path('scripts/smoke-emulator.sh')
smoke = smoke_path.read_text().replace('PDF-Pro-Tools-1.5.0.apk', 'PDF-Pro-Tools-1.5.1.apk')
smoke = smoke.replace('test "$INSTALLED_VERSION" = "1.5.0"', 'test "$INSTALLED_VERSION" = "1.5.1"')
smoke = smoke.replace('test "$INSTALLED_CODE" = "8"', 'test "$INSTALLED_CODE" = "9"')
smoke_path.write_text(smoke)

print('Production cleanup applied: 1.5.1 / code 9')

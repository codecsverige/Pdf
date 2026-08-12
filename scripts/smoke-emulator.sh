#!/usr/bin/env bash
set -euo pipefail

mkdir -p release-output
APK="release-output/PDF-Pro-Tools-1.4.1.apk"
BASELINE_APK="release-output/PDF-Pro-Tools-1.3.0-baseline.apk"
PACKAGE="com.codecsverige.pdf"

adb devices -l | tee release-output/adb-devices.txt
adb shell getprop sys.boot_completed | tee release-output/boot-completed.txt

# Reproduce the real user path: install the last working APK first,
# then update it in place with the new build.
adb install "$BASELINE_APK" | tee release-output/baseline-install-result.txt
grep -q 'Success' release-output/baseline-install-result.txt

adb install -r "$APK" | tee release-output/update-install-result.txt
grep -q 'Success' release-output/update-install-result.txt

INSTALLED_VERSION="$(adb shell dumpsys package "$PACKAGE" | grep -m1 'versionName=' | sed 's/.*versionName=//' | tr -d '\r')"
INSTALLED_CODE="$(adb shell dumpsys package "$PACKAGE" | grep -m1 'versionCode=' | sed -E 's/.*versionCode=([0-9]+).*/\1/' | tr -d '\r')"
echo "INSTALLED_VERSION=$INSTALLED_VERSION" | tee release-output/installed-version.txt
echo "INSTALLED_CODE=$INSTALLED_CODE" | tee -a release-output/installed-version.txt
test "$INSTALLED_VERSION" = "1.4.1"
test "$INSTALLED_CODE" = "6"

ADB_LOG="release-output/logcat-after-launch.txt"
adb logcat -c
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 | tee release-output/launch-result.txt
sleep 12

PID="$(adb shell pidof "$PACKAGE" | tr -d '\r' || true)"
echo "PID=$PID" | tee release-output/process.txt
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | tee release-output/window-focus.txt || true
adb logcat -d -t 2200 > "$ADB_LOG" || true

if [[ -z "$PID" ]]; then
  grep -Eai 'FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|ReactNative|Hermes|Expo|com\.codecsverige\.pdf|SoLoader|UnsatisfiedLinkError|Unable to start activity' "$ADB_LOG" \
    | tail -n 800 > release-output/startup-failure.txt || true
  cat release-output/startup-failure.txt || true
  exit 1
fi

if ! grep -q "$PACKAGE" release-output/window-focus.txt; then
  echo "Package is alive but not focused after launch." | tee release-output/focus-failure.txt
  exit 1
fi

adb logcat -d --pid="$PID" -t 900 > release-output/startup-logcat.txt || true
if grep -Eqi 'FATAL EXCEPTION|AndroidRuntime.*FATAL' release-output/startup-logcat.txt; then
  cat release-output/startup-logcat.txt
  exit 1
fi

capture_ui() {
  local name="$1"
  adb shell uiautomator dump "/sdcard/${name}.xml" >/dev/null
  adb pull "/sdcard/${name}.xml" "release-output/${name}.xml" >/dev/null
}

tap_accessibility_label() {
  local label="$1"
  local xml="$2"
  local xy
  xy="$(python3 - "$label" "$xml" <<'PY'
import re, sys, xml.etree.ElementTree as ET
label, path = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()
for node in root.iter('node'):
    if node.attrib.get('content-desc') == label:
        bounds = node.attrib.get('bounds', '')
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
        if m:
            x1,y1,x2,y2 = map(int, m.groups())
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            raise SystemExit(0)
raise SystemExit(1)
PY
)"
  adb shell input tap $xy
}

# Capture the corrected home dashboard for visual review.
adb exec-out screencap -p > release-output/home-dashboard.png
capture_ui home-dashboard

# Validate that the old decorative crown is gone and the replacement Settings action works.
tap_accessibility_label "Open settings" release-output/home-dashboard.xml
sleep 2
capture_ui settings-screen
grep -q 'text="Settings"' release-output/settings-screen.xml
echo 'HEADER_SETTINGS_ACTION=PASS' | tee release-output/dashboard-actions.txt

# Back from Settings must return Home instead of closing the app.
adb shell input keyevent 4
sleep 2
capture_ui home-after-settings

# Validate the formerly decorative search-side action now opens All Tools.
tap_accessibility_label "Open all PDF tools" release-output/home-after-settings.xml
sleep 2
capture_ui all-tools-screen
grep -q 'text="All tools"' release-output/all-tools-screen.xml
echo 'ALL_TOOLS_ACTION=PASS' | tee -a release-output/dashboard-actions.txt

adb shell input keyevent 4
sleep 2

# Regression test for the user's back-button bug. On the home screen the
# first BACK press must be intercepted by React Native and must not exit.
adb shell input keyevent 4
sleep 2
PID_AFTER_BACK="$(adb shell pidof "$PACKAGE" | tr -d '\r' || true)"
echo "PID_AFTER_FIRST_BACK=$PID_AFTER_BACK" | tee release-output/back-button.txt
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | tee -a release-output/back-button.txt || true
test -n "$PID_AFTER_BACK"
grep -q "$PACKAGE" release-output/back-button.txt

# Capture final home screen after navigation/back tests.
adb exec-out screencap -p > release-output/home-dashboard-after-tests.png

echo 'BASELINE_INSTALL=PASS' | tee release-output/validated.txt
echo 'UPDATE_INSTALL=PASS' | tee -a release-output/validated.txt
echo 'VERSION_UPGRADE=PASS' | tee -a release-output/validated.txt
echo 'APP_LAUNCH=PASS' | tee -a release-output/validated.txt
echo 'PROCESS_ALIVE=PASS' | tee -a release-output/validated.txt
echo 'HEADER_SETTINGS_ACTION=PASS' | tee -a release-output/validated.txt
echo 'ALL_TOOLS_ACTION=PASS' | tee -a release-output/validated.txt
echo 'FIRST_BACK_KEEPS_APP_OPEN=PASS' | tee -a release-output/validated.txt

#!/usr/bin/env bash
set -euo pipefail

mkdir -p release-output
APK="release-output/PDF-Pro-Tools-1.3.0.apk"
BASELINE_APK="release-output/PDF-Pro-Tools-1.2.0-baseline.apk"
PACKAGE="com.codecsverige.pdf"

adb devices -l | tee release-output/adb-devices.txt
adb shell getprop sys.boot_completed | tee release-output/boot-completed.txt

# Reproduce the user's real path: first install the previously working APK,
# then update it in-place with the new build.
adb install "$BASELINE_APK" | tee release-output/baseline-install-result.txt
grep -q 'Success' release-output/baseline-install-result.txt

adb install -r "$APK" | tee release-output/update-install-result.txt
grep -q 'Success' release-output/update-install-result.txt

INSTALLED_VERSION="$(adb shell dumpsys package "$PACKAGE" | grep -m1 'versionName=' | sed 's/.*versionName=//' | tr -d '\r')"
INSTALLED_CODE="$(adb shell dumpsys package "$PACKAGE" | grep -m1 'versionCode=' | sed -E 's/.*versionCode=([0-9]+).*/\1/' | tr -d '\r')"
echo "INSTALLED_VERSION=$INSTALLED_VERSION" | tee release-output/installed-version.txt
echo "INSTALLED_CODE=$INSTALLED_CODE" | tee -a release-output/installed-version.txt
test "$INSTALLED_VERSION" = "1.3.0"
test "$INSTALLED_CODE" = "4"

aDB_LOG="release-output/logcat-after-launch.txt"
adb logcat -c
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 | tee release-output/launch-result.txt
sleep 12

PID="$(adb shell pidof "$PACKAGE" | tr -d '\r' || true)"
echo "PID=$PID" | tee release-output/process.txt
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | tee release-output/window-focus.txt || true
adb logcat -d -t 2200 > "$aDB_LOG" || true

if [[ -z "$PID" ]]; then
  grep -Eai 'FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|ReactNative|Hermes|Expo|com\.codecsverige\.pdf|SoLoader|UnsatisfiedLinkError|Unable to start activity' "$aDB_LOG" \
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

echo 'BASELINE_INSTALL=PASS' | tee release-output/validated.txt
echo 'UPDATE_INSTALL=PASS' | tee -a release-output/validated.txt
echo 'VERSION_UPGRADE=PASS' | tee -a release-output/validated.txt
echo 'APP_LAUNCH=PASS' | tee -a release-output/validated.txt
echo 'PROCESS_ALIVE=PASS' | tee -a release-output/validated.txt

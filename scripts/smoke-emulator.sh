#!/usr/bin/env bash
set -euo pipefail

mkdir -p release-output
APK="release-output/PDF-Pro-Tools-1.2.0.apk"
PACKAGE="com.codecsverige.pdf"

adb devices -l | tee release-output/adb-devices.txt
adb shell getprop sys.boot_completed | tee release-output/boot-completed.txt

adb install -r "$APK" | tee release-output/install-result.txt
grep -q 'Success' release-output/install-result.txt

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

echo 'APK_INSTALL=PASS' | tee release-output/validated.txt
echo 'APP_LAUNCH=PASS' | tee -a release-output/validated.txt
echo 'PROCESS_ALIVE=PASS' | tee -a release-output/validated.txt

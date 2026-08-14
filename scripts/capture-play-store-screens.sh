#!/usr/bin/env bash
set -euo pipefail

APK="${1:-play-store-input/universal-from-aab.apk}"
PACKAGE="com.codecsverige.pdf"
OUT="play-store-captures"
mkdir -p "$OUT"

adb install -r "$APK" >/tmp/install.txt
cat /tmp/install.txt
grep -q 'Success' /tmp/install.txt
adb shell am force-stop "$PACKAGE" || true
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/tmp/launch.txt
sleep 8

capture_ui() {
  local name="$1"
  adb shell uiautomator dump "/sdcard/${name}.xml" >/dev/null
  adb pull "/sdcard/${name}.xml" "$OUT/${name}.xml" >/dev/null
}

shot() {
  local name="$1"
  adb exec-out screencap -p > "$OUT/${name}.png"
  capture_ui "$name"
}

tap_text() {
  local label="$1"
  local dump="$OUT/_tap.xml"
  for attempt in 1 2 3 4; do
    adb shell uiautomator dump /sdcard/_tap.xml >/dev/null || true
    adb pull /sdcard/_tap.xml "$dump" >/dev/null || true
    local xy
    xy="$(python3 - "$label" "$dump" <<'PY'
import re, sys, xml.etree.ElementTree as ET
label,path=sys.argv[1],sys.argv[2]
try: root=ET.parse(path).getroot()
except Exception: raise SystemExit(1)
# Prefer exact visible text.
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if text == label:
        b=node.attrib.get('bounds','')
        m=re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',b)
        if m:
            x1,y1,x2,y2=map(int,m.groups())
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            raise SystemExit(0)
raise SystemExit(1)
PY
)" || true
    if [ -n "${xy:-}" ]; then
      adb shell input tap $xy
      sleep 2
      return 0
    fi
    sleep 1
  done
  echo "Could not find text: $label" >&2
  cat "$dump" >&2 || true
  return 1
}

tap_desc() {
  local label="$1"
  local dump="$OUT/_tap.xml"
  adb shell uiautomator dump /sdcard/_tap.xml >/dev/null
  adb pull /sdcard/_tap.xml "$dump" >/dev/null
  local xy
  xy="$(python3 - "$label" "$dump" <<'PY'
import re, sys, xml.etree.ElementTree as ET
label,path=sys.argv[1],sys.argv[2]
root=ET.parse(path).getroot()
for node in root.iter('node'):
    if node.attrib.get('content-desc') == label:
        b=node.attrib.get('bounds','')
        m=re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',b)
        if m:
            x1,y1,x2,y2=map(int,m.groups())
            print(f'{(x1+x2)//2} {(y1+y2)//2}')
            raise SystemExit(0)
raise SystemExit(1)
PY
)"
  adb shell input tap $xy
  sleep 2
}

back_home() {
  adb shell input keyevent 4
  sleep 2
}

# 1) Real home dashboard
shot "01-home"

# 2) Real Merge workspace
tap_text "Merge"
shot "02-merge"
back_home

# 3) Real Compress workspace
tap_text "Compress"
shot "03-compress"
back_home

# 4) Real Sign workspace, then scroll enough to expose signature controls
tap_text "Sign"
shot "04-sign-top"
adb shell input swipe 240 760 240 310 500
sleep 2
shot "05-sign-controls"
back_home

# 5) Real Protect workspace: navigate via Tools > Secure > Protect
# Back may remain inside Sign after the scroll; ensure Home.
adb shell input keyevent 4 || true
sleep 1
tap_desc "Tools"
tap_text "Secure"
tap_text "Protect"
shot "06-protect"
back_home

# 6) Real Settings / local-first privacy screen
tap_desc "Home" || true
sleep 1
tap_desc "Open settings"
shot "07-settings"

# Verify screenshots are real and non-empty.
python3 - <<'PY'
from pathlib import Path
from PIL import Image, ImageChops
files=sorted(Path('play-store-captures').glob('*.png'))
assert len(files) >= 7, files
for p in files:
    im=Image.open(p)
    assert im.width >= 320 and im.height >= 320
    assert p.stat().st_size > 10000, (p,p.stat().st_size)
# Ensure screenshots are not repeats.
unique=[]
for p in files:
    im=Image.open(p).convert('RGB')
    thumb=im.resize((64,64))
    sig=thumb.tobytes()
    assert sig not in unique, f'duplicate screenshot: {p}'
    unique.append(sig)
print('CAPTURE_COUNT=',len(files))
print('REAL_DISTINCT_SCREENSHOTS=PASS')
PY

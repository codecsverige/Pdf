#!/usr/bin/env bash
set -euo pipefail

APK="${1:-play-store-input/universal-from-aab.apk}"
PACKAGE="com.codecsverige.pdf"
OUT="play-store-captures"
mkdir -p "$OUT"

adb install -r "$APK" >/tmp/install.txt
cat /tmp/install.txt
grep -q 'Success' /tmp/install.txt

restart_app() {
  adb shell am force-stop "$PACKAGE" || true
  adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/tmp/launch.txt
  sleep 5
}

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

tap_desc() {
  local label="$1"
  local dump="$OUT/_tap.xml"
  adb shell uiautomator dump /sdcard/_tap.xml >/dev/null
  adb pull /sdcard/_tap.xml "$dump" >/dev/null
  local xy
  xy="$(python3 - "$label" "$dump" <<'PY'
import re,sys,xml.etree.ElementTree as ET
label,path=sys.argv[1],sys.argv[2]
root=ET.parse(path).getroot()
for n in root.iter('node'):
    if n.attrib.get('content-desc') == label:
        m=re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',n.attrib.get('bounds',''))
        if m:
            x1,y1,x2,y2=map(int,m.groups()); print(f'{(x1+x2)//2} {(y1+y2)//2}'); raise SystemExit
raise SystemExit(1)
PY
)"
  adb shell input tap $xy
  sleep 2
}

tap_clickable_containing() {
  local label="$1"
  local dump="$OUT/_tap.xml"
  for attempt in 1 2 3 4 5; do
    adb shell uiautomator dump /sdcard/_tap.xml >/dev/null || true
    adb pull /sdcard/_tap.xml "$dump" >/dev/null || true
    local xy
    xy="$(python3 - "$label" "$dump" <<'PY'
import re,sys,xml.etree.ElementTree as ET
label,path=sys.argv[1],sys.argv[2]
try: root=ET.parse(path).getroot()
except Exception: raise SystemExit(1)
for n in root.iter('node'):
    hay=(n.attrib.get('text','')+' '+n.attrib.get('content-desc','')).strip()
    if label.lower() in hay.lower() and n.attrib.get('clickable') == 'true':
        m=re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',n.attrib.get('bounds',''))
        if m:
            x1,y1,x2,y2=map(int,m.groups())
            if x2>x1 and y2>y1:
                print(f'{(x1+x2)//2} {(y1+y2)//2}'); raise SystemExit
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
  echo "Could not tap clickable containing: $label" >&2
  cat "$dump" >&2 || true
  return 1
}

open_tool_search() {
  local query="$1"
  local label="$2"
  restart_app
  tap_clickable_containing "Search PDF tools"
  adb shell input text "$query"
  sleep 2
  tap_clickable_containing "$label"
  sleep 2
}

restart_app
shot "01-home"

open_tool_search merge Merge
shot "02-merge"

open_tool_search compress Compress
shot "03-compress"

open_tool_search sign Sign
shot "04-sign-top"
adb shell input swipe 240 760 240 310 500
sleep 2
shot "05-sign-controls"

open_tool_search protect Protect
shot "06-protect"

restart_app
tap_desc "Open settings"
shot "07-settings"

python3 - <<'PY'
from pathlib import Path
from PIL import Image
files=sorted(Path('play-store-captures').glob('*.png'))
assert len(files) >= 7, files
sigs=[]
for p in files:
    im=Image.open(p).convert('RGB')
    assert im.width >= 320 and im.height >= 320
    assert p.stat().st_size > 10000, (p,p.stat().st_size)
    sig=im.resize((64,64)).tobytes()
    assert sig not in sigs, f'duplicate screenshot: {p}'
    sigs.append(sig)
print('CAPTURE_COUNT=',len(files))
print('REAL_DISTINCT_SCREENSHOTS=PASS')
PY

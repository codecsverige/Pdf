#!/usr/bin/env bash
set -euo pipefail

# Signs a production AAB only when the keystore is the permanent Google Play
# upload key already registered for com.codecsverige.pdf.
# The private key and passwords must never be committed to this repository.

EXPECTED_SHA1="3F:02:EF:1A:D8:6B:43:40:F6:FD:BF:72:B5:B2:7E:32:30:2C:0A:9D"
EXPECTED_PACKAGE="com.codecsverige.pdf"

INPUT_AAB="${1:-}"
OUTPUT_AAB="${2:-}"
KEYSTORE_PATH="${PDFPRO_KEYSTORE_PATH:-}"
STORE_PASSWORD="${PDFPRO_KEYSTORE_PASSWORD:-}"
KEY_ALIAS="${PDFPRO_KEY_ALIAS:-}"
KEY_PASSWORD="${PDFPRO_KEY_PASSWORD:-}"

if [[ -z "$INPUT_AAB" || -z "$OUTPUT_AAB" ]]; then
  echo "Usage: PDFPRO_KEYSTORE_PATH=... PDFPRO_KEYSTORE_PASSWORD=... PDFPRO_KEY_ALIAS=... PDFPRO_KEY_PASSWORD=... $0 input.aab output.aab" >&2
  exit 2
fi

for name in KEYSTORE_PATH STORE_PASSWORD KEY_ALIAS KEY_PASSWORD; do
  if [[ -z "${!name}" ]]; then
    echo "Missing required signing value: $name" >&2
    exit 2
  fi
done

test -s "$INPUT_AAB"
test -s "$KEYSTORE_PATH"

ACTUAL_SHA1="$(keytool -list -v \
  -keystore "$KEYSTORE_PATH" \
  -storepass "$STORE_PASSWORD" \
  -alias "$KEY_ALIAS" 2>/dev/null \
  | sed -n 's/^[[:space:]]*SHA1: //p' | head -n 1)"

if [[ "$ACTUAL_SHA1" != "$EXPECTED_SHA1" ]]; then
  echo "REFUSING TO SIGN: wrong PDF Pro upload key." >&2
  echo "Expected SHA1: $EXPECTED_SHA1" >&2
  echo "Actual SHA1:   ${ACTUAL_SHA1:-unknown}" >&2
  exit 1
fi

cp "$INPUT_AAB" "$OUTPUT_AAB"
jarsigner \
  -keystore "$KEYSTORE_PATH" \
  -storepass "$STORE_PASSWORD" \
  -keypass "$KEY_PASSWORD" \
  -sigalg SHA256withRSA \
  -digestalg SHA-256 \
  "$OUTPUT_AAB" "$KEY_ALIAS"

jarsigner -verify "$OUTPUT_AAB" >/dev/null
SIGNED_SHA1="$(keytool -printcert -jarfile "$OUTPUT_AAB" 2>/dev/null | sed -n 's/^[[:space:]]*SHA1: //p' | head -n 1)"

if [[ "$SIGNED_SHA1" != "$EXPECTED_SHA1" ]]; then
  echo "Signed AAB certificate mismatch. Refusing output." >&2
  rm -f "$OUTPUT_AAB"
  exit 1
fi

printf 'PDF Pro production signing verified.\nPackage: %s\nCertificate SHA1: %s\nOutput: %s\n' \
  "$EXPECTED_PACKAGE" "$SIGNED_SHA1" "$OUTPUT_AAB"

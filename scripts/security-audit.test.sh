#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT="$ROOT_DIR/scripts/security-audit.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mc-security-audit.XXXXXX")"
HARDENED_ENV="$TMP_DIR/hardened.env"
INSECURE_ENV="$TMP_DIR/insecure.env"

cleanup() {
  rm -f "$HARDENED_ENV" "$INSECURE_ENV"
  rmdir "$TMP_DIR"
}
trap cleanup EXIT

cat > "$HARDENED_ENV" <<'EOF'
PATH=/definitely/not/a/real/path
BASH_ENV=/tmp/should-not-be-loaded
AUTH_PASS="a secure # password"
API_KEY=test-api-key
MC_ALLOWED_HOSTS=127.0.0.1,localhost
MC_ALLOW_ANY_HOST=0
MC_COOKIE_SECURE=1
MC_COOKIE_SAMESITE=strict
MC_ENABLE_HSTS=1
MC_DISABLE_RATE_LIMIT=0
EOF
chmod 600 "$HARDENED_ENV"

audit_output=""
if ! audit_output="$(bash "$AUDIT" --env-file "$HARDENED_ENV" --strict)"; then
  echo 'Expected hardened --strict audit to pass, but it failed:' >&2
  printf '%s\n' "$audit_output" >&2
  exit 1
fi
grep -Fq '[PASS] AUTH_PASS is set to a non-default value (19 chars)' <<< "$audit_output"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    grep -Fq '[INFO] .env POSIX mode check skipped on Windows; verify NTFS ACLs separately' <<< "$audit_output"
    grep -Fq '=== Security Score: 7 / 7 ===' <<< "$audit_output"
    ;;
  *)
    grep -Fq '[PASS] .env permissions are 600 (owner read/write only)' <<< "$audit_output"
    grep -Fq '=== Security Score: 8 / 8 ===' <<< "$audit_output"
    ;;
esac
grep -Fq 'All checks passed!' <<< "$audit_output"

cat > "$INSECURE_ENV" <<'EOF'
AUTH_PASS=password
API_KEY=generate-a-random-key
MC_ALLOW_ANY_HOST=1
MC_DISABLE_RATE_LIMIT=1
EOF
chmod 600 "$INSECURE_ENV"

if bash "$AUDIT" --env-file "$INSECURE_ENV" --strict >/dev/null 2>&1; then
  echo 'Expected --strict to fail when the audit reports security findings' >&2
  exit 1
fi

if bash "$AUDIT" --unknown >/dev/null 2>&1; then
  echo 'Expected an unknown option to fail' >&2
  exit 1
fi

echo 'security-audit tests passed'

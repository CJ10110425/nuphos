#!/usr/bin/env bash
# Loads a Nuphos-bound Mercury API token into ~/.mercury/nuphos.env (mode 600),
# in the same format save-token.sh writes, without printing it:
#   setup-credentials.sh <teamId> <bindingId>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: setup-credentials.sh <teamId> <bindingId>" >&2
  exit 2
fi

team_id="$1"
binding_id="$2"
base="${NUPHOS_BACKEND_URL:-${NUPHOS_API_URL:-https://api.nuphos.ai}}"
base="${base%/}"

urlencode() {
  python3 - "$1" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../../_runtime/scripts/nuphos-token.sh
source "$script_dir/../../_runtime/scripts/nuphos-token.sh"
auth_token="$(nuphos_token)" || exit 1

team_enc="$(urlencode "$team_id")"
binding_enc="$(urlencode "$binding_id")"

# Conversation principals only; the backend hands the token out only when this
# binding is selected for the current conversation. No team-scoped fallback.
path="/teams/${team_enc}/mercury-integrations/${binding_enc}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Capture the HTTP status rather than -f so 403 (not selected for this
# conversation) vs 404 (binding deleted) stay distinguishable.
status="$(curl -sSL -o "$tmp" -w '%{http_code}' \
  --connect-timeout 10 \
  --max-time 30 \
  --retry 3 \
  --retry-delay 1 \
  --retry-connrefused \
  -H @<(printf 'Authorization: Bearer %s\n' "${auth_token}") \
  -H "Accept: application/json" \
  "${base}${path}")"

if [ "$status" != "200" ]; then
  echo "Credential fetch failed with HTTP $status:" >&2
  cat "$tmp" >&2
  exit 1
fi

mkdir -p "$HOME/.mercury"
chmod 700 "$HOME/.mercury"
dst="$HOME/.mercury/nuphos.env"

# 600 before writing, so the token never exists under a permissive umask.
touch "$dst"
chmod 600 "$dst"

python3 -I - "$tmp" "$dst" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding="utf-8"))
token = str(data.get("apiToken") or "").strip()
if not token or any(c.isspace() for c in token):
    raise SystemExit("Credentials response missing apiToken; re-bind the Mercury integration.")
# Mercury tokens carry a `secret-token:` prefix that is part of the bearer value.
if not token.startswith("secret-token:"):
    token = "secret-token:" + token
base_url = str(data.get("apiBaseUrl") or "https://api.mercury.com/api/v1")
with open(dst, "w", encoding="utf-8") as f:
    f.write("unset MERCURY_API_TOKEN\n")
    f.write(f"export MERCURY_API_TOKEN={shlex.quote(token)}\n")
    f.write(f"export MERCURY_API_BASE_URL={shlex.quote(base_url)}\n")
    f.write(f"export MERCURY_BINDING_ID={shlex.quote(str(data.get('bindingId') or ''))}\n")
PY

chmod 600 "$dst"
echo "Wrote Mercury credentials to ~/.mercury/nuphos.env"

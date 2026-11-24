#!/usr/bin/env bash
# Moves a Mercury API token from the file a secure credential card wrote into
# ~/.mercury/nuphos.env (mode 600), without printing it:
#   save-token.sh <path-from-the-card-answer>
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: save-token.sh <path-to-token-file>" >&2
  exit 2
fi

src="$1"
if [ ! -r "$src" ]; then
  echo "Cannot read $src; ask the user for the token again with a credential card." >&2
  exit 1
fi

mkdir -p "$HOME/.mercury"
chmod 700 "$HOME/.mercury"
dst="$HOME/.mercury/nuphos.env"
touch "$dst"
chmod 600 "$dst"

python3 -I - "$src" "$dst" <<'PY'
import shlex, sys
src, dst = sys.argv[1], sys.argv[2]
token = open(src, encoding="utf-8").read().strip()
if token.lower().startswith("bearer "):
    token = token[7:].strip()
if not token or any(c.isspace() for c in token):
    raise SystemExit("The saved value is empty or has spaces; it is not a Mercury API token.")
# Mercury tokens carry a `secret-token:` prefix that is part of the bearer value.
if not token.startswith("secret-token:"):
    token = "secret-token:" + token
with open(dst, "w", encoding="utf-8") as f:
    f.write("unset MERCURY_API_TOKEN\n")
    f.write(f"export MERCURY_API_TOKEN={shlex.quote(token)}\n")
    f.write("export MERCURY_API_BASE_URL=https://api.mercury.com/api/v1\n")
PY

chmod 600 "$dst"
echo "Wrote Mercury credentials to ~/.mercury/nuphos.env"

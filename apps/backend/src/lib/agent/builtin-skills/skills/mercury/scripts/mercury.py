#!/usr/bin/env python3
"""Read-only Mercury API client: accounts, cards and transactions.

Usage (run with `python3 -I`):
  mercury.py ping
  mercury.py accounts
  mercury.py cards
  mercury.py transactions [--days 90 | --start YYYY-MM-DD [--end YYYY-MM-DD]]
                          [--account ID ...] [--source global|accounts] [--out FILE]

The token comes from MERCURY_API_TOKEN or ~/.mercury/nuphos.env and is only
ever sent in a request header, never printed or passed as an argument.
"""

import argparse
import datetime as dt
import json
import os
import shlex
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://api.mercury.com/api/v1"
ENV_FILE = os.path.join(os.path.expanduser("~"), ".mercury", "nuphos.env")
SKIPPED_STATUSES = {"cancelled", "failed", "reversed", "blocked"}


def load_settings():
    values = {k: os.environ[k] for k in ("MERCURY_API_TOKEN", "MERCURY_API_BASE_URL") if os.environ.get(k)}
    if "MERCURY_API_TOKEN" not in values and os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            parts = shlex.split(line.strip())
            if len(parts) == 2 and parts[0] == "export" and "=" in parts[1]:
                key, value = parts[1].split("=", 1)
                values.setdefault(key, value)
    token = values.get("MERCURY_API_TOKEN", "")
    if not token:
        sys.exit(
            "No Mercury token. Run the setupCommand of a Mercury binding listed in the "
            "credential section; with none listed, ask the user with request_user_decision "
            "(category credential, secretName MERCURY_API_TOKEN), then run save-token.sh."
        )
    if not token.startswith("secret-token:"):
        token = "secret-token:" + token
    return token, values.get("MERCURY_API_BASE_URL", DEFAULT_BASE).rstrip("/")


TOKEN, BASE = None, None


def get(path, params=None):
    """GET only: this skill never sends a request that changes anything."""
    query = urllib.parse.urlencode(
        [(k, v) for k, v in (params or {}).items() if v is not None], doseq=True
    )
    url = f"{BASE}{path}" + (f"?{query}" if query else "")
    for attempt in range(6):
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", f"Bearer {TOKEN}")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", "replace")[:500]
            if err.code == 429 and attempt < 5:
                time.sleep(float(err.headers.get("Retry-After") or 2 ** attempt))
                continue
            hint = {
                401: "token rejected: wrong, revoked or expired; ask the user for a new read-only token",
                403: "token lacks access to this resource",
                404: "not found (check the account id)",
            }.get(err.code, "request failed")
            sys.exit(f"Mercury GET {path} -> HTTP {err.code} ({hint}): {body}")
    sys.exit(f"Mercury GET {path} kept answering 429; try again later.")


def paged(path, key, params):
    """Cursor pagination used by /accounts, /cards and /transactions."""
    params = dict(params, limit=1000)
    while True:
        data = get(path, params)
        yield from data.get(key) or []
        nxt = (data.get("page") or {}).get("nextPage")
        if not nxt or not data.get(key):
            return
        params["start_after"] = nxt


def list_accounts():
    return list(paged("/accounts", "accounts", {}))


def list_cards():
    return list(paged("/cards", "cards", {}))


def last4(number):
    digits = "".join(c for c in str(number or "") if c.isdigit())
    return digits[-4:] if digits else None


def slim(tx, account_id=None):
    details = tx.get("details") or {}
    card_id = (
        tx.get("cardId")
        or (details.get("debitCardInfo") or {}).get("id")
        or (details.get("creditCardInfo") or {}).get("id")
    )
    merchant = tx.get("merchant") or {}
    return {
        "id": tx.get("id"),
        "accountId": tx.get("accountId") or account_id,
        "amount": tx.get("amount"),
        "status": tx.get("status"),
        "kind": tx.get("kind"),
        "createdAt": tx.get("createdAt"),
        "postedAt": tx.get("postedAt"),
        "counterpartyName": tx.get("counterpartyName"),
        "counterpartyNickname": tx.get("counterpartyNickname"),
        "bankDescription": tx.get("bankDescription"),
        "mercuryCategory": tx.get("mercuryCategory") or merchant.get("category"),
        "merchantCategoryCode": merchant.get("categoryCode"),
        "cardId": card_id,
    }


def account_transactions(account_id, start, end):
    """Per-account endpoint: offset pagination, newest first, with a total."""
    offset = 0
    while True:
        data = get(
            f"/account/{urllib.parse.quote(account_id)}/transactions",
            {"start": start, "end": end, "limit": 1000, "offset": offset, "order": "desc"},
        )
        batch = data.get("transactions") or []
        yield from (slim(tx, account_id) for tx in batch)
        offset += len(batch)
        if not batch or offset >= int(data.get("total") or 0):
            return


def cmd_transactions(args):
    end = args.end or dt.date.today().isoformat()
    start = args.start or (dt.date.fromisoformat(end) - dt.timedelta(days=args.days)).isoformat()
    accounts = {a["id"]: a for a in list_accounts()}
    wanted = args.account or [
        a["id"] for a in accounts.values() if a.get("status") == "active" and a.get("type") == "mercury"
    ]
    if args.source == "global":
        params = {"start": start, "end": end}
        if args.account:
            params["accountId"] = args.account
        txs = [slim(tx) for tx in paged("/transactions", "transactions", params)]
    else:
        txs = [tx for acc in wanted for tx in account_transactions(acc, start, end)]
    cards = {c.get("id"): c for c in list_cards()}
    for tx in txs:
        card = cards.get(tx["cardId"]) or {}
        tx["cardLastFour"] = card.get("lastFour") or card.get("lastFourDigits")
        acc = accounts.get(tx["accountId"]) or {}
        tx["accountName"] = acc.get("nickname") or acc.get("name") or (
            "Mercury IO credit" if (tx.get("kind") or "").startswith("creditCard") else None
        )
        tx["accountLast4"] = last4(acc.get("accountNumber"))
    kept = [tx for tx in txs if tx.get("status") not in SKIPPED_STATUSES]
    result = {"start": start, "end": end, "source": args.source, "count": len(kept), "transactions": kept}
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"Wrote {len(kept)} transactions ({start}..{end}) to {args.out}")
    else:
        json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
        print()


def main():
    global TOKEN, BASE
    parser = argparse.ArgumentParser(description="Read-only Mercury API client")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping", help="check the token with one small read")
    sub.add_parser("accounts", help="list accounts (account numbers masked to the last four)")
    sub.add_parser("cards", help="list cards with their last four digits")
    tx = sub.add_parser("transactions", help="list transactions in a date range")
    tx.add_argument("--days", type=int, default=90)
    tx.add_argument("--start")
    tx.add_argument("--end")
    tx.add_argument("--account", action="append", help="account id; repeatable (default: all active)")
    # Mercury IO credit-card charges belong to no listed account, so only `global` returns them.
    tx.add_argument("--source", choices=["global", "accounts"], default="global")
    tx.add_argument("--out")
    args = parser.parse_args()
    TOKEN, BASE = load_settings()

    if args.cmd == "ping":
        data = get("/accounts", {"limit": 1})
        print(f"Mercury token OK ({len(data.get('accounts') or [])} account visible on the first page)")
    elif args.cmd == "accounts":
        for a in list_accounts():
            print(json.dumps({
                "id": a.get("id"), "name": a.get("nickname") or a.get("name"), "kind": a.get("kind"),
                "type": a.get("type"), "status": a.get("status"), "accountLast4": last4(a.get("accountNumber")),
                "currentBalance": a.get("currentBalance"),
            }, ensure_ascii=False))
    elif args.cmd == "cards":
        for c in list_cards():
            print(json.dumps({
                "id": c.get("id"), "lastFour": c.get("lastFour"), "nameOnCard": c.get("nameOnCard"),
                "nickname": c.get("nickname"), "kind": c.get("kind"), "type": c.get("type"),
                "status": c.get("status"), "accountId": c.get("accountId"),
            }, ensure_ascii=False))
    else:
        cmd_transactions(args)


if __name__ == "__main__":
    main()

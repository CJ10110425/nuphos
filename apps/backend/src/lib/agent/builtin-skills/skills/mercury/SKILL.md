---
name: mercury
description: "Read a Mercury business bank account (read-only): accounts, cards and transactions, and find recurring charges to audit subscriptions. Use for Mercury spend, card or subscription questions."
---

# mercury

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill to read a team's [Mercury](https://mercury.com) bank accounts:
balances, cards and transactions, and to find the charges that repeat — the
subscriptions a team pays for. **The skill is read-only.** Its client only
sends `GET`; never move money, create recipients or change cards through it,
even if the token would allow it.

Bank data is private. Read only the date range the request needs, report the
merchant, amount, date and card's last four digits, and never print full
account or routing numbers (the scripts mask accounts to their last four).

## Getting a token

Nuphos has no Mercury connector yet, so the token comes from the user through
a secure input card, never through chat:

1. Ask for it with `request_user_decision`, category `credential`,
   `secretName: MERCURY_API_TOKEN`. In the body, ask for a **Read Only** token
   from Mercury → Settings → API Tokens (read-only tokens need no IP allow-list;
   read-write tokens do, and this skill does not need one).
2. The answer gives the path of a file holding the value. Move it into this
   session's env file without reading it yourself:

   ```bash
   bash skills/mercury/scripts/save-token.sh <path-from-the-answer>
   python3 -I skills/mercury/scripts/mercury.py ping
   ```

`save-token.sh` writes `~/.mercury/nuphos.env` (mode 600) with
`MERCURY_API_TOKEN` (always carrying Mercury's `secret-token:` prefix) and
`MERCURY_API_BASE_URL`. `mercury.py` reads that file itself, so there is
nothing to `source`, and the token never appears on a command line. If
`~/.mercury/nuphos.env` already exists in this session, skip the card.

A 401 means the token is wrong, revoked or expired: ask for a new one with a
new card. Mercury deletes tokens that go unused for a long time.

## Reading data

```bash
M="python3 -I skills/mercury/scripts/mercury.py"
$M accounts        # id, name, kind, type, status, accountLast4, currentBalance
$M cards           # id, lastFour, nameOnCard, kind (debit/credit), type, status, accountId
$M transactions --days 90 --out ~/mercury-tx.json
$M transactions --start 2026-08-01 --end 2026-10-31 --account <accountId> --out ~/mercury-tx.json
```

`transactions` reads every active Mercury account by default, drops cancelled,
failed, reversed and blocked rows, and adds `cardLastFour`, `accountName` and
`accountLast4` to each row. Write it to a file under `~` with `--out` rather
than dumping hundreds of rows into the conversation.

`--source global` reads `GET /transactions` across all accounts instead of one
account at a time. Use it when card spend you expect is missing (for example
Mercury IO credit card charges), and compare the two counts.

API facts behind the scripts (from docs.mercury.com/reference):

| What | Endpoint | Paging |
| --- | --- | --- |
| Accounts | `GET /accounts` | `limit` ≤1000, cursor `start_after` = `page.nextPage` |
| One account's transactions | `GET /account/{id}/transactions` | `limit` ≤1000 + `offset`; response `total`; `start`/`end` (YYYY-MM-DD, default last 30 days), `status`, `search`, `order` |
| All transactions | `GET /transactions` | cursor; `start`, `end`, `accountId[]`, `cardId[]`, `status[]` |
| Cards | `GET /cards` | cursor; last four digits in `lastFour` |

Base URL `https://api.mercury.com/api/v1`, header
`Authorization: Bearer secret-token:…`. A transaction's card is `cardId`
(card payments and refunds only). Spending is expected as a negative `amount`;
check the sign on the first run and pass `--debit-sign positive` to the
detector if Mercury returns debits as positive numbers.

## Finding recurring charges (subscription audit)

```bash
python3 -I skills/mercury/scripts/mercury.py transactions --days 90 --out ~/mercury-tx.json
python3 -I skills/mercury/scripts/detect-recurring.py ~/mercury-tx.json          # Markdown table
python3 -I skills/mercury/scripts/detect-recurring.py ~/mercury-tx.json --json   # for further work
```

The detector groups charges by normalized merchant name (order ids and store
numbers removed) and amount (within `--tolerance`, default 5%, so a small tax
or price change stays in one group), then keeps a group only when its dates
repeat weekly, biweekly, monthly, quarterly or yearly. For each it reports
merchant, amount, cadence, count, dates, last and next expected charge, card
last four, account and a confidence (`high` from three charges, `medium` from
two).

It leaves out, and counts by reason:

- credits, refunds and cancelled/failed rows;
- transfers, deposits, interest, wire and FX fees (`kind`);
- card-bill payments (Mercury IO, "credit card payment", autopay, payoff);
- top-ups and prepaid loads (top up, reload, add funds, buy credits, 儲值);
- single charges, which cannot show a rhythm.

Merchants charged three or more times in clearly varying amounts (cloud
usage, ads, API credits) are listed separately as **usage-based**: they are
real recurring costs but not fixed subscriptions, so say so rather than
folding them into the subscription total.

Limits to state when you report: 90 days shows a yearly or quarterly plan at
most once, so it is missed; a monthly plan billed on the 31st may land in
the `medium` group; a merchant whose name changes between charges splits in
two. Present the table, the estimated monthly total and the usage-based list,
and let the user confirm which items are subscriptions.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | A parameter is invalid (date format, or `start_after` with `end_before`). |
| 401 | Token rejected: ask for a new one. Do not retry. |
| 403 | The token's scope does not cover this resource (a Custom token). |
| 404 | The account id does not exist for this token. |
| 429 | Rate limited; the client backs off and retries up to five times. |

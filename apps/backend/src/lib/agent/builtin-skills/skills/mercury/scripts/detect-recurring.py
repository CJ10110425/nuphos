#!/usr/bin/env python3
"""Find recurring charges (likely subscriptions) in a Mercury transactions file.

Usage (run with `python3 -I`):
  detect-recurring.py TRANSACTIONS.json [--json] [--tolerance 0.05] [--debit-sign negative|positive]

TRANSACTIONS.json is what `mercury.py transactions --out` writes (or a bare
list of Mercury transactions). Charges are grouped by normalized merchant and
amount (within --tolerance), then kept only when their dates repeat on a
weekly, biweekly, monthly, quarterly or yearly rhythm. Card-bill payments,
transfers, top-ups and credits are excluded; merchants billed often but in
varying amounts are listed separately as usage-based.
"""

import argparse
import datetime as dt
import json
import re
import statistics
import sys
from collections import Counter, defaultdict

SKIPPED_STATUSES = {"cancelled", "failed", "reversed", "blocked"}
NON_PURCHASE_KINDS = {
    "internalTransfer", "treasuryTransfer", "creditCardCredit", "debitCardCredit",
    "incomingDomesticWire", "incomingInternationalWire", "checkDeposit", "interestPayment",
    "expenseReimbursement", "cardInternationalTransactionFee", "wireFee",
}
CARD_PAYMENT = re.compile(
    r"mercury\s*(io|credit)|credit\s*card\s*(payment|bill)|card\s*payment|autopay|"
    r"statement\s*balance|payoff|amex\s*epayment|chase\s*credit|信用卡",
    re.I,
)
TOP_UP = re.compile(
    r"top[\s-]?up|reload|add(ed)?\s*funds|prepaid|recharge|wallet|gift\s*card|"
    r"buy\s*credits?|credits?\s*purchase|balance\s*(load|add)|儲值|加值",
    re.I,
)
CADENCES = [  # name, min days, max days, typical days
    ("weekly", 6, 8, 7),
    ("biweekly", 13, 16, 14),
    ("monthly", 26, 35, 30.4),
    ("quarterly", 84, 98, 91),
    ("yearly", 350, 380, 365),
]


def merchant_key(tx):
    raw = tx.get("counterpartyName") or tx.get("counterpartyNickname") or tx.get("bankDescription") or ""
    text = raw.lower().replace("www.", "")
    text = re.sub(r"\b[a-z]*\d[a-z0-9]*\b", " ", text)  # order ids, store numbers, dates
    text = re.sub(r"\.(com|net|io|ai|co)\b", " ", text)
    text = re.sub(r"[^a-z一-鿿]+", " ", text)
    return " ".join(text.split()) or raw.strip().lower(), raw.strip()


def charge_date(tx):
    stamp = tx.get("postedAt") or tx.get("createdAt") or ""
    try:
        return dt.date.fromisoformat(stamp[:10])
    except ValueError:
        return None


def exclusion(tx, debit_sign):
    amount = tx.get("amount")
    if not isinstance(amount, (int, float)):
        return "no amount"
    if tx.get("status") in SKIPPED_STATUSES:
        return "cancelled/failed"
    if (amount < 0) != (debit_sign == "negative") or amount == 0:
        return "credit/refund"
    if tx.get("kind") in NON_PURCHASE_KINDS:
        return "transfer/fee/deposit"
    text = " ".join(str(tx.get(k) or "") for k in ("counterpartyName", "counterpartyNickname", "bankDescription"))
    if CARD_PAYMENT.search(text):
        return "card-bill payment"
    if TOP_UP.search(text):
        return "top-up/prepaid"
    if charge_date(tx) is None:
        return "no date"
    return None


def cluster_amounts(charges, tolerance):
    """Split one merchant's charges into groups whose amounts lie within tolerance of the group's first."""
    groups = []
    for tx in sorted(charges, key=lambda t: abs(t["amount"])):
        amount = abs(tx["amount"])
        for group in groups:
            base = abs(group[0]["amount"])
            if abs(amount - base) <= max(tolerance * base, 0.01):
                group.append(tx)
                break
        else:
            groups.append([tx])
    return groups


def cadence_of(dates):
    days = sorted(set(dates))
    if len(days) < 2:
        return None
    gaps = [(b - a).days for a, b in zip(days, days[1:])]
    median = statistics.median(gaps)
    for name, low, high, typical in CADENCES:
        if low <= median <= high and all(low * 0.8 <= g <= high * 1.2 for g in gaps):
            return name, typical, days
    return None


def analyse(transactions, tolerance, debit_sign):
    excluded = Counter()
    by_merchant = defaultdict(list)
    names = defaultdict(Counter)
    for tx in transactions:
        reason = exclusion(tx, debit_sign)
        if reason:
            excluded[reason] += 1
            continue
        key, raw = merchant_key(tx)
        by_merchant[key].append(tx)
        names[key][raw] += 1

    recurring, usage_based, one_off = [], [], 0
    for key, charges in by_merchant.items():
        matched = 0
        for group in cluster_amounts(charges, tolerance):
            found = cadence_of([charge_date(t) for t in group])
            if not found:
                continue
            name, typical, days = found
            matched += len(group)
            amounts = [abs(t["amount"]) for t in group]
            latest = max(group, key=charge_date)
            recurring.append({
                "merchant": names[key].most_common(1)[0][0],
                "amount": round(statistics.median(amounts), 2),
                "amountRange": [min(amounts), max(amounts)],
                "cadence": name,
                "count": len(group),
                "dates": [d.isoformat() for d in days],
                "lastCharge": days[-1].isoformat(),
                "nextExpected": (days[-1] + dt.timedelta(days=round(typical))).isoformat(),
                "cardLastFour": sorted({t.get("cardLastFour") for t in group if t.get("cardLastFour")}),
                "accounts": sorted({t.get("accountName") for t in group if t.get("accountName")}),
                "kind": latest.get("kind"),
                "category": latest.get("mercuryCategory"),
                "confidence": "high" if len(days) >= 3 else "medium",
            })
        if matched:
            continue
        amounts = [abs(t["amount"]) for t in charges]
        if len(charges) >= 3 and statistics.pstdev(amounts) / statistics.mean(amounts) > tolerance:
            usage_based.append({
                "merchant": names[key].most_common(1)[0][0],
                "count": len(charges),
                "total": round(sum(amounts), 2),
                "amountRange": [min(amounts), max(amounts)],
                "cardLastFour": sorted({t.get("cardLastFour") for t in charges if t.get("cardLastFour")}),
            })
        else:
            one_off += len(charges)
    recurring.sort(key=lambda r: (-r["amount"], r["merchant"]))
    usage_based.sort(key=lambda r: -r["total"])
    return {"recurring": recurring, "usageBased": usage_based, "excluded": dict(excluded), "oneOffCharges": one_off}


def print_table(result, period):
    rec = result["recurring"]
    print(f"Recurring charges {period}: {len(rec)}")
    print("| Merchant | Amount | Cadence | Count | Last charge | Next expected | Card | Confidence |")
    print("| --- | ---: | --- | ---: | --- | --- | --- | --- |")
    for r in rec:
        lo, hi = r["amountRange"]
        amount = f"{r['amount']:.2f}" if lo == hi else f"{r['amount']:.2f} ({lo:.2f}-{hi:.2f})"
        card = ", ".join(f"••{c}" for c in r["cardLastFour"]) or "-"
        print(f"| {r['merchant']} | {amount} | {r['cadence']} | {r['count']} | {r['lastCharge']} "
              f"| {r['nextExpected']} | {card} | {r['confidence']} |")
    monthly = sum(r["amount"] * 30.4 / {"weekly": 7, "biweekly": 14, "monthly": 30.4,
                                         "quarterly": 91, "yearly": 365}[r["cadence"]] for r in rec)
    print(f"\nEstimated monthly total: {monthly:.2f}")
    if result["usageBased"]:
        print("\nUsage-based / variable amounts (not counted above):")
        for u in result["usageBased"]:
            lo, hi = u["amountRange"]
            print(f"- {u['merchant']}: {u['count']} charges, {lo:.2f}-{hi:.2f}, total {u['total']:.2f}")
    print(f"\nExcluded: {result['excluded']}; one-off charges: {result['oneOffCharges']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("file")
    parser.add_argument("--json", action="store_true", help="print JSON instead of a Markdown table")
    parser.add_argument("--tolerance", type=float, default=0.05, help="relative amount tolerance (0.05 = 5%%)")
    parser.add_argument("--debit-sign", choices=["negative", "positive"], default="negative")
    args = parser.parse_args()

    data = json.load(open(args.file, encoding="utf-8"))
    transactions = data.get("transactions", []) if isinstance(data, dict) else data
    period = f"{data.get('start')}..{data.get('end')}" if isinstance(data, dict) and data.get("start") else ""
    result = analyse(transactions, args.tolerance, args.debit_sign)
    if args.json:
        json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
        print()
    else:
        print_table(result, period)


if __name__ == "__main__":
    main()

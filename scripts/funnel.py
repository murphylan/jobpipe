#!/usr/bin/env python3
"""Weekly funnel review from the ledger CSV.

Usage: python3 funnel.py LEDGER.csv [--by score_band|channel|resume_version|role_family]

Only rows with submission_status == confirmed count as applications (counting
discipline, references/ledger.md). A "reply" is any stage past `applied` that is
not a pure rejection-without-contact; adjust REPLIED below if the definition changes.
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict

REPLIED = {"replied", "screen", "interview", "offer", "rejected_after_contact"}
INTERVIEW = {"interview", "offer"}


def band(score: str) -> str:
    try:
        s = float(score)
    except ValueError:
        return "self/none"
    return "9-10" if s >= 9 else "7-8.9" if s >= 7 else "5-6.9" if s >= 5 else "<5"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--by", default="score_band",
                    choices=["score_band", "channel", "resume_version", "role_family"])
    args = ap.parse_args()
    groups: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])  # apps, replies, interviews, ghosted
    with open(args.csv, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("submission_status") != "confirmed":
                continue
            key = band(row.get("score", "")) if args.by == "score_band" else (row.get(args.by) or "?")
            g = groups[key]
            g[0] += 1
            stage = row.get("stage", "")
            g[1] += stage in REPLIED
            g[2] += stage in INTERVIEW
            g[3] += stage == "ghosted"
    print(f"{args.by:<22}{'apps':>6}{'reply':>8}{'reply%':>8}{'intv':>6}{'ghost':>7}")
    for key in sorted(groups):
        a, r, i, gh = groups[key]
        print(f"{key:<22}{a:>6}{r:>8}{(100 * r / a if a else 0):>7.0f}%{i:>6}{gh:>7}")
    tot = [sum(v[k] for v in groups.values()) for k in range(4)]
    print(f"{'TOTAL':<22}{tot[0]:>6}{tot[1]:>8}{(100 * tot[1] / tot[0] if tot[0] else 0):>7.0f}%{tot[2]:>6}{tot[3]:>7}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

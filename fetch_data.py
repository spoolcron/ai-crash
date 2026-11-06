#!/usr/bin/env python3
"""Build the AI sell-off drawdown dataset for the site.

Pulls daily closes (and lows) since 1928 for the S&P 500 (^GSPC), the Nasdaq
Composite (^IXIC) and the PHLX Semiconductor Index (^SOX) from Yahoo
Finance's chart API, then rebuilds the front end's data file (data.js) and
local provenance (data/episodes.json, data/raw/*.json).

Method (same as the chart claims):
- A "slide" runs from a record close (a close strictly above every earlier
  close) to the next record close, so mid-recovery dips sit inside the
  parent slide (the 2011 fall sits inside 2007-2013). Its depth is the
  lowest close before that next record.
- Slides are counted from 1 Jan 1950, but the record test uses the full
  history back to 1928 so a truncated window cannot invent records.
- A slide "reached 6%" if its intraday low traded 6% below the record close;
  depth itself is measured on closes.
- The ongoing slide since the last record close is the "AI sell-off" and is
  drawn even before it trades through 6%.

Usage: python3 fetch_data.py [--offline] [--check]
  --offline  rebuild data.js from the cached raw JSON under data/raw/
  --check    print the known-crash table and compare with reference values
"""

from __future__ import annotations

import json
import ssl
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
RAW = BASE / "data" / "raw"

YAHOO = ("https://query2.finance.yahoo.com/v8/finance/chart/{sym}"
         "?period1=-1325500000&period2=9999999999&interval=1d")
SYMBOLS = {"spx": "^GSPC", "ixic": "^IXIC", "sox": "^SOX"}

START = date(1950, 1, 1)  # first record date counted as a slide
CAP = 250                 # trading days drawn per line on the chart
REACH = -6.0              # a slide counts once it trades this far below record

# Curated "best known" slides, keyed by the record close that starts them.
FEATURED = {
    "1973-01-11": "1973 oil shock",
    "1987-08-25": "1987 crash",
    "2000-03-24": "Dot-com",
    "2007-10-09": "2008 crisis",
    "2020-02-19": "Covid",
    "2022-01-03": "2022",
    "2025-02-19": "April 2025",
}
ONGOING_NAME = "AI sell-off"

# Reference values from the kadoa.com chart (5 Nov 2026) used by --check:
# name -> (record date, low date, depth %, days to low). The ongoing row is
# deliberately excluded: it grows every session.
REFERENCE = {
    "1973 oil shock": ("1973-01-11", "1974-10-03", -48.2, 436),
    "1987 crash":     ("1987-08-25", "1987-12-04", -33.5, 71),
    "Dot-com":        ("2000-03-24", "2002-10-09", -49.1, 637),
    "2008 crisis":    ("2007-10-09", "2009-03-09", -56.8, 355),
    "Covid":          ("2020-02-19", "2020-03-23", -33.9, 23),
    "2022":           ("2022-01-03", "2022-10-12", -25.4, 195),
    "April 2025":     ("2025-02-19", "2025-04-08", -18.9, 34),
}


def fetch(sym: str, offline: bool) -> dict:
    """Return the chart-API JSON payload for one symbol, cached on disk."""
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{sym.replace('^', '')}.json"
    if offline and not path.exists():
        raise SystemExit(f"--offline: no cached payload for {sym} at {path}; run online once first")
    if not (offline and path.exists()):
        req = urllib.request.Request(
            YAHOO.format(sym=sym),
            headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) ai-crash/1.0"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=90,
                                            context=ssl.create_default_context()) as r:
                    body = r.read().decode("utf-8", "replace")
                payload = json.loads(body)
                if payload.get("chart", {}).get("error"):
                    raise ValueError(f"{sym}: {payload['chart']['error']}")
                path.write_text(body)
                break
            except Exception as exc:  # noqa: BLE001 - retry then surface
                if attempt == 3:
                    raise RuntimeError(f"fetch failed for {sym}: {exc}") from exc
                time.sleep(2.0 * (attempt + 1))
        time.sleep(0.3)
    return json.loads(path.read_text())


Row = tuple[date, float, float]  # (date, close, low)


def rows_of(payload: dict) -> list[Row]:
    """Extract [(date, close, low)] from a chart-API payload, dropping nulls."""
    res = payload["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    out: list[Row] = []
    for ts, c, lo in zip(res["timestamp"], q["close"], q["low"]):
        if c is None or lo is None:
            continue
        # timestamps are session opens in UTC; the UTC date is the trading day
        out.append((datetime.fromtimestamp(ts, timezone.utc).date(),
                    round(c, 4), round(lo, 4)))
    out.sort()
    # Yahoo serves the live intraday quote as the last bar's "close" until the
    # regular session ends; drop it so the dataset only has settled closes.
    pmeta = res.get("meta", {})
    rmt = pmeta.get("regularMarketTime")
    end = (pmeta.get("currentTradingPeriod") or {}).get("regular", {}).get("end")
    if out and rmt is not None and end is not None and rmt < end \
            and datetime.fromtimestamp(end, timezone.utc).date() == out[-1][0]:
        out.pop()
    return out


def record_idx(rows: list[Row]) -> list[int]:
    """Indices of record closes: strictly above every earlier close."""
    idx, best = [], None
    for i, (_, c, _) in enumerate(rows):
        if best is None or c > best:
            idx.append(i)
            best = c
    return idx


def all_episodes(rows: list[Row]) -> list[dict]:
    """Every slide from a record close since START. Depth is the lowest close
    before the next record; `reached` marks slides whose low traded REACH."""
    rec = [i for i in record_idx(rows) if rows[i][0] >= START]
    out = []
    for pos, i in enumerate(rec):
        j = rec[pos + 1] if pos + 1 < len(rec) else len(rows)
        base_i, base_c, _ = rows[i]
        low_k, minlow_k = i, i
        for k in range(i, j):
            if rows[k][1] < rows[low_k][1]:
                low_k = k
            if rows[k][2] < rows[minlow_k][2]:
                minlow_k = k
        depth = (rows[low_k][1] / base_c - 1.0) * 100.0
        reach = (rows[minlow_k][2] / base_c - 1.0) * 100.0
        out.append({
            "recordDate": base_i.isoformat(),
            "recordClose": base_c,
            "lowDate": rows[low_k][0].isoformat(),
            "lowClose": rows[low_k][1],
            "depthPct": round(depth, 4),
            "reachPct": round(reach, 4),
            "daysToLow": low_k - i,
            "episodeDays": j - 1 - i,
            "ongoing": pos == len(rec) - 1,
            "reached": reach <= REACH,
        })
    return out


def series_for(rows: list[Row], ep: dict, cap: int = CAP) -> list[float]:
    """Percent below the record close on daily closes, day 0..min(cap, length)."""
    dates = {d: k for k, (d, _, _) in enumerate(rows)}
    i0 = dates[date.fromisoformat(ep["recordDate"])]
    end = len(rows) - 1 if ep["ongoing"] else min(i0 + cap, len(rows) - 1)
    base = ep["recordClose"]
    return [round((rows[k][1] / base - 1.0) * 100.0, 2) for k in range(i0, end + 1)]


def drawdown_now(rows: list[Row]) -> dict:
    """Current fall from the last record close, for context stats."""
    i = record_idx(rows)[-1]
    last_d, last_c, _ = rows[-1]
    low_c = min(c for _, c, _ in rows[i:])
    return {
        "recordDate": rows[i][0].isoformat(),
        "recordClose": rows[i][1],
        "pctBelowRecord": round((last_c / rows[i][1] - 1.0) * 100.0, 2),
        "pctBelowLow": round((low_c / rows[i][1] - 1.0) * 100.0, 2),
        "daysSinceRecord": len(rows) - 1 - i,
        "lastDate": last_d.isoformat(),
        "lastClose": last_c,
    }


def worst_day(rows: list[Row], since: date) -> dict | None:
    """Worst single-session % fall on or after `since`, and the last session
    before it that fell at least as far."""
    best = None
    for k in range(1, len(rows)):
        d, c, _ = rows[k]
        if d < since:
            continue
        ret = (c / rows[k - 1][1] - 1.0) * 100.0
        if best is None or ret < best["pct"]:
            best = {"date": d.isoformat(), "pct": round(ret, 1),
                    "weekday": d.strftime("%A")}
    if best is None:
        return None
    prev = None
    bd = date.fromisoformat(best["date"])
    for k in range(1, len(rows)):
        d = rows[k][0]
        if d >= bd:
            break
        ret = (rows[k][1] / rows[k - 1][1] - 1.0) * 100.0
        if ret <= best["pct"]:
            prev = {"date": d.isoformat(), "monthYear": d.strftime("%b %Y")}
    best["worstSince"] = prev
    return best


def main() -> None:
    offline = "--offline" in sys.argv
    do_check = "--check" in sys.argv

    data = {k: rows_of(fetch(sym, offline)) for k, sym in SYMBOLS.items()}
    spx = data["spx"]

    episodes = all_episodes(spx)
    all_slides = [e for e in episodes if e["reached"]]

    # The ongoing slide is drawn from its first session below the record,
    # even before it trades through the 6% line.
    ri = record_idx(spx)[-1]
    last_rec = spx[ri]
    ongoing = next((e for e in all_slides if e["ongoing"]), None)
    if (ongoing is None or ongoing["recordDate"] != last_rec[0].isoformat()) \
            and ri < len(spx) - 1:
        cand = next((e for e in episodes if e["ongoing"]), None)
        if cand is not None and cand["recordDate"] == last_rec[0].isoformat():
            ongoing = cand
            all_slides.append(cand)

    for e in all_slides:
        e["name"] = FEATURED.get(e["recordDate"]) or (ONGOING_NAME if e["ongoing"] else None)
        e["series"] = series_for(spx, e)

    past15 = [e for e in all_slides if e["depthPct"] <= -15.0]

    missing = set(FEATURED) - {e["recordDate"] for e in all_slides}
    if missing:
        print(f"WARNING: featured record dates not found among slides: {sorted(missing)}")

    last_d, last_c, _ = spx[-1]
    out = {
        "meta": {
            "builtOn": datetime.fromtimestamp(
                max((RAW / f"{s.replace('^', '')}.json").stat().st_mtime
                    for s in SYMBOLS.values()), timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "asOfDate": last_d.isoformat(),
            "asOfWeekday": last_d.strftime("%A %-d %B %Y"),
            "lastClose": last_c,
            "recordDate": last_rec[0].isoformat(),
            "recordClose": last_rec[1],
            "pctBelowRecord": round((last_c / last_rec[1] - 1.0) * 100.0, 2),
            "daysSinceRecord": len(spx) - 1 - ri,
            "ongoingDepth": ongoing["depthPct"] if ongoing else 0.0,
            "slidesTo6": len([e for e in all_slides if e["reached"]]),
            "slidesPast15": len(past15),
            "worstDay": worst_day(spx, last_rec[0]) if ongoing else None,
            "ixic": drawdown_now(data["ixic"]),
            "sox": drawdown_now(data["sox"]),
            "source": "Yahoo Finance daily closes: ^GSPC, ^IXIC, ^SOX "
                      "(price indexes, dividends excluded)",
        },
        "episodes": all_slides,
    }

    (BASE / "data").mkdir(exist_ok=True)
    (BASE / "data" / "episodes.json").write_text(json.dumps(out, indent=1))
    js = "window.CRASH = " + json.dumps(out, separators=(",", ":")) + ";\n"
    (BASE / "data.js").write_text(js)

    print(f"wrote data.js: {len(js) // 1024} KB, {out['meta']['slidesTo6']} slides "
          f"reached 6% ({out['meta']['slidesPast15']} past 15%), as of {last_d}")

    if do_check:
        bad = 0
        by_name = {e["name"]: e for e in all_slides if e["name"]}
        for name, (rd, ld, dep, dys) in REFERENCE.items():
            e = by_name.get(name)
            if e is None:
                print(f"  MISSING {name}")
                bad += 1
                continue
            ok = (e["recordDate"] == rd and e["lowDate"] == ld
                  and abs(e["depthPct"] - dep) <= 0.15 and e["daysToLow"] == dys)
            print(f"  {'ok  ' if ok else 'FAIL'} {name}: rec {e['recordDate']} "
                  f"low {e['lowDate']} {e['depthPct']}% in {e['daysToLow']}d")
            bad += 0 if ok else 1
        m = out["meta"]
        wd = m["worstDay"] or {}
        ws = (wd.get("worstSince") or {}).get("monthYear")
        print(f"  ongoing: {m['recordDate']} -> close {m['pctBelowRecord']}% after "
              f"{m['daysSinceRecord']}d, depth {m['ongoingDepth']}%; worst day "
              f"{wd.get('pct')}% {wd.get('date')} since {ws}")
        counts_ok = m["slidesTo6"] == 58 and m["slidesPast15"] == 15
        bad += 0 if counts_ok else 1
        print(f"  {'ok  ' if counts_ok else 'FAIL'} counts: {m['slidesPast15']} of {m['slidesTo6']} (want 15 of 58)")
        print(f"  ixic: {m['ixic']['pctBelowRecord']}% off {m['ixic']['recordDate']}"
              f"; sox: {m['sox']['pctBelowRecord']}% off {m['sox']['recordDate']}")
        if bad:
            sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fetch market data and write data.js (self-contained; used by GitHub Actions).

Sources:
  - Yahoo Finance chart API: ^NDX, ^GSPC, ^SOX  (daily, full history)
  - FRED fredgraph.csv: DFF (daily Fed Funds rate)

Output: data.js  ->  window.MARKET = {
  ndx:{dates,px}, gspc:{dates,px}, sox:{dates,px}, ff:{dates,rate}, updated
}
"""
import json, csv, io, time, datetime, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")

def get(url, tries=2):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=12) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(2)
    raise last

def yahoo(symbol):
    now = int(time.time())
    # try both Yahoo hosts (cloud IPs are sometimes throttled on one)
    err = None
    for host in ("query1", "query2"):
        url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}"
               f"?period1=0&period2={now}&interval=1d")
        try:
            j = json.loads(get(url))
            break
        except Exception as e:
            err = e
    else:
        raise err
    d = j["chart"]["result"][0]
    ts = d["timestamp"]
    close = d["indicators"]["quote"][0]["close"]
    m = {}
    for t, c in zip(ts, close):
        if c is None:
            continue
        dte = datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")
        m[dte] = round(c, 4)
    sd = sorted(m)
    return {"dates": sd, "px": [m[x] for x in sd]}

def fred_dff():
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF"
    txt = get(url).decode()
    dates, rate = [], []
    for row in csv.DictReader(io.StringIO(txt)):
        v = row["DFF"].strip()
        if v in ("", ".", "NaN"):
            continue
        dates.append(row["observation_date"]); rate.append(round(float(v), 3))
    return {"dates": dates, "rate": rate}

def load_existing(path="data.js"):
    try:
        txt = open(path).read().strip()
        txt = txt[txt.index("{"): txt.rindex("}") + 1]
        return json.loads(txt)
    except Exception:
        return {}

base = load_existing()

def fetch_or_keep(name, key, fn):
    try:
        v = fn()
        print(f"[ok]   {name}: fetched {len(v['dates'])} rows")
        return v
    except Exception as e:
        if key in base:
            print(f"[keep] {name}: fetch failed ({e}); keeping existing {len(base[key]['dates'])} rows")
            return base[key]
        raise

ndx  = fetch_or_keep("NDX",  "ndx",  lambda: yahoo("%5ENDX"))
gspc = fetch_or_keep("GSPC", "gspc", lambda: yahoo("%5EGSPC"))
sox  = fetch_or_keep("SOX",  "sox",  lambda: yahoo("%5ESOX"))
ff   = fetch_or_keep("DFF",  "ff",   fred_dff)

market = {"ndx": ndx, "gspc": gspc, "sox": sox, "ff": ff,
          "updated": max(ndx["dates"][-1], gspc["dates"][-1], sox["dates"][-1])}

with open("data.js", "w") as f:
    f.write("window.MARKET=")
    json.dump(market, f, separators=(",", ":"))
    f.write(";")

import os
for n, s in [("NDX", ndx), ("GSPC", gspc), ("SOX", sox)]:
    print(f"{n:5} {len(s['dates']):6}  {s['dates'][0]} -> {s['dates'][-1]}")
print(f"DFF   {len(ff['dates']):6}  {ff['dates'][0]} -> {ff['dates'][-1]}")
print("updated:", market["updated"], "| data.js bytes:", os.path.getsize("data.js"))

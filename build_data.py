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

UA = "Mozilla/5.0 (compatible; strategy-sim/1.0)"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

def yahoo(symbol):
    now = int(time.time())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?period1=0&period2={now}&interval=1d")
    j = json.loads(get(url))
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

ndx  = yahoo("%5ENDX")
gspc = yahoo("%5EGSPC")
sox  = yahoo("%5ESOX")
ff   = fred_dff()

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

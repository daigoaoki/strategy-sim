# レバレッジETF 退避戦略シミュレーター

NDX100 / QLD / TQQQ・SOX / SOXL・SPY / SPXL を対象に、金利(FF金利)と200日移動平均で
退避する戦略をバックテストする静的Webアプリ。レバレッジ版(QLD/TQQQ/SOXL/SPXL)は
原資産指数から日次複利で仮想再現する。

## データ
- 株価:Yahoo Finance(^NDX / ^GSPC / ^SOX、日次・全期間)
- 金利:FRED `DFF`(日次フェデラルファンド金利)
- `build_data.py` が Web から取得して `data.js` を生成する(自己完結)

## 戦略
- **ホールド** / **金利** / **200DMA** / **金利+200DMA(OR / AND)**
- 退避先:現金 / MMF(短期金利) / 1倍指数(同じ原資産のレバレッジなし版)

## ローカルで見る
`index.html` をブラウザで開くだけ(同梱 `data.js` のデータで動作)。

## GitHub Pages へ公開する手順
1. GitHub で空リポジトリを作成(例:`strategy-sim`)。README等は追加しない。
2. このフォルダで(初回のみ):
   ```sh
   git remote add origin https://github.com/<ユーザー名>/strategy-sim.git
   git branch -M main
   git push -u origin main
   ```
3. GitHub の **Settings → Pages** → Source を「Deploy from a branch」、
   Branch を `main` / `/ (root)` にして保存。
4. 数十秒後 `https://<ユーザー名>.github.io/strategy-sim/` で公開される(携帯でも閲覧可)。

## データの自動更新
`.github/workflows/update-data.yml` が毎日 `build_data.py` を実行し、
`data.js` に差分があれば自動コミットする(手動実行も可:Actions タブ → Run workflow)。
これにより Pages 上のデータが「今日まで」に保たれる。
ページ内の「↻ 今日まで更新」ボタンは補助(静的ホスティングでは公開CORSプロキシ依存)。

# 資料轉換流程（Data Workflow）

本案的資料是「OSM 給店、Google 補資訊」的兩段式管線。所有腳本都在本機跑，
API key 只存在 `.env`（不進 repo），網站前端零 API 呼叫。

```
┌─────────────────┐   scripts/fetch_osm.py    ┌──────────────────┐
│  OpenStreetMap   │ ────────────────────────▶ │  data/osm.json    │
│  (Overpass API)  │   店名/座標/類型/電話      │  ~13,600 家       │
└─────────────────┘                            └────────┬─────────┘
                                                        │
                        scripts/verify_osm.py（分批，吃 Google 免費額度）
                                                        │
      ┌──────────────────┬──────────────────┬───────────┴────────┐
      ▼                  ▼                  ▼                    ▼
  --limit N          --booking N        --rating N          （自動附帶）
  座標核對＋歇業      可否線上訂位＋電話    ⭐評分＋評論數        歇業偵測
  寫入 v/c/x/gd      寫入 b/mapsUri      寫入 gr/grc          寫入 c
      │
      └────────────▶ data/verify_log.json（核對紀錄，後台 verify.html 顯示）

精選 35 家另走 scripts/verify_places.py：
  預設     → 座標核對＋評分＋3 則留言（寫入 google 欄位、verified）
  --booking → reservable＋電話（寫入 booking、phone）
```

## 欄位對照（data/osm.json 的 rows）

| 欄位 | 意義 | 來源 |
|---|---|---|
| `name/lat/lng/category/district/address/hours/phone/url/tags` | 店家基本資料 | OSM |
| `v` | 座標核對通過日期（與 Google 差 <100 m） | Google Text Search（Pro） |
| `gd` | 與 Google 座標差距（公尺；>100 = 待人工確認） | 同上 |
| `c` | 1 = Google 標示永久歇業（前台自動排除） | 同上 |
| `x` | 1 = Google 找不到（不再重查） | 同上 |
| `b` | 1 = 可線上訂位（已濾掉速食連鎖的「線上點餐」誤標） | Text Search（Enterprise+Atmosphere） |
| `mapsUri` | 訂位入口（Google 地圖頁） | 同上 |
| `gr` / `grc` | ⭐評分 / 評論數（-1 = 查過但沒有） | Text Search（Enterprise） |

## Google 免費額度與批次節奏（單帳號、$0 路線）

| SKU | 每月免費 | 用在 | 建議批次 |
|---|---|---|---|
| Text Search Pro | 5,000 | 座標核對 | 月初 `--limit 4800` 一次吃滿 |
| Text Search Enterprise | 1,000 | `--rating` | 每月 `--limit 900` |
| Text Search Enterprise+Atmosphere | 1,000 | `--booking`（順帶評分） | 每月 `--limit 900` |
| Place Details Enterprise+Atmosphere | 1,000 | 精選 35 家（評分+留言，30 天過期重跑） | `verify_places.py` |

- 撞到 429 = 當月額度用完，腳本自動停，不會產生費用。
- Google 內容（評分/留言）快取上限 30 天；`gr` 過舊可用 `--rating` 補跑（目前未做自動過期，人工節奏即可）。
- **不要**用多帳號規避額度（違反 Google ToS，有停權風險）。

## 手動操作（目前無排程，皆手動 trigger）

```bash
bash scripts/daily_verify.sh                      # 1 號=4800 筆大批次，其他日=190 筆＋訂位30
python3 scripts/verify_osm.py --limit 190          # 只跑座標核對
python3 scripts/verify_osm.py --booking --limit 900
python3 scripts/verify_osm.py --rating  --limit 900
python3 scripts/fetch_osm.py                       # 重抓 OSM 底檔（會保留？不會——見下）
```

⚠️ `fetch_osm.py` 會整份重建 `data/osm.json`，**核對欄位（v/c/b/gr…）會遺失**。
重抓前先備份，或之後要寫 merge 邏輯再跑。

## 更新後上線

```bash
git add data/ && git commit -m "資料更新：<內容>" && git push   # Pages 約 1 分鐘生效
```

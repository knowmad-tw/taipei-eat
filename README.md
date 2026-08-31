# 台北吃什麼 — 現在訂得到位

核心議題只有一個：**現在訂得到位的餐廳**。定位（或選區域）後，列出可線上訂位（優先）與可電話訂位的餐廳，一鍵訂位 / 撥號 / 導航。

三種模式：`訂得到的（線上＋電話）`（預設）｜`只看線上訂位`｜`全部店家`（含 OpenStreetMap 1.3 萬家，探索用）。
訂位資訊來自 Google Places 的 `reservable` 與電話欄位，跑 `scripts/verify_places.py --booking` 更新。

純靜態網站，無後端、無 API key，可直接放 GitHub Pages。

## 定位怎麼運作

篩選面板最上方有一條**定位狀態列**，清楚顯示現在能不能用 GPS：

| 狀態 | 意思 |
|---|---|
| 🔵 可定位 | 瀏覽器支援，按「定位我」即可（會跳授權） |
| 🟠 GPS 定位中 ✓ | 已用你的位置排序、距離篩選啟用 |
| 🟠 未用 GPS | 以選的行政區 / 捷運站為中心做距離篩選 |
| 🔴 已拒絕 / 不支援 | 無法 GPS；請改選區域。GPS 需要 https 或 localhost |

## 資料來源

| 來源 | 筆數 | 內容 | 更新方式 |
|---|---|---|---|
| `data/restaurants.json` 精選 | 35 | 有推薦原因、來源、價位、場合 | 手動編輯 |
| `data/osm.json` OpenStreetMap | ~13,600 | 名稱、座標、類型、部分地址/營業時間 | `python3 scripts/fetch_osm.py` |

- OSM 資料授權 ODbL，頁尾已保留 attribution。
- 與精選同名且 150 m 內的 OSM 店家會自動去重，精選版本優先。
- 一次最多顯示 300 家（依距離最近），設定位置或加條件即可縮小。
- 勾掉「包含 OpenStreetMap 店家」就只看精選。

### 查過但不能用的官方開放資料
- 交通部觀光署「餐飲 - 觀光資訊資料庫」（data.gov.tw #7779）：全國 3,631 筆，**臺北市 0 筆**。
- 臺北旅遊網 Open API：只有景點 / 活動端點，沒有餐廳。
- data.taipei：只有「環保餐廳」「客家美食餐飲小吃名冊」等小眾名冊（CSV、無座標），可日後手動併入精選。

## Google 評分 & 座標核對（方案 A：key 只在本機）

```bash
cp .env.example .env        # 填入 PLACES_KEY（已在 .gitignore）
python3 scripts/verify_places.py --dry-run   # 看會查哪些
python3 scripts/verify_places.py             # 精選 35 家，約 70 次呼叫，免費額度內
```

腳本會把結果寫進 `data/restaurants.json`：
- `verified`：座標與 Google 差 < 50 m 才會是 `true`（只改布林，不覆蓋我們的座標）
- `google`：星等、評論數、價位、營業狀態、最新 3 則留言、查詢日期。**這些是 Google 內容，30 天後網站會標示過期**，重跑腳本即可（已查過且未過期的會自動跳過）。

Google Cloud 端建議設定：只啟用 Places API (New)、配額 Place Details 30 次／天、預算警示 US$1。

## 每日自動核對（launchd）

已安裝 `~/Library/LaunchAgents/com.knowmad.taipei-eat-verify.plist`：每天 09:30 跑
`scripts/daily_verify.sh`（座標核對 190 筆 + 線上訂位補查 30 筆），log 在 `logs/verify.log`。

```bash
launchctl unload ~/Library/LaunchAgents/com.knowmad.taipei-eat-verify.plist   # 停用
launchctl load   ~/Library/LaunchAgents/com.knowmad.taipei-eat-verify.plist  # 啟用
tail logs/verify.log                                                          # 看進度
```

## 本機執行

```bash
cd 台北吃什麼
python3 -m http.server 8080
# 開 http://localhost:8080
```

（因為用 `fetch` 讀 JSON，直接雙擊 `index.html` 會被瀏覽器擋住。）

## 新增餐廳

只要在 `data/restaurants.json` 加一筆，不用改程式：

```json
{
  "id": "unique-slug",
  "name": "店名",
  "category": "麵食",
  "district": "大安區",
  "mrt": "東門",
  "address": "台北市…",
  "lat": 25.0334, "lng": 121.5301,
  "price": 2,
  "occasions": ["一人", "宵夜"],
  "tags": ["牛肉麵"],
  "hours": "11:00–21:00",
  "reason": "為什麼推薦（一句話）",
  "source": "米其林必比登",
  "sourceUrl": "https://...（來源連結，可空）",
  "url": "",
  "verified": false
}
```

- `price`：1 = <150、2 = 150–400、3 = 400–1000、4 = 1000+（每人）
- `category` / `occasions` / `source` 的值會自動變成篩選 chip，用既有字串可避免碎片化
- `source` 目前用的值：`米其林星級`、`米其林必比登`、`觀光經典`、`在地口碑`；也可以寫 `朋友推薦`、`自己吃過` 等
- `reason` 會顯示在卡片的「為什麼推」，`sourceUrl` 有填時來源會變成連結
- 座標可從 Google Maps 網址或右鍵「這是哪裡？」取得
- `verified` 代表座標與資料已人工核對；**初版種子資料都是 `false`，請陸續核對**

捷運站與行政區中心點在 `data/areas.json`，同樣直接加。

## 檔案

```
index.html             版面
css/style.css          手繪白紙風樣式
js/app.js              篩選 / 地圖 / 定位
data/restaurants.json  餐廳資料
data/areas.json        行政區、捷運站座標
data/osm.json          OpenStreetMap 店家（腳本產生，勿手改）
scripts/fetch_osm.py   從 Overpass API 重抓 OSM 資料
docs/                  設計文件
```

## 致謝

視覺語言（純白、黑細線手繪、大量留白、紅橙藍批註）參考 [helloianneo/ian-xiaohei-illustrations](https://github.com/helloianneo/ian-xiaohei-illustrations)（MIT）的風格 DNA。其「小黑」角色為作者 Ian 的 IP，本站未使用，吉祥物「小飯」為自製。

地圖：[Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org/copyright)。字型：LXGW WenKai TC。

# 台北吃什麼 — 初版設計（2026-08-30）

## 目的
查詢台北某個區域（或以目前位置為中心）後，推薦合適的餐廳；可用條件過濾；未來能持續新增餐廳。

## 架構
純靜態網站，無後端、無 API key。

```
index.html            版面
css/style.css         手繪風樣式
js/app.js             篩選 / 地圖 / 定位邏輯
data/restaurants.json 餐廳資料（唯一要維護的檔）
data/areas.json       行政區與捷運站中心點
```

- 地圖：Leaflet 1.9 + OpenStreetMap 圖磚（cdnjs 載入）。
- 定位：`navigator.geolocation`；距離以 haversine 計算。
- 區域搜尋：選行政區 / 捷運站 → 以該中心點當作「你的位置」計算距離並飛到該處。

## 資料 schema（restaurants.json）
```json
{
  "id": "din-tai-fung-xinyi",
  "name": "鼎泰豐 信義店",
  "category": "小籠包/點心",
  "district": "大安區",
  "mrt": "東門",
  "address": "台北市大安區信義路二段194號",
  "lat": 25.0334, "lng": 121.5301,
  "price": 3,
  "occasions": ["聚餐", "觀光"],
  "tags": ["小籠包", "排隊名店"],
  "hours": "10:00–21:00",
  "note": "一句話推薦",
  "url": "https://...",
  "verified": false
}
```
`price`：1 = <150、2 = 150–400、3 = 400–1000、4 = 1000+（每人）。
`verified`：座標/資料是否人工核對過。初版種子資料皆為 `false`。

## 篩選條件
關鍵字、行政區、捷運站、類型、價位、場合、距離半徑（需定位或選區域）。

## 風格
參考 helloianneo/ian-xiaohei-illustrations 的視覺 DNA：純白背景、黑色細線手繪框、大量留白、紅/橙/藍少量批註。
**不使用**其「小黑」角色（作者 IP）；自製吉祥物「小飯」。

## 未來擴充
- 餐廳資料改由表單 / Google Sheet 匯出。
- 依營業時間顯示「現在有開」。
- 加上收藏（localStorage）。

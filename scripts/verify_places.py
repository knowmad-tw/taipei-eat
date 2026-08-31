#!/usr/bin/env python3
"""
用 Google Places API (New) 核對精選餐廳（data/restaurants.json）：
  1. 座標是否與 Google 相符（< 50 m → verified = true）
  2. 星等、評論數、價位、營業狀態、最新留言（Google 內容，存 30 天內有效）

key 只在本機使用，讀取順序：環境變數 PLACES_KEY → 專案根目錄 .env（PLACES_KEY=...）。
每家最多 2 次呼叫（Text Search Pro + Place Details Enterprise+Atmosphere），
35 家 = 70 次，遠低於每月免費額度（5,000 / 1,000）。

用法：
  python3 scripts/verify_places.py               # 全部
  python3 scripts/verify_places.py --only din-tai-fung-xinyi
  python3 scripts/verify_places.py --dry-run     # 只印查詢，不打 API
  python3 scripts/verify_places.py --force       # 30 天內查過的也重查
"""
import argparse, json, math, os, pathlib, sys, time, datetime, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data/restaurants.json'
MATCH_M = 50          # 座標差距在此以內視為相符
STALE_DAYS = 30       # Google 內容快取上限
LANG = 'zh-TW'

def load_key():
    k = os.environ.get('PLACES_KEY')
    if k: return k.strip()
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith('PLACES_KEY='):
                return line.split('=', 1)[1].strip().strip('"\'')
    sys.exit('找不到 PLACES_KEY：請 export PLACES_KEY=... 或在專案根目錄建立 .env')

def haversine(a_lat, a_lng, b_lat, b_lng):
    R = 6371000; r = math.radians
    d = math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lng - a_lng) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(d))

def call(url, key, fields, body=None):
    req = urllib.request.Request(url, method='POST' if body is not None else 'GET',
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors='replace')[:400]
        raise SystemExit(f'HTTP {e.code} {url}\n{msg}\n（403 多半是 key 沒啟用 Places API (New) 或有 referrer 限制；429 是配額到頂）')

def text_search(key, r):
    body = {'textQuery': f"{r['name']} {r.get('address', '')}", 'languageCode': LANG, 'regionCode': 'TW', 'pageSize': 1,
            'locationBias': {'circle': {'center': {'latitude': r['lat'], 'longitude': r['lng']}, 'radius': 1500.0}}}
    fields = 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.googleMapsUri'
    res = call('https://places.googleapis.com/v1/places:searchText', key, fields, body)
    return (res.get('places') or [None])[0]

def details(key, place_id):
    fields = 'rating,userRatingCount,priceLevel,businessStatus,reviews'
    return call(f'https://places.googleapis.com/v1/places/{place_id}?languageCode={LANG}', key, fields)

PRICE = {'PRICE_LEVEL_INEXPENSIVE': 1, 'PRICE_LEVEL_MODERATE': 2, 'PRICE_LEVEL_EXPENSIVE': 3, 'PRICE_LEVEL_VERY_EXPENSIVE': 4}

LOG = ROOT / 'data/verify_log.json'
def append_log(rows, today, report):
    """把這次實際查過（非跳過）的結果追加到 data/verify_log.json，頁面的「核對紀錄」會讀它。"""
    checked = {n for n, s in report if not s.startswith('跳過') and not s.startswith('會查')}
    entries = []
    for r in rows:
        if r['name'] not in checked: continue
        g = r.get('google') or {}
        if not g.get('found'): res, note = 'unmatched', 'Google 找不到或配錯'
        elif g.get('businessStatus') == 'CLOSED_PERMANENTLY': res, note = 'closed', 'Google 標示永久歇業'
        elif r.get('verified'): res, note = 'match', f"座標相符（差 {g.get('distanceM')} m）"
        else: res, note = 'mismatch', f"座標差 {g.get('distanceM')} m，待修正"
        entries.append({'date': today.isoformat(), 'id': r['id'], 'name': r['name'], 'result': res, 'note': note,
                        'distanceM': g.get('distanceM'), 'rating': g.get('rating'), 'ratingCount': g.get('userRatingCount'),
                        'businessStatus': g.get('businessStatus', '')})
    if not entries: return
    log = json.load(open(LOG, encoding='utf-8')) if LOG.exists() else {'runs': []}
    log['runs'].append({'date': today.isoformat(), 'by': 'scripts/verify_places.py', 'entries': entries})
    json.dump(log, open(LOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only'); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--force', action='store_true')
    ap.add_argument('--booking', action='store_true', help='用已存 placeId 補查可否訂位（每家 1 次 Place Details）')
    a = ap.parse_args()
    rows = json.load(open(DATA, encoding='utf-8'))
    key = None if a.dry_run else load_key()
    today = datetime.date.today()
    report = []
    if a.booking:
        for r in rows:
            if a.only and r['id'] != a.only: continue
            pid = r.get('placeId')
            if not pid: report.append((r['name'], '－ 無 placeId，先跑一般核對')); continue
            d = call(f'https://places.googleapis.com/v1/places/{pid}?languageCode={LANG}', key,
                     'reservable,websiteUri,nationalPhoneNumber'); time.sleep(0.2)
            r['booking'] = {'reservable': bool(d.get('reservable')), 'checkedAt': today.isoformat()}
            if d.get('nationalPhoneNumber'): r['phone'] = d['nationalPhoneNumber']
            if d.get('websiteUri') and not r.get('url'): r['url'] = d['websiteUri']
            report.append((r['name'], '🪑 可訂位' if d.get('reservable') else '－ 無訂位資訊（現場排隊或電話）'))
        json.dump(rows, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        for n, s_ in report: print(f'{n:　<14} {s_}')
        print(f"\n可訂位 {sum(1 for r in rows if (r.get('booking') or {}).get('reservable'))}/{len(rows)}")
        return
    for r in rows:
        if a.only and r['id'] != a.only: continue
        g = r.get('google') or {}
        if not a.force and g.get('checkedAt'):
            age = (today - datetime.date.fromisoformat(g['checkedAt'])).days
            if age < STALE_DAYS:
                report.append((r['name'], f'跳過（{age} 天前查過）')); continue
        if a.dry_run:
            report.append((r['name'], f"會查：{r['name']} {r.get('address','')}")); continue

        p = text_search(key, r)
        if not p:
            r['google'] = {'checkedAt': today.isoformat(), 'found': False}
            report.append((r['name'], '❌ Google 找不到')); continue
        loc = p['location']; dist = haversine(r['lat'], r['lng'], loc['latitude'], loc['longitude'])
        d = details(key, p['id']); time.sleep(0.2)
        reviews = [{'author': (v.get('authorAttribution') or {}).get('displayName', ''), 'rating': v.get('rating'),
                    'when': v.get('relativePublishTimeDescription', ''),
                    'text': ((v.get('text') or {}).get('text') or '')[:200]} for v in (d.get('reviews') or [])[:3]]
        r['placeId'] = p['id']
        r['google'] = {
            'checkedAt': today.isoformat(), 'found': True,
            'name': (p.get('displayName') or {}).get('text', ''), 'address': p.get('formattedAddress', ''),
            'distanceM': round(dist), 'businessStatus': d.get('businessStatus') or p.get('businessStatus', ''),
            'rating': d.get('rating'), 'userRatingCount': d.get('userRatingCount'),
            'priceLevel': PRICE.get(d.get('priceLevel')), 'mapsUri': p.get('googleMapsUri', ''), 'reviews': reviews,
        }
        # 座標核對：只改 verified 布林，不用 Google 座標覆蓋我們的資料
        if dist <= MATCH_M:
            r['verified'] = True; flag = f'✅ 相符（{dist:.0f} m）'
        else:
            r['verified'] = False; flag = f'⚠️ 差 {dist:.0f} m → Google 說在 {p.get("formattedAddress","")}（建議改座標為 {loc["latitude"]:.5f},{loc["longitude"]:.5f}）'
        if r['google']['businessStatus'] == 'CLOSED_PERMANENTLY': flag += ' 🚫 永久歇業'
        report.append((r['name'], f"{flag} ⭐{d.get('rating','-')}（{d.get('userRatingCount','-')}）"))

    if not a.dry_run:
        json.dump(rows, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        append_log(rows, today, report)
    for n, s in report: print(f'{n:　<14} {s}')
    if not a.dry_run:
        ok = sum(1 for r in rows if r.get('verified')); print(f'\n已核對 {ok}/{len(rows)} 家 → {DATA}')

if __name__ == '__main__':
    main()

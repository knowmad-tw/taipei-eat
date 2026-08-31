#!/usr/bin/env python3
"""
分批核對 OSM 店家座標與營業狀態（只用 Text Search，每月免費 5,000 次；不查評分）。
優先核對離捷運站近的店。結果寫回 data/osm.json：
  v: "2026-08-31"  核對日期（座標相符，差 <100 m）
  c: 1             Google 標示永久歇業
  x: 1             Google 找不到 / 配不到（之後不再重查）
  gd: 123          與 Google 座標的差距（公尺）
並在 data/verify_log.json 追加一筆彙總 run。

用法：
  python3 scripts/verify_osm.py --limit 190      # 預設 190（配合每日配額 200）
  python3 scripts/verify_osm.py --limit 20 --dry-run
"""
import argparse, datetime, json, math, pathlib, re, sys, time, urllib.request, urllib.error

# Google 常把「線上點餐」汙染進 reservable；速食/外送連鎖一律不算線上訂位
FASTFOOD = re.compile(r'吉野家|必勝客|達美樂|麥當勞|肯德基|漢堡王|摩斯漢堡|SUBWAY|頂呱呱|Mister Donut|星巴克|路易莎|三商巧福|八方雲集|CoCo壱番屋|すき家|Sukiya|松屋', re.I)

ROOT = pathlib.Path(__file__).resolve().parent.parent
OSM = ROOT / 'data/osm.json'
LOG = ROOT / 'data/verify_log.json'
LANG = 'zh-TW'
MATCH_M = 100

def load_key():
    import os
    k = os.environ.get('PLACES_KEY')
    if k: return k.strip()
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith('PLACES_KEY='):
                return line.split('=', 1)[1].strip().strip('"\'')
    sys.exit('找不到 PLACES_KEY')

def hav(a_lat, a_lng, b_lat, b_lng):
    R = 6371000; r = math.radians
    d = math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lng - a_lng) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(d))

def search(key, row):
    body = {'textQuery': f"{row['name']} {row.get('address') or row['district']}", 'languageCode': LANG,
            'regionCode': 'TW', 'pageSize': 1,
            'locationBias': {'circle': {'center': {'latitude': row['lat'], 'longitude': row['lng']}, 'radius': 1000.0}}}
    req = urllib.request.Request('https://places.googleapis.com/v1/places:searchText',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
                 'X-Goog-FieldMask': 'places.location,places.businessStatus,places.displayName'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=190)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--booking', action='store_true', help='查可否線上訂位（Enterprise+Atmosphere，每月免費 1,000）')
    ap.add_argument('--rating', action='store_true', help='只抓評分/評論數（Enterprise，每月免費 1,000，與訂位批次額度分開）')
    a = ap.parse_args()
    data = json.load(open(OSM, encoding='utf-8'))
    rows = data['rows']
    mrt = json.load(open(ROOT / 'data/areas.json', encoding='utf-8'))['mrt']
    def mrt_dist(r): return min(hav(r['lat'], r['lng'], s['lat'], s['lng']) for s in mrt)
    HOT = {'火鍋','燒烤','牛排','台菜','日式','韓式','泰式','義式','海鮮','精緻餐飲','自助餐','中式','港式'}
    if a.rating:
        todo = [r for r in rows if 'gr' not in r and not r.get('c') and not r.get('x')]
        todo.sort(key=lambda r: (0 if r['category'] in HOT else 1, mrt_dist(r)))
    elif a.booking:
        todo = [r for r in rows if 'b' not in r and not r.get('c') and not r.get('x')]
        todo.sort(key=lambda r: (0 if r['category'] in HOT else 1, mrt_dist(r)))
    else:
        todo = [r for r in rows if not r.get('v') and not r.get('c') and not r.get('x') and 'gd' not in r]
        todo.sort(key=mrt_dist)
    todo = todo[:a.limit]
    if a.dry_run:
        for r in todo[:10]: print('會查：', r['name'], r['district'])
        print(f'…共 {len(todo)} 筆'); return
    key = load_key()
    today = datetime.date.today().isoformat()
    if a.rating:
        got = 0
        for i, r in enumerate(todo):
            body = {'textQuery': f"{r['name']} {r.get('address') or r['district']}", 'languageCode': LANG,
                    'regionCode': 'TW', 'pageSize': 1,
                    'locationBias': {'circle': {'center': {'latitude': r['lat'], 'longitude': r['lng']}, 'radius': 800.0}}}
            req = urllib.request.Request('https://places.googleapis.com/v1/places:searchText',
                data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
                         'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.businessStatus'})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp: res = json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 429: print(f'配額到頂，停在第 {i} 筆'); break
                print(f'HTTP {e.code}，跳過 {r["name"]}'); continue
            p = (res.get('places') or [None])[0]
            if not p: r['gr'] = -1; continue          # 找不到，標記略過
            if p.get('businessStatus') == 'CLOSED_PERMANENTLY': r['c'] = 1; r['gr'] = -1; continue
            r['gr'] = p.get('rating', -1) if p.get('rating') is not None else -1
            r['grc'] = p.get('userRatingCount', 0)
            if r['gr'] > 0: got += 1
            time.sleep(0.15)
            if (i + 1) % 50 == 0: print(f'{i+1}/{len(todo)}…')
        json.dump(data, open(OSM, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        done = sum(1 for r in rows if 'gr' in r)
        print(f'本批抓到評分 {got}｜累計已查評分 {done}/{len(rows)}')
        return
    if a.booking:
        found = res_n = 0
        for i, r in enumerate(todo):
            body = {'textQuery': f"{r['name']} {r.get('address') or r['district']}", 'languageCode': LANG,
                    'regionCode': 'TW', 'pageSize': 1,
                    'locationBias': {'circle': {'center': {'latitude': r['lat'], 'longitude': r['lng']}, 'radius': 800.0}}}
            req = urllib.request.Request('https://places.googleapis.com/v1/places:searchText',
                data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
                         'X-Goog-FieldMask': 'places.id,places.reservable,places.nationalPhoneNumber,places.googleMapsUri,places.businessStatus,places.rating,places.userRatingCount'})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp: res = json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 429: print(f'配額到頂，停在第 {i} 筆'); break
                print(f'HTTP {e.code}，跳過 {r["name"]}'); continue
            p = (res.get('places') or [None])[0]
            if not p: r['b'] = 0; continue
            if p.get('businessStatus') == 'CLOSED_PERMANENTLY': r['c'] = 1; r['b'] = 0; continue
            r['b'] = 1 if (p.get('reservable') and r['category'] != '速食' and not FASTFOOD.search(r['name'])) else 0
            if r['b']: r['mapsUri'] = p.get('googleMapsUri', ''); res_n += 1
            if p.get('nationalPhoneNumber') and not r.get('phone'): r['phone'] = p['nationalPhoneNumber']; found += 1
            if p.get('rating') is not None: r['gr'] = p['rating']; r['grc'] = p.get('userRatingCount', 0)
            time.sleep(0.15)
            if (i + 1) % 50 == 0: print(f'{i+1}/{len(todo)}…')
        json.dump(data, open(OSM, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        done = sum(1 for r in rows if 'b' in r)
        print(f'本批可線上訂位 {res_n}、補到電話 {found}｜累計已查訂位 {done}/{len(rows)}')
        return
    ok = closed = miss = far = 0
    problems = []
    for i, r in enumerate(todo):
        res, err = search(key, r)
        if err == 429:
            print(f'配額到頂，停在第 {i} 筆'); break
        if err: print(f'HTTP {err}，跳過 {r["name"]}'); continue
        p = (res.get('places') or [None])[0]
        if not p:
            r['x'] = 1; miss += 1
            continue
        loc = p['location']; d = hav(r['lat'], r['lng'], loc['latitude'], loc['longitude'])
        r['gd'] = round(d)
        if p.get('businessStatus') == 'CLOSED_PERMANENTLY':
            r['c'] = 1; closed += 1
            problems.append({'date': today, 'id': r['id'], 'name': r['name'], 'result': 'closed',
                             'note': 'Google 標示永久歇業', 'distanceM': round(d)})
        elif d <= MATCH_M:
            r['v'] = today; ok += 1
        else:
            far += 1
            problems.append({'date': today, 'id': r['id'], 'name': r['name'], 'result': 'mismatch',
                             'note': f'與 Google 座標差 {d:.0f} m，待人工確認', 'distanceM': round(d)})
        time.sleep(0.15)
        if (i + 1) % 50 == 0: print(f'{i+1}/{len(todo)}…')
    json.dump(data, open(OSM, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    log = json.load(open(LOG, encoding='utf-8')) if LOG.exists() else {'runs': []}
    log['runs'].append({'date': today, 'by': 'scripts/verify_osm.py',
        'entries': [{'date': today, 'id': 'osm-batch', 'name': f'OSM 批次核對（{ok+closed+miss+far} 家）',
                     'result': 'match', 'note': f'相符 {ok}、歇業 {closed}、找不到 {miss}、差距過大 {far}',
                     'distanceM': None, 'rating': None, 'ratingCount': None}] + problems})
    json.dump(log, open(LOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    done = sum(1 for r in rows if r.get('v') or r.get('c') or r.get('x'))
    print(f'本批：相符 {ok}、歇業 {closed}、找不到 {miss}、差距大 {far}｜累計已核對 {done}/{len(rows)}')

if __name__ == '__main__':
    main()

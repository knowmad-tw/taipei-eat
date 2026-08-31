#!/usr/bin/env python3
"""
從 OpenStreetMap (Overpass API) 抓台北市餐廳 / 咖啡 / 速食 / 美食街，
轉成精簡的 data/osm.json 供網站使用。

用法：
  python3 scripts/fetch_osm.py                # 線上抓取（約 5MB，Overpass 偶爾限流，失敗就再試）
  python3 scripts/fetch_osm.py --input raw.json   # 用已下載的 Overpass 回應

授權：OpenStreetMap contributors, ODbL — 網站頁尾須保留 attribution。
"""
import argparse, json, math, sys, urllib.request, urllib.parse, pathlib, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
QUERY = '''[out:json][timeout:120];
area["name:zh"="臺北市"]["admin_level"="4"]->.a;
(
  node["amenity"~"^(restaurant|cafe|fast_food|food_court)$"](area.a);
  way["amenity"~"^(restaurant|cafe|fast_food|food_court)$"](area.a);
);
out center tags;'''

# OSM cuisine → 網站類型（中文）
CUISINE = {
    'chinese': '中式', 'taiwanese': '台菜', 'regional': '台菜', 'cantonese': '港式', 'dim_sum': '小籠包/點心',
    'dumplings': '小籠包/點心', 'bao': '小籠包/點心', 'hotpot': '火鍋', 'hot_pot': '火鍋', 'shabu': '火鍋',
    'beef_noodle': '麵食', 'noodle': '麵食', 'noodles': '麵食', 'ramen': '日式', 'udon': '日式', 'soba': '日式',
    'japanese': '日式', 'sushi': '日式', 'izakaya': '日式', 'donburi': '日式', 'beef_bowl': '日式', 'curry': '日式',
    'korean': '韓式', 'thai': '泰式', 'vietnamese': '越式', 'indian': '印度', 'asian': '亞洲',
    'italian': '義式', 'pizza': '義式', 'pasta': '義式', 'french': '法式', 'spanish': '西式', 'german': '西式',
    'american': '美式', 'burger': '美式', 'steak_house': '牛排', 'steak': '牛排', 'bbq': '燒烤', 'barbecue': '燒烤',
    'grill': '燒烤', 'yakitori': '燒烤', 'seafood': '海鮮', 'vegetarian': '素食', 'vegan': '素食',
    'breakfast': '早餐', 'brunch': '早午餐', 'coffee_shop': '甜點/咖啡', 'cafe': '甜點/咖啡', 'dessert': '甜點/咖啡',
    'ice_cream': '甜點/咖啡', 'cake': '甜點/咖啡', 'bakery': '甜點/咖啡', 'tea': '茶飲', 'bubble_tea': '茶飲',
    'juice': '茶飲', 'chicken': '小吃', 'fried_chicken': '小吃', 'sandwich': '輕食', 'salad': '輕食',
    'mexican': '墨西哥', 'middle_eastern': '中東', 'turkish': '中東', 'kebab': '中東', 'buffet': '自助餐',
}
AMENITY_FALLBACK = {'restaurant': '餐廳', 'cafe': '甜點/咖啡', 'fast_food': '速食', 'food_court': '美食街'}

def load_areas():
    return json.load(open(ROOT / 'data/areas.json', encoding='utf-8'))['districts']

def nearest_district(lat, lng, districts):
    best, bd = '', 1e9
    for d in districts:
        dd = (d['lat'] - lat) ** 2 + ((d['lng'] - lng) * math.cos(math.radians(lat))) ** 2
        if dd < bd: best, bd = d['name'], dd
    return best

def norm_district(s):
    s = (s or '').replace('台', '臺').replace('臺北市', '').strip()
    if s and not s.endswith('區'): s += '區'
    return s.replace('臺', '台') if s else ''

def fetch():
    data = urllib.parse.urlencode({'data': QUERY}).encode()
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=data,
                                 headers={'User-Agent': 'taipei-eat-what/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', help='已下載的 Overpass JSON')
    ap.add_argument('--output', default=str(ROOT / 'data/osm.json'))
    a = ap.parse_args()

    raw = json.load(open(a.input, encoding='utf-8')) if a.input else fetch()
    districts = load_areas()
    valid = {d['name'] for d in districts}
    out, seen = [], set()
    for e in raw['elements']:
        t = e.get('tags') or {}
        name = t.get('name') or t.get('name:zh')
        if not name: continue
        lat = e.get('lat') or (e.get('center') or {}).get('lat')
        lng = e.get('lon') or (e.get('center') or {}).get('lon')
        if not lat or not lng: continue
        key = (name, round(lat, 4), round(lng, 4))
        if key in seen: continue
        seen.add(key)

        cuisines = [c.strip() for c in (t.get('cuisine') or '').lower().split(';') if c.strip()]
        cat = next((CUISINE[c] for c in cuisines if c in CUISINE), None) or AMENITY_FALLBACK.get(t.get('amenity'), '餐廳')
        dist = norm_district(t.get('addr:district'))
        if dist not in valid: dist = nearest_district(lat, lng, districts)
        addr = t.get('addr:full') or ' '.join(filter(None, [t.get('addr:street'), t.get('addr:housenumber') and t['addr:housenumber'] + '號']))
        row = {
            'id': f"osm-{e['type'][0]}{e['id']}",
            'name': name, 'lat': round(lat, 6), 'lng': round(lng, 6),
            'category': cat, 'district': dist,
        }
        if addr: row['address'] = addr
        if t.get('opening_hours'): row['hours'] = t['opening_hours']
        ph = t.get('phone') or t.get('contact:phone')
        if ph: row['phone'] = ph.split(';')[0].strip()
        web = t.get('website') or t.get('contact:website')
        if web: row['url'] = web
        if cuisines: row['tags'] = cuisines[:4]
        if t.get('name:en'): row['en'] = t['name:en']
        out.append(row)

    out.sort(key=lambda r: (r['district'], r['name']))
    payload = {'source': 'OpenStreetMap', 'license': 'ODbL',
               'fetched': datetime.date.today().isoformat(), 'count': len(out), 'rows': out}
    json.dump(payload, open(a.output, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} rows → {a.output}')

if __name__ == '__main__':
    main()

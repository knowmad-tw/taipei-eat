/* 台北吃什麼 — 核心：現在訂得到位的餐廳 */
(() => {
  'use strict';

  const TAIPEI = { lat: 25.04, lng: 121.545 };
  const PRICE_LABEL = { 1: '$', 2: '$$', 3: '$$$', 4: '$$$$' };
  // 統一取評分：精選用 google.rating，OSM 用 gr/grc（-1 = 查過但沒有）
  const ratingOf = (r) => r.google?.rating ?? (r.gr > 0 ? r.gr : null);
  const ratingCountOf = (r) => r.google?.userRatingCount ?? (r.gr > 0 ? r.grc || 0 : 0);
  // 類型插圖
  const CAT_ICON = {
    '小籠包/點心': '🥟', '早餐': '🍳', '麵食': '🍜', '小吃': '🥡', '夜市': '🏮',
    '精緻餐飲': '🥂', '台菜': '🍚', '火鍋': '🍲', '日式': '🍣', '甜點/咖啡': '☕',
    '早午餐': '🥞', '美食街': '🏬', '自助餐': '🍱', '茶飲': '🧋', '亞洲': '🌏',
    '餐廳': '🍴', '美式': '🍔', '義式': '🍝', '中式': '🥘', '輕食': '🥗',
    '韓式': '🌶️', '牛排': '🥩', '速食': '🍟', '中東': '🥙', '印度': '🍛',
    '海鮮': '🦐', '燒烤': '🍖', '越式': '🥖', '港式': '🥠', '法式': '🥐',
    '墨西哥': '🌮', '西式': '🍽️', '素食': '🥬',
  };
  const catIcon = (c) => CAT_ICON[c] || '🍴';
  const MAX_SHOW = 300;

  const state = {
    restaurants: [], osm: [],
    mode: 'online',          // online = 只線上（預設） | book = 線上+電話 | all = 全部
    origin: null, radius: 0,
    q: '', category: new Set(), occasion: new Set(), price: new Set(),
    districts: [],
    mrtNear: 0,            // 0 = 不限；否則只留離任一捷運站 N 公尺內
    minRating: 0,          // 0 = 不篩；4.5 = 「評分超高」模式（且評論數 ≥ 100）
    mrtStations: [],
    activeId: null,
    avatar: 'mascot',      // 自己位置的造型，訪客可改（localStorage）
  };
  try { state.avatar = localStorage.getItem('me-avatar') || 'mascot'; } catch {}

  const $ = (id) => document.getElementById(id);
  const el = {
    map: $('map'), list: $('list'), count: $('count'), sortNote: $('sortNote'),
    q: $('q'), districtSel: $('districtSel'), mrtSel: $('mrtSel'),
    locateBtn: $('locateBtn'), clearLocBtn: $('clearLocBtn'),
    whereNote: $('whereNote'), radiusRow: $('radiusRow'), radiusSel: $('radiusSel'),
    categoryChips: $('categoryChips'), occasionChips: $('occasionChips'), priceChips: $('priceChips'),
    modeChips: $('modeChips'), modeNote: $('modeNote'), mrtChips: $('mrtChips'),
    locStatus: $('locStatus'), locStatusText: $('locStatusText'),
    resetBtn: $('resetBtn'), randomBtn: $('randomBtn'), recoBtn: $('recoBtn'), topBtn: $('topBtn'),
  };

  // ---------- 訂位判斷（核心） ----------
  // level 2 = 線上訂位（Google 標示 reservable）；1 = 有電話可訂；0 = 只能現場
  function bookLevel(r) {
    if (r.booking?.reservable || r.b === 1) return 2;   // 精選 Google reservable 或 OSM 補查到可訂
    if (r.phone) return 1;
    return 0;
  }
  function bookBadge(r) {
    const lv = bookLevel(r);
    if (lv === 2) return '<span class="bk online">🪑 線上訂位</span>';
    if (lv === 1) return '<span class="bk phone">📞 電話訂位</span>';
    return '<span class="bk none">現場排隊</span>';
  }
  function bookCtaParts(r) {
    const lv = bookLevel(r);
    const parts = [];
    if (lv === 2) {
      const u = r.google?.mapsUri || r.mapsUri || r.url;
      if (u) parts.push(`<a class="cta" href="${esc(u)}" target="_blank" rel="noopener noreferrer">🪑 馬上線上訂位</a>`);
    }
    if (r.phone) parts.push(`<a class="cta tel" href="tel:${esc(r.phone.replace(/[\s-]/g, ''))}">📞 ${esc(fmtPhone(r.phone))}</a>`);
    return parts;
  }
  function bookCta(r) {
    const parts = bookCtaParts(r);
    parts.push(`<a class="cta ghost" href="${navUrl(r)}" target="_blank" rel="noopener noreferrer">🧭 導航</a>`);
    return `<div class="cta-row">${parts.join('')}</div>`;
  }

  // ---------- 詳細 modal ----------
  function showDetail(r) {
    const g = r.google;
    const wrap = document.createElement('div');
    wrap.className = 'pick';
    wrap.innerHTML = `
      <div class="box detail">
        <button class="close" data-act="close" type="button">✕</button>
        <h2>${esc(r.name)}</h2>
        <div class="meta" style="color:#666">${catIcon(r.category)} ${esc(r.category)}${r.price ? ` · ${PRICE_LABEL[r.price]}` : ''} · ${esc(r.district)}${r.dist != null ? ` · <span style="color:#e8792b">${fmtDist(r.dist)}</span>` : ''}</div>
        ${r.reason ? `<div class="why"><b>為什麼推</b>${esc(r.reason)}</div>` : ''}
        ${(() => { const html = googleBlock(r); if (html) return html.replace('<details>', '<details open>');
          return ratingOf(r) != null ? `<div class="g"><span class="g-rating">⭐ ${ratingOf(r).toFixed(1)}</span> <span class="muted">（${ratingCountOf(r).toLocaleString()} 則 · Google）</span> <a class="all-reviews" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || ''))}" target="_blank" rel="noopener noreferrer">去 Google 看評論 ↗</a></div>` : ''; })()}
        ${bookCta(r)}
        <div class="hours">🕒 ${esc(r.hours || '—')}</div>
        <div class="hours">📍 ${esc(r.address || '—')}</div>
        <div class="loc ${locInfo(r).cls}">${locInfo(r).text}</div>
        <div class="links">
          ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">官網 ↗</a>` : ''}
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ' ' + (r.address || ''))}" target="_blank" rel="noopener noreferrer">Google 地圖 ↗</a>
          ${r.source ? `<span class="muted">來源：${esc(r.source)}</span>` : ''}
        </div>
      </div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.dataset.act === 'close') close(); });
    document.body.appendChild(wrap);
  }

  // ---------- 距離 / 導航 ----------
  function haversine(a, b) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const fmtDist = (m) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  function locInfo(r) {
    const g = r.google;
    if (r.verified) return { ok: true, cls: 'ok', text: '📍 可直接導航（Google 核對相符）' };
    if (r.osm && r.v) return { ok: true, cls: 'ok', text: '📍 可直接導航（Google 核對相符）' };
    if (r.osm && r.gd > 100) return { ok: false, cls: 'approx', text: `📍 座標與 Google 差 ${r.gd} m，待確認` };
    if (r.osm) return { ok: true, cls: 'ok', text: '📍 可直接導航（OSM 座標）' };
    if (g?.found && g.distanceM > 50) return { ok: false, cls: 'approx', text: `📍 座標與 Google 差 ${g.distanceM} m` };
    return { ok: false, cls: 'approx', text: '📍 座標尚未核對' };
  }
  const navUrl = (r) => 'https://www.google.com/maps/dir/?api=1&destination=' +
    (locInfo(r).ok ? `${r.lat},${r.lng}` : encodeURIComponent(r.name + ' ' + (r.address || '')));

  // ---------- Google 評分 ----------
  function googleBlock(r) {
    const g = r.google; if (!g || !g.found) return '';
    const age = Math.floor((Date.now() - new Date(g.checkedAt)) / 86400000);
    const stale = age > 30;
    const closed = g.businessStatus === 'CLOSED_PERMANENTLY' ? ' <span class="ink-red">🚫 永久歇業</span>' : '';
    const reviews = (g.reviews || []).map((v) =>
      `<li><b>${'★'.repeat(v.rating || 0)}</b> ${esc(v.text)} <span class="muted">— ${esc(v.author)}，${esc(v.when)}</span></li>`).join('');
    return `<div class="g${stale ? ' stale' : ''}">
      <span class="g-rating">${g.rating != null ? `⭐ ${g.rating.toFixed(1)}` : '無評分'}</span>
      <span class="muted">（${(g.userRatingCount || 0).toLocaleString()} 則）</span>${closed}
      <a class="all-reviews" href="${esc(g.mapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}`)}" target="_blank" rel="noopener noreferrer">去 Google 看全部評論 ↗</a>
      ${reviews ? `<details><summary>網友留言（${g.reviews.length}）</summary><ul class="reviews">${reviews}</ul></details>` : ''}
    </div>`;
  }

  // ---------- 地圖 ----------
  const map = L.map(el.map, { scrollWheelZoom: true }).setView([TAIPEI.lat, TAIPEI.lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  let meMarker = null, radiusCircle = null;
  const markers = new Map();
  const pinIcon = (active, lv) => L.divIcon({
    className: '', html: `<div class="pin${active ? ' active' : ''} lv${lv}"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10],
  });
  const MASCOT_SVG = `
      <svg class="me-mascot" viewBox="0 0 64 64">
        <circle cx="19" cy="13" r="7" fill="#111"/>
        <circle cx="45" cy="13" r="7" fill="#111"/>
        <path d="M32 6 C45 6 55 15 56 30 C57 44 49 56 32 56 C15 56 7 44 8 30 C9 15 19 6 32 6 Z" fill="#111"/>
        <circle cx="23" cy="28" r="3.6" fill="#fff"/>
        <circle cx="41" cy="28" r="3.6" fill="#fff"/>
        <circle cx="24.2" cy="27.2" r="1.2" fill="#111"/>
        <circle cx="42.2" cy="27.2" r="1.2" fill="#111"/>
        <ellipse cx="32" cy="39" rx="6.2" ry="4.6" fill="#fff"/>
        <circle cx="32" cy="37.4" r="1.9" fill="#111"/>
        <path d="M29.6 41.6 Q32 43.4 34.4 41.6" stroke="#111" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <path d="M23 51 L32 55.5 L41 51" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="14.5" cy="35" r="2.4" fill="#d63b2f" opacity=".7"/>
        <circle cx="49.5" cy="35" r="2.4" fill="#d63b2f" opacity=".7"/>
      </svg>
`;
  const meIcon = () => L.divIcon({
    className: '', iconSize: [44, 52], iconAnchor: [22, 44],
    html: `<div class="me-wrap">
      ${state.avatar === 'mascot' ? MASCOT_SVG : `<span class="me-mascot me-emoji">${esc(state.avatar)}</span>`}
      <div class="me-pulse"></div>
    </div>`,
  });

  function drawOrigin() {
    if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
    if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
    if (!state.origin) return;
    meMarker = L.marker([state.origin.lat, state.origin.lng], { icon: meIcon(), zIndexOffset: 1000 })
      .bindTooltip(state.origin.kind === 'gps' ? `${state.avatar === 'mascot' ? '🐻' : state.avatar} 你在這！` : `${state.avatar === 'mascot' ? '🐻' : state.avatar} ${state.origin.label}`,
        { permanent: true, direction: 'top', offset: [0, -46], className: 'me-tip' }).addTo(map);
    if (state.radius > 0) {
      radiusCircle = L.circle([state.origin.lat, state.origin.lng], {
        radius: state.radius, color: '#2b6cb0', weight: 1.5, dashArray: '6 6', fillOpacity: 0.04,
      }).addTo(map);
    }
  }

  // 最近捷運站（快取）
  const mrtCache = new Map();
  function nearestMrt(r) {
    if (mrtCache.has(r.id)) return mrtCache.get(r.id);
    let best = null;
    for (const s of state.mrtStations) {
      const d = haversine(r, s);
      if (!best || d < best.dist) best = { name: s.name, dist: d };
    }
    mrtCache.set(r.id, best);
    return best;
  }

  // 關鍵字比對：完整包含 > 空白斷詞全中 > 二字詞覆蓋（「西門和牛涮」也抓得到「和牛涮 西門店」）
  function matchScore(hay, q) {
    if (hay.includes(q)) return 3;
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => hay.includes(t))) return 2;
    if (q.length >= 3) {
      const grams = []; for (let i = 0; i < q.length - 1; i++) grams.push(q.slice(i, i + 2));
      const hit = grams.filter((g) => hay.includes(g)).length / grams.length;
      if (hit >= 0.7) return 1 + hit;
    }
    return 0;
  }

  // 從查詢字串拆出地名（捷運站 / 行政區 / 常見別名），回傳 {rest, bias}
  const LOC_ALIAS = { '西門町': '西門', '東區': '忠孝敦化', '信義區': '市政府', '永康街': '東門', '師大': '台電大樓', '天母': '士林', '內湖': '港墘', '南港': '南港展覽館', '北投': '新北投', '貓空': '動物園' };
  function splitLocation(q) {
    const names = [];
    state.mrtStations.forEach((s) => names.push({ n: s.name, p: s }));
    state.districts.forEach((d) => names.push({ n: d.name, p: d }));
    for (const [alias, target] of Object.entries(LOC_ALIAS)) {
      const s = state.mrtStations.find((x) => x.name === target);
      if (s) names.push({ n: alias, p: s });
    }
    names.sort((a, b) => b.n.length - a.n.length);
    for (const { n, p } of names) {
      const low = n.toLowerCase();
      if (q.includes(low)) {
        const rest = q.replace(low, '').trim();
        if (rest.length >= 2) return { rest, bias: { lat: p.lat, lng: p.lng, name: n } };
      }
    }
    return { rest: q, bias: null };
  }

  // ---------- 篩選 ----------
  function filtered() {
    let q = state.q.trim().toLowerCase();
    let bias = null;
    if (q) { const sp = splitLocation(q); q = sp.rest; bias = sp.bias; }
    // OSM 店家已補電話/訂位資訊，所有模式都納入
    const pool = state.restaurants.concat(state.osm);
    const biasDist = (r) => bias ? haversine(bias, r) : null;
    let rows = pool.map((r) => ({ ...r, dist: state.origin ? haversine(state.origin, r) : null, lv: bookLevel(r) }));
    if (!q && state.mode === 'book') rows = rows.filter((r) => r.lv > 0 && r.google?.businessStatus !== 'CLOSED_PERMANENTLY');
    if (!q && state.mode === 'online') rows = rows.filter((r) => r.lv === 2 && r.google?.businessStatus !== 'CLOSED_PERMANENTLY');
    if (q) {
      rows = rows.map((r) => ({ ...r, score: matchScore(
        [r.name, r.en, r.category, r.district, r.mrt, nearestMrt(r)?.name, r.address, r.reason, r.source, ...(r.tags || []), ...(r.occasions || [])]
          .join(' ').toLowerCase(), q) }))
        .filter((r) => r.score > 0);
    }
    if (state.category.size) rows = rows.filter((r) => state.category.has(r.category));
    if (state.occasion.size) rows = rows.filter((r) => (r.occasions || []).some((o) => state.occasion.has(o)));
    if (state.price.size) rows = rows.filter((r) => state.price.has(String(r.price)));
    if (state.mrtNear > 0) rows = rows.filter((r) => { const m = nearestMrt(r); return m && m.dist <= state.mrtNear; });
    if (state.origin && state.radius > 0) rows = rows.filter((r) => r.dist <= state.radius);
    if (state.minRating) rows = rows.filter((r) => (ratingOf(r) ?? 0) >= state.minRating && ratingCountOf(r) >= 100);
    // 搜尋時比對分數優先，其次離查詢地名近的；「評分超高」模式高分在前；否則訂位等級優先；再依距離 / 名稱
    rows.sort((a, b) => (q ? (b.score - a.score) : 0) ||
      (bias ? biasDist(a) - biasDist(b) : 0) ||
      (state.minRating ? (ratingOf(b) ?? 0) - (ratingOf(a) ?? 0) : 0) || (b.lv - a.lv) ||
      (state.origin ? a.dist - b.dist : a.name.localeCompare(b.name, 'zh-Hant')));
    if (bias) rows.biasName = bias.name;
    return rows;
  }

  // ---------- 畫面 ----------
  function render() {
    const all = filtered();
    const rows = all.slice(0, MAX_SHOW);
    const online = all.filter((r) => r.lv === 2).length, tel = all.filter((r) => r.lv === 1).length;
    el.count.textContent = all.length
      ? `${all.length} 家${state.mode !== 'all' ? `（線上訂位 ${online}、電話 ${tel}）` : ''}${all.length > MAX_SHOW ? `，顯示前 ${MAX_SHOW}` : ''}`
      : '';
    el.sortNote.textContent = state.q.trim() ? `搜尋全部店家，最像的排前面${all.biasName ? `，離「${all.biasName}」近的優先` : ''}` :
      (state.minRating ? `⭐ ${state.minRating} 以上（100+ 則評論）高分在前，` : '') +
      (state.mode === 'all' ? '' : '線上訂位優先，') +
      (state.origin ? `依距離「${state.origin.label}」排序` : '設定位置後依距離排序');

    markerLayer.clearLayers(); markers.clear();
    el.list.innerHTML = '';
    if (!rows.length) {
      el.list.innerHTML = '<li class="empty">沒有符合的 — 放寬半徑或條件，或切到「全部店家」。</li>';
      return;
    }
    const frag = document.createDocumentFragment();
    const labelAll = rows.length <= 60;   // 店少時直接長出名字標籤，多了改滑過顯示
    rows.forEach((r) => {
      const m = L.marker([r.lat, r.lng], { icon: pinIcon(r.id === state.activeId, r.lv) })
        .bindTooltip(
          state.minRating && ratingOf(r) != null
            ? `⭐${ratingOf(r).toFixed(1)}（${ratingCountOf(r).toLocaleString()} 則）${esc(r.name)}`
            : `${catIcon(r.category)} ${esc(r.name)}${r.lv === 2 ? ' 🪑' : r.lv === 1 ? ' 📞' : ''}`,
          { permanent: labelAll, direction: 'top', offset: [0, -8], className: 'pin-tip' })
        .bindPopup(`<b>${esc(r.name)}</b><br><a href="${navUrl(r)}" target="_blank" rel="noopener noreferrer">🧭 導航</a>`);
      m.on('click', () => setActive(r.id, false));
      markerLayer.addLayer(m); markers.set(r.id, m);

      const li = document.createElement('li');
      li.className = 'card' + (r.id === state.activeId ? ' active' : '') + (r.osm ? ' osm' : '');
      li.dataset.id = r.id;
      const g = r.google;
      const place = `${esc(r.district)}${(() => { const m = state.mrtNear > 0 || !r.mrt ? nearestMrt(r) : null; return r.mrt && !m ? ` · 捷運${esc(r.mrt)}` : (m && m.dist < 1200 ? ` · 🚇 ${esc(m.name)} ${fmtDist(m.dist)}` : ''); })()}`;
      li.innerHTML = `
        <div class="card-top">
          <span class="cat-tag${catWarm(r.category) ? ' warm' : ''}"><span class="ci">${catIcon(r.category)}</span>${esc(r.category)}</span>
          ${r.price ? `<span class="price-tag">${PRICE_LABEL[r.price]}</span>` : ''}
          ${r.dist != null ? `<span class="dist">${fmtDist(r.dist)}</span>` : ''}
        </div>
        <div class="card-head">
          <h3>${esc(r.name)}</h3>
          ${ratingOf(r) != null ? `<button class="stamp" type="button" title="看網友評語">⭐ ${ratingOf(r).toFixed(1)}<small>${ratingCountOf(r).toLocaleString()} 則</small></button>` : ''}
        </div>
        <div class="meta">📍 ${place}</div>
        <div class="cta-row">${bookCtaParts(r).join('')}<button class="cta ghost more" type="button">⋯ 更多</button></div>`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.more') || e.target.closest('.stamp')) { showDetail(r); return; }
        if (e.target.tagName !== 'A') setActive(r.id, true);
      });
      frag.appendChild(li);
    });
    if (all.length > MAX_SHOW) {
      const li = document.createElement('li'); li.className = 'cap-note';
      li.textContent = '只顯示前 300 家 — 設定位置或加條件縮小範圍';
      frag.appendChild(li);
    }
    el.list.appendChild(frag);
    if (!state.origin && rows.length) map.fitBounds(rows.map((r) => [r.lat, r.lng]), { padding: [24, 24], maxZoom: 15 });
  }

  function setActive(id, fly) {
    state.activeId = id;
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
    const rowOf = (mid) => state.restaurants.concat(state.osm).find((r) => r.id === mid);
    markers.forEach((m, mid) => m.setIcon(pinIcon(mid === id, bookLevel(rowOf(mid) || {}))));
    const m = markers.get(id);
    if (m) {
      if (fly) map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: .6 });
      m.openPopup();
      if (!fly) document.querySelector(`.card[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function setOrigin(origin) {
    state.origin = origin;
    el.radiusRow.hidden = !origin;
    el.whereNote.textContent = origin
      ? `以「${origin.label}」為中心${state.radius ? `，只顯示 ${fmtDist(state.radius)} 內` : ''}`
      : '尚未設定位置 — 顯示全台北。';
    if (origin && origin.kind !== 'district') el.districtSel.value = '';
    if (origin && origin.kind !== 'mrt') el.mrtSel.value = '';
    if (!origin) { el.districtSel.value = ''; el.mrtSel.value = ''; }
    drawOrigin();
    refreshLocStatus();
    const pw = $('pickedWhere'); if (pw) pw.textContent = origin ? origin.label.replace('目前位置（', '').replace(/）$/, '') : '';
    if (origin) {
      const z = state.radius === 0 ? 13 : state.radius <= 1000 ? 15 : 14;
      map.flyTo([origin.lat, origin.lng], z, { duration: .6 });
    }
    render();
  }

  // ---------- chips ----------
  function buildChips(container, values) {
    container.innerHTML = values.map((v) => `<button class="chip" data-value="${esc(v)}" type="button">${esc(v)}</button>`).join('');
  }
  function buildChipsIcon(container, values) {
    container.innerHTML = values.map((v) => `<button class="chip" data-value="${esc(v)}" type="button"><span class="ci">${catIcon(v)}</span>${esc(v)}</button>`).join('');
  }
  function bindChips(container, set) {
    container.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      const v = b.dataset.value;
      set.has(v) ? set.delete(v) : set.add(v);
      b.classList.toggle('on', set.has(v));
      updatePicked();
      render();
    });
  }
  // 摺疊列上顯示已選條件，收合也看得到
  function updatePicked() {
    $('pickedCategory').textContent = state.category.size ? [...state.category].join('、') : '';
    const op = [...state.occasion, ...[...state.price].map((p) => PRICE_LABEL[p])];
    $('pickedOccasion').textContent = op.length ? op.join('、') : '';
  }
  function clearChips() {
    document.querySelectorAll('.chips:not(#modeChips) .chip.on').forEach((c) => c.classList.remove('on'));
    state.category.clear(); state.occasion.clear(); state.price.clear();
    state.minRating = 0; if (el.topBtn) el.topBtn.classList.remove('on');
  }

  // ---------- 隨機訂一家 ----------
  function randomPick() {
    const pool = filtered().filter((r) => state.mode === 'all' || r.lv > 0);
    if (!pool.length) return;
    const r = pool[Math.floor(Math.random() * pool.length)];
    const wrap = document.createElement('div');
    wrap.className = 'pick';
    wrap.innerHTML = `
      <div class="box">
        <div class="kicker">今天就吃這家 ↓</div>
        <h2>${esc(r.name)}</h2>
        <div class="meta" style="color:#666">${catIcon(r.category)} ${esc(r.category)}${r.price ? ` · ${PRICE_LABEL[r.price]}` : ''} · ${esc(r.district)}${r.dist != null ? ` · <span style="color:#e8792b">${fmtDist(r.dist)}</span>` : ''}</div>
        <p style="margin:10px 0 0">${esc(r.reason || '')}</p>
        ${bookCta(r)}
        <div class="row">
          <button class="btn btn-orange" data-act="again" type="button">再抽一次</button>
          <button class="btn" data-act="go" type="button">看這家</button>
          <button class="btn btn-ghost" data-act="close" type="button">關閉</button>
        </div>
      </div>`;
    wrap.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (act === 'again') { wrap.remove(); randomPick(); }
      else if (act === 'go') {
        wrap.remove();
        el.map.scrollIntoView({ behavior: 'smooth', block: 'center' });   // 先讓地圖進畫面
        if (!markers.get(r.id)) {
          const tm = L.marker([r.lat, r.lng], { icon: pinIcon(true, bookLevel(r)), zIndexOffset: 900 })
            .bindTooltip(`${catIcon(r.category)} ${esc(r.name)}`, { permanent: true, direction: 'top', offset: [0, -8], className: 'pin-tip' });
          markerLayer.addLayer(tm); markers.set(r.id, tm);
        }
        map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 16), { duration: .8 });
        setActive(r.id, false);
      }
      else if (act === 'close' || e.target === wrap) wrap.remove();
    });
    document.body.appendChild(wrap);
  }

  // ---------- 定位 ----------
  function setLocStatus(stateName, text) {
    el.locStatus.dataset.state = stateName;
    el.locStatusText.textContent = text;
    el.locateBtn.disabled = stateName === 'unsupported' || stateName === 'denied';
  }
  async function probeGeolocation() {
    if (!navigator.geolocation) return setLocStatus('unsupported', '此瀏覽器不支援 GPS；請選行政區 / 捷運站');
    if (!window.isSecureContext) return setLocStatus('unsupported', 'GPS 需要 https 或 localhost；請選行政區 / 捷運站');
    try {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      const apply = () => {
        if (state.origin?.kind === 'gps') return;
        if (p.state === 'denied') setLocStatus('denied', 'GPS 權限已拒絕；請選行政區 / 捷運站');
        else setLocStatus('ready', p.state === 'granted' ? '可定位（已授權）' : '可定位 — 按定位時瀏覽器會詢問');
      };
      apply(); p.onchange = apply;
    } catch { setLocStatus('ready', '可定位 — 按定位時瀏覽器會詢問'); }
  }
  function refreshLocStatus() {
    const o = state.origin;
    if (!o) return probeGeolocation();
    setLocStatus('on', o.kind === 'gps' ? `GPS ✓ ${o.label.replace('目前位置（', '').replace(/）$/, '')}` : `以「${o.label}」為中心`);
  }
  // 用行政區中心 + 捷運站描述 GPS 位置（不需外部服務）
  function describePoint(lat, lng) {
    let d = null;
    for (const x of state.districts) {
      const dd = haversine({ lat, lng }, x);
      if (!d || dd < d.dist) d = { name: x.name, dist: dd };
    }
    let m = null;
    for (const x of state.mrtStations) {
      const dd = haversine({ lat, lng }, x);
      if (!m || dd < m.dist) m = { name: x.name, dist: dd };
    }
    let label = d ? d.name : '目前位置';
    if (m && m.dist < 1500) label += ` · 近捷運${m.name} ${fmtDist(m.dist)}`;
    return label;
  }

  function locate(onDone) {
    if (!navigator.geolocation) { setLocStatus('unsupported', '瀏覽器不支援定位。'); onDone?.(false); return; }
    setLocStatus('busy', '定位中…請允許瀏覽器取得位置');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setOrigin({ lat, lng, label: `目前位置（${describePoint(lat, lng)}）`, kind: 'gps' });
        if (haversine({ lat, lng }, TAIPEI) > 30000) el.whereNote.textContent += '（你好像不在台北）';
        onDone?.(true);
      },
      (err) => {
        setLocStatus(err.code === 1 ? 'denied' : 'ready', err.code === 1
          ? 'GPS 權限被拒絕；請選行政區 / 捷運站' : `定位失敗（${err.message}）`);
        onDone?.(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // ---------- 地圖 modal：先看地圖，關掉再看清單 ----------
  let mapHome = null;   // 地圖原本的位置
  function showMapModal(fitPts) {
    if (document.querySelector('.map-modal')) return;
    mapHome = { parent: el.map.parentNode, next: el.map.nextSibling };
    const wrap = document.createElement('div');
    wrap.className = 'pick map-modal';
    wrap.innerHTML = `
      <div class="box map-box">
        <div class="map-box-head">
          <span>附近訂得到位的店 — <span class="ink-orange">關掉地圖看下方清單細節</span></span>
          <button class="close" data-act="close" type="button">✕ 關閉</button>
        </div>
        <div class="map-slot"></div>
      </div>`;
    const close = () => {
      mapHome.parent.insertBefore(el.map, mapHome.next);
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { map.invalidateSize(); if (fitPts?.length) map.fitBounds(fitPts, { padding: [24, 24], maxZoom: 16 }); }, 50);
      document.querySelector('.results-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.dataset.act === 'close') close(); });
    document.body.appendChild(wrap);
    wrap.querySelector('.map-slot').appendChild(el.map);
    setTimeout(() => { map.invalidateSize(); if (fitPts?.length) map.fitBounds(fitPts, { padding: [40, 40], maxZoom: 16 }); }, 50);
  }

  // ---------- 一鍵：找附近訂得到位的 ----------
  function recommendBookable() {
    clearChips(); updatePicked(); state.q = ''; el.q.value = '';
    setMode('online');
    state.radius = 1000; el.radiusSel.value = '1000';   // 「附近」= 1 km 內
    el.recoBtn.classList.add('busy');
    const finish = () => {
      el.recoBtn.classList.remove('busy');
      // 1 km 沒有 → 自動放寬到 2 km、5 km、不限
      for (const m of [2000, 5000, 0]) {
        if (filtered().length) break;
        state.radius = m; el.radiusSel.value = String(m);
        setOrigin(state.origin);
      }
      if (state.radius !== 1000 && state.origin) {
        el.whereNote.textContent += `（1 km 內沒有可線上訂位的店，已放寬到 ${state.radius ? fmtDist(state.radius) : '不限'}）`;
      }
      // 先用大地圖 modal 呈現所有結果 + 你的位置，關掉再看清單
      const rows = filtered();
      const pts = rows.map((r) => [r.lat, r.lng]);
      if (state.origin) pts.push([state.origin.lat, state.origin.lng]);
      if (rows.length) showMapModal(pts);
    };
    if (state.origin?.kind === 'gps') { setOrigin(state.origin); finish(); }
    else locate(finish);
  }

  // ---------- 一鍵：評分超高可訂位（可再點一次取消） ----------
  // 自動縮放到能看到所有結果點位
  function fitToResults() {
    const rows = filtered();
    if (!rows.length) return;
    const pts = rows.slice(0, MAX_SHOW).map((r) => [r.lat, r.lng]);
    if (state.origin) pts.push([state.origin.lat, state.origin.lng]);
    map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
  }

  function topRatedBookable() {
    if (state.minRating) { state.minRating = 0; el.topBtn.classList.remove('on'); render(); fitToResults(); return; }
    state.minRating = 4.5; el.topBtn.classList.add('on');
    state.radius = 0; el.radiusSel.value = '0';   // 不限縮附近，看全台北
    setMode('online');
    // 大地圖 modal 呈現全部點位，關掉再看清單
    const rows = filtered();
    if (rows.length) {
      const pts = rows.slice(0, MAX_SHOW).map((r) => [r.lat, r.lng]);
      if (state.origin) pts.push([state.origin.lat, state.origin.lng]);
      showMapModal(pts);
    }
  }

  function setMode(mode) {
    state.mode = mode;
    el.modeChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.value === mode));
    const onChip = el.modeChips.querySelector('.chip.on');
    const pm = $('pickedMode'); if (pm) pm.textContent = onChip ? onChip.textContent : '';
    el.modeNote.textContent = mode === 'book' ? '線上訂位排最前，其次可電話訂位。'
      : mode === 'online' ? '只顯示 Google 標示可線上訂位的餐廳。'
      : '包含 OpenStreetMap 全部店家（無訂位資訊，適合探索）。';
    render();
  }

  // ---------- OSM（只在「全部店家」模式使用） ----------
  async function loadOsm() {
    try {
      const d = await fetch('data/osm.json', { cache: 'no-cache' }).then((r) => r.json());
      state.osmStats = {
        total: d.rows.length,
        coord: d.rows.filter((o) => o.v || o.c || o.x || o.gd != null).length,
        booking: d.rows.filter((o) => 'b' in o).length,
        closed: d.rows.filter((o) => o.c).length,
        reservable: d.rows.filter((o) => o.b === 1).length,
      };
      const curated = state.restaurants;
      const dup = (o) => curated.some((c) =>
        (o.name.startsWith(c.name.split(' ')[0]) || c.name.startsWith(o.name)) && haversine(o, c) < 150);
      state.osm = d.rows.filter((o) => !o.c && !dup(o)).map((o) => ({
        ...o, osm: true, source: 'OpenStreetMap',
        tags: o.tags || [], occasions: [],
      }));
      if (state.mode === 'all') render();
    } catch { /* OSM 載入失敗不影響核心功能 */ }
  }

  // ---------- utils ----------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const uniq = (arr) => [...new Set(arr)].filter(Boolean);
  // 類型 → 固定色（同名恆同色）；電話統一顯示 0X 格式
  const catWarm = (cat) => [...String(cat)].reduce((a, ch) => a + ch.codePointAt(0), 0) % 2 === 1;
  const fmtPhone = (p) => String(p || '').replace(/^\+886[- ]?/, '0').replace(/-/g, ' ').trim();

  // ---------- init ----------
  async function init() {
    const [rs, ar] = await Promise.all([
      fetch('data/restaurants.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/areas.json', { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    state.restaurants = rs;
    state.mrtStations = ar.mrt;
    state.districts = ar.districts;
    ar.districts.forEach((d) => el.districtSel.add(new Option(d.name, d.name)));
    ar.mrt.forEach((m) => el.mrtSel.add(new Option(m.name, m.name)));
    buildChipsIcon(el.categoryChips, uniq(rs.map((r) => r.category)));
    bindChips(el.categoryChips, state.category);
    bindChips(el.priceChips, state.price);
    el.modeChips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (b) setMode(b.dataset.value);
    });
    el.mrtChips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      state.mrtNear = Number(b.dataset.value);
      el.mrtChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
      $('pickedMrt').textContent = state.mrtNear ? `${state.mrtNear} m 內` : '';
      render();
    });
    let qTimer = null;
    const jumpTop = () => {
      const rows = filtered();
      if (state.q.trim() && rows.length) setActive(rows[0].id, true);
    };
    el.q.addEventListener('input', () => {
      state.q = el.q.value; render();
      clearTimeout(qTimer);
      if (state.q.trim()) qTimer = setTimeout(jumpTop, 700);   // 停止輸入後自動跳到最像的那家
    });
    el.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(qTimer); jumpTop(); } });
    el.districtSel.addEventListener('change', () => {
      const d = ar.districts.find((x) => x.name === el.districtSel.value);
      if (d) { state.radius = 2000; el.radiusSel.value = '2000'; setOrigin({ ...d, label: d.name, kind: 'district' }); }
    });
    el.mrtSel.addEventListener('change', () => {
      const m = ar.mrt.find((x) => x.name === el.mrtSel.value);
      if (m) { state.radius = 1000; el.radiusSel.value = '1000'; setOrigin({ ...m, label: `捷運${m.name}`, kind: 'mrt' }); }
    });
    el.radiusSel.addEventListener('change', () => { state.radius = Number(el.radiusSel.value); setOrigin(state.origin); });
    el.locateBtn.addEventListener('click', () => locate());
    el.clearLocBtn.addEventListener('click', () => setOrigin(null));
    el.resetBtn.addEventListener('click', () => { clearChips(); state.q = ''; el.q.value = ''; setMode('online'); setOrigin(null); });
    el.randomBtn.addEventListener('click', randomPick);
    el.recoBtn.addEventListener('click', recommendBookable);
    el.topBtn.addEventListener('click', topRatedBookable);

    probeGeolocation();
    render();
    loadOsm();
  }

  // ---------- 對外 API（給吉祥物 chatbot 用） ----------
  window.TaipeiEat = {
    search(q) { el.q.value = q; state.q = q; render(); const rows = filtered(); if (rows.length) setActive(rows[0].id, true); return rows.slice(0, 5); },
    results() { return filtered().slice(0, 5); },
    setStation(name) { const m = state.mrtStations.find((x) => x.name === name); if (m) { state.radius = 1000; el.radiusSel.value = '1000'; el.mrtSel.value = name; setOrigin({ ...m, label: `捷運${name}`, kind: 'mrt' }); } return !!m; },
    setDistrict(name) { const d = state.districts.find((x) => x.name === name); if (d) { state.radius = 2000; el.radiusSel.value = '2000'; el.districtSel.value = name; setOrigin({ ...d, label: name, kind: 'district' }); } return !!d; },
    setMode, random: randomPick, reco: recommendBookable,
    openStore(id) { const r = state.restaurants.concat(state.osm).find((x) => x.id === id); if (r) { setActive(id, true); showDetail({ ...r, dist: state.origin ? haversine(state.origin, r) : null }); } },
    findStores(name) { const q = name.trim().toLowerCase(); return state.restaurants.concat(state.osm).filter((r) => r.name.toLowerCase().includes(q)).slice(0, 5); },
    stations() { return state.mrtStations.map((s) => s.name); },
    districts() { return state.districts.map((d) => d.name); },
    categories() { return uniq(state.restaurants.concat(state.osm).map((r) => r.category)); },
    origin() { return state.origin; },
    stats() { return { curated: state.restaurants.length, osm: state.osm.length, ...state.osmStats }; },
    locStatus() { return el.locStatusText.textContent; },
    fmtDist, bookLevel,
  };

  init().catch((e) => {
    el.list.innerHTML = `<li class="empty">資料載入失敗：${esc(e.message)}<br>請用 http server 開啟（例如 <code>python3 -m http.server</code>）。</li>`;
  });
})();

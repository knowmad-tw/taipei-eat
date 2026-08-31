/* 阿熊 — 台灣黑熊吉祥物 chatbot
   純 rule-based，不呼叫任何外部 API；規則盡量涵蓋各種問法。
   可拖曳移動（位置記在 localStorage），預設在右上角。 */
(() => {
  'use strict';
  const API = () => window.TaipeiEat;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BEAR_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="19" cy="13" r="7" fill="#111"/><circle cx="45" cy="13" r="7" fill="#111"/>
    <path d="M32 6 C45 6 55 15 56 30 C57 44 49 56 32 56 C15 56 7 44 8 30 C9 15 19 6 32 6 Z" fill="#111"/>
    <circle cx="23" cy="28" r="3.6" fill="#fff"/><circle cx="41" cy="28" r="3.6" fill="#fff"/>
    <circle cx="24.2" cy="27.2" r="1.2" fill="#111"/><circle cx="42.2" cy="27.2" r="1.2" fill="#111"/>
    <ellipse cx="32" cy="39" rx="6.2" ry="4.6" fill="#fff"/><circle cx="32" cy="37.4" r="1.9" fill="#111"/>
    <path d="M29.6 41.6 Q32 43.4 34.4 41.6" stroke="#111" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M23 51 L32 55.5 L41 51" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  // ---------- UI ----------
  const root = document.createElement('div');
  root.id = 'bearBot';
  root.innerHTML = `
    <button id="bearFab" type="button" title="問阿熊（可拖曳移動）">${BEAR_SVG}<span class="fab-hi">問我！</span></button>
    <div id="bearPanel" hidden>
      <div class="bb-head"><span>🐻 阿熊</span><span class="bb-sub">台灣黑熊・訂位小幫手</span><button class="bb-close" type="button">✕</button></div>
      <div class="bb-msgs" id="bbMsgs"></div>
      <div class="bb-chips" id="bbChips"></div>
      <form class="bb-input" id="bbForm"><input id="bbText" type="text" placeholder="例如：西門附近吃什麼、想吃火鍋…" autocomplete="off"><button type="submit">送出</button></form>
    </div>`;
  document.body.appendChild(root);
  const fab = root.querySelector('#bearFab'), panel = root.querySelector('#bearPanel'),
    msgs = root.querySelector('#bbMsgs'), chipsEl = root.querySelector('#bbChips'),
    form = root.querySelector('#bbForm'), input = root.querySelector('#bbText');

  // 位置：預設右上角，可拖曳，記在 localStorage
  let pos = { right: 24, top: 84 };
  try { pos = JSON.parse(localStorage.getItem('bear-pos')) || pos; } catch {}
  const applyPos = () => {
    pos.right = Math.min(Math.max(pos.right, 4), window.innerWidth - 80);
    pos.top = Math.min(Math.max(pos.top, 4), window.innerHeight - 80);
    root.style.right = pos.right + 'px'; root.style.top = pos.top + 'px';
  };
  applyPos();
  let drag = null;
  fab.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, right: pos.right, top: pos.top, moved: false };
    fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    pos.right = drag.right - dx; pos.top = drag.top + dy; applyPos();
  });
  fab.addEventListener('pointerup', () => {
    if (drag && drag.moved) { try { localStorage.setItem('bear-pos', JSON.stringify(pos)); } catch {} }
    else togglePanel();
    drag = null;
  });

  function togglePanel() {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !msgs.childElementCount) {
      botSay('嗨，我是<b>阿熊</b> 🐻，台北聚餐訂位小幫手！<br>你可以問我「附近吃什麼」「想吃火鍋」「西門有什麼」「怎麼訂位」，或直接打店名。', DEFAULT_CHIPS);
    }
    if (!panel.hidden) input.focus();
  }
  root.querySelector('.bb-close').addEventListener('click', togglePanel);

  function addMsg(html, who) {
    const d = document.createElement('div');
    d.className = 'bb-msg ' + who;
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function botSay(html, chips) {
    addMsg(html, 'bot');
    chipsEl.innerHTML = '';
    (chips || []).forEach((c) => {
      const b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = c;
      b.addEventListener('click', () => { input.value = c; form.requestSubmit(); });
      chipsEl.appendChild(b);
    });
  }
  const DEFAULT_CHIPS = ['附近吃什麼', '隨機推薦', '想吃火鍋', '怎麼訂位'];

  function storeCards(rows) {
    if (!rows.length) return '（找不到耶）';
    return '<div class="bb-stores">' + rows.map((r) => {
      const lv = API().bookLevel(r);
      const tag = lv === 2 ? '🪑 可線上訂位' : lv === 1 ? '📞 可電話訂位' : '現場排隊';
      return `<button class="bb-store" data-id="${esc(r.id)}" type="button"><b>${esc(r.name)}</b><span>${esc(r.category)} · ${esc(r.district)} · ${tag}${r.dist != null ? ' · ' + API().fmtDist(r.dist) : ''}</span></button>`;
    }).join('') + '</div><div class="bb-note">點店名看細節</div>';
  }
  msgs.addEventListener('click', (e) => {
    const b = e.target.closest('.bb-store');
    if (b) API().openStore(b.dataset.id);
  });

  // ---------- 規則引擎 ----------
  // 每條規則：{ re: 正規表示式, fn(match, 原文) → {html, chips} }
  const CAT_WORDS = ['火鍋', '燒烤', '日式', '韓式', '泰式', '台菜', '義式', '中式', '港式', '牛排', '海鮮', '素食', '小籠包', '點心', '麵食', '早餐', '早午餐', '咖啡', '甜點', '茶飲', '小吃', '夜市', '拉麵', '壽司', '麻辣鍋', '涮涮鍋', '燒肉', '咖哩', '披薩', '漢堡', '牛肉麵', 'buffet', '吃到飽'];

  function topResults(intro, chips) {
    const rows = API().results();
    return { html: `${intro}<br>${storeCards(rows)}`, chips };
  }
  function needLocation() {
    return { html: '先告訴我你在哪～可以按頁面上的「📍 找我附近訂得到位的」，或跟我說「西門附近」「大安區」這種地點。', chips: ['找我附近訂得到位的', '西門附近', '信義區有什麼'] };
  }

  const RULES = [
    // 打招呼 / 身分 / 客套
    { re: /^(hi|hello|嗨|哈囉|你好|妳好|安安|早安|午安|晚安|yo)/i,
      fn: () => ({ html: '嗨嗨 🐻！肚子餓了嗎？跟我說你在哪、想吃什麼，我來找訂得到位的。', chips: DEFAULT_CHIPS }) },
    { re: /(你是誰|叫什麼|自我介紹|什麼熊)/,
      fn: () => ({ html: '我是<b>阿熊</b>，台灣黑熊，胸口有 V 領的那種 🐻。專門幫你找台北<b>現在訂得到位</b>的餐廳——線上訂位優先、電話訂位也行。', chips: DEFAULT_CHIPS }) },
    { re: /(謝謝|感謝|thank|3q|辛苦)/i, fn: () => ({ html: '不客氣！吃飽最重要 🍚', chips: DEFAULT_CHIPS }) },
    { re: /(再見|掰掰|bye)/i, fn: () => ({ html: '掰掰～餓了再來找我 🐻', chips: [] }) },
    { re: /(你會什麼|能做什麼|怎麼用|使用說明|help|幫助)/i,
      fn: () => ({ html: '我會這些：<br>1️⃣ 「附近吃什麼」— 定位後推薦訂得到位的<br>2️⃣ 「西門附近」「大安區有什麼」— 用地點找<br>3️⃣ 「想吃火鍋 / 日式 / 燒烤」— 用類型找<br>4️⃣ 直接打店名 — 查電話、訂位、導航<br>5️⃣ 「隨機推薦」— 選擇困難交給我<br>6️⃣ 「怎麼訂位」「資料哪來的」— 問我網站的事', chips: DEFAULT_CHIPS }) },

    // 隨機 / 選擇困難
    { re: /(隨機|幫我選|抽一|不知道吃什麼|沒想法|都可以|你決定|選擇困難|吃什麼好)/,
      fn: () => { API().random(); return { html: '交給我！已經幫你抽了一家（看畫面中間）🎲 不滿意跟我說「再抽」。', chips: ['再抽', '附近吃什麼'] }; } },
    { re: /^再抽|再一次|換一家/,
      fn: () => { API().random(); return { html: '再抽一家 🎲', chips: ['再抽'] }; } },

    // 附近 / 定位
    { re: /(附近|周邊|我這邊|旁邊|現在位置|身邊)/,
      fn: (m, text) => {
        // 「西門附近」這種帶地名的交給下面地點規則
        const st = API().stations().find((s) => text.includes(s));
        const di = API().districts().find((d) => text.includes(d));
        if (st || di) return null;
        API().reco();
        return { html: '好，正在定位你 📍 找「訂得到位」的店，結果會先跳地圖、關掉看清單。', chips: ['想吃火鍋', '隨機推薦'] };
      } },
    { re: /(找我附近訂得到位的)/, fn: () => { API().reco(); return { html: '馬上找 📍', chips: [] }; } },
    { re: /(定位失敗|抓不到|位置不對|gps|不能定位|定位怪)/i,
      fn: () => ({ html: `定位狀態：「${esc(API().locStatus())}」。<br>抓不到的話：1️⃣ 瀏覽器要允許位置權限 2️⃣ 需要 https 或 localhost 3️⃣ 也可以直接跟我說地點，例如「中山站附近」。`, chips: ['西門附近', '中山站附近'] }) },

    // 訂位相關說明
    { re: /(怎麼訂位|如何訂位|訂位教學|訂位方式|怎麼訂)/,
      fn: () => ({ html: '卡片上的按鈕：<br>🪑 <b>馬上線上訂位</b> — 開 Google 地圖的訂位入口，選時間人數送出<br>📞 <b>電話</b> — 手機上點了直接撥號<br>🧭 <b>導航</b> — 直接帶路<br>左側「訂位方式」可切換只看線上／含電話／全部店家。', chips: ['附近吃什麼', '只看線上訂位是什麼'] }) },
    { re: /(線上訂位是什麼|只看線上|哪些可以線上)/,
      fn: () => ({ html: '「線上訂位」= Google 標示可以線上預約入座的店（撈王、海底撈、藏壽司這類）。注意：像吉野家的「線上點餐」是點外帶，不算訂位，我們已經濾掉了。', chips: ['附近吃什麼'] }) },
    { re: /(現在有開|營業中|還開著|幾點關)/,
      fn: () => ({ html: '營業時間我只有部分店家有資料（卡片「⋯ 更多」裡看得到），還沒辦法即時判斷「現在有開」。最準的做法：點店名開細節 → 「去 Google 看全部評論」順便看營業狀態。', chips: [] }) },

    // 資料 / 網站相關
    { re: /(資料哪|資料來源|哪來的|可信|準嗎|多久更新|來源)/,
      fn: () => ({ html: '三個來源：<br>1️⃣ 精選 35 家 — 人工整理＋Google 核對過<br>2️⃣ OpenStreetMap 約 1.3 萬家台北店家<br>3️⃣ Google Places — 評分、訂位、營業狀態（分批核對中）<br>詳細進度看頁尾「📋 核對紀錄」。', chips: ['核對進度'] }) },
    { re: /(核對進度|核對紀錄|進度)/,
      fn: () => { const s = API().stats(); return { html: `目前進度：座標核對 ${((s.coord || 0)).toLocaleString()} / ${(s.total || 0).toLocaleString()}，可線上訂位 ${s.reservable || 0} 家，已排除歇業 ${s.closed || 0} 家。<br><a href="verify.html" target="_blank">開核對紀錄頁 ↗</a>`, chips: [] }; } },
    { re: /(評分|星等|評論|留言)(哪|怎|是)/,
      fn: () => ({ html: '⭐ 評分來自 Google（含則數），點卡片右上的評分印章可以看最新網友留言，也有連結去 Google 看全部。', chips: [] }) },

    // 預算
    { re: /(便宜|平價|省錢|銅板|窮)/,
      fn: () => { const rows = API().search('$'); return { html: '想省錢的話，把左側「場合／預算」打開選 <b>$ &lt;150</b> 或 <b>$$ 150–400</b>。先幫你列目前結果裡的：<br>' + storeCards(API().results().filter((r) => r.price && r.price <= 2).slice(0, 5)), chips: ['附近吃什麼'] }; } },
    { re: /(高級|奢侈|慶祝|紀念日|大餐|米其林)/,
      fn: () => { const rows = API().findStores(''); return { html: '慶祝場合推 <b>$$$$</b> 等級：橘色涮涮屋、饗饗 INPARADISE 這類（左側預算選 $$$$）。米其林相關直接搜「米其林」也行。', chips: ['米其林', '附近吃什麼'] }; } },

    // 地點（捷運站 / 行政區 / 別名）— 放在類型前面
    { re: /(.+?)(站)?(附近|周邊|有什麼|吃什麼)?$/,
      fn: (m, text) => {
        const stations = API().stations();
        const st = stations.find((s) => text.includes(s)) ||
          ({ '西門町': '西門', '東區': '忠孝敦化', '永康街': '東門', '師大': '台電大樓', '公館商圈': '公館' })[stations.find ? Object.keys({}).x : null];
        const alias = { '西門町': '西門', '東區': '忠孝敦化', '永康街': '東門', '師大': '台電大樓' };
        const aliasHit = Object.keys(alias).find((a) => text.includes(a));
        const target = st || (aliasHit ? alias[aliasHit] : null);
        if (target) { API().setStation(target); return topResults(`帶你到<b>捷運${esc(target)}</b>附近，訂得到位的：`, ['想吃火鍋', '隨機推薦']); }
        const di = API().districts().find((d) => text.includes(d) || text.includes(d.replace('區', '')));
        if (di && text.includes(di.replace('區', ''))) { API().setDistrict(di); return topResults(`看看<b>${esc(di)}</b>訂得到位的：`, ['想吃火鍋', '隨機推薦']); }
        return null;
      } },

    // 類型 / 想吃什麼
    { re: new RegExp('(' + CAT_WORDS.join('|') + ')', 'i'),
      fn: (m) => { API().search(m[1]); return topResults(`找「<b>${esc(m[1])}</b>」的結果（已同步到頁面）：`, ['隨機推薦', '換個地點']); } },
    { re: /(換個地點|換地方)/, fn: () => needLocation() },

    // 店名查詢（fallback 前最後一關）
    { re: /(.{2,})(的)?(電話|地址|在哪|幾點|營業|評價|資訊|訂位)?$/,
      fn: (m, text) => {
        const name = text.replace(/(的)?(電話|地址|在哪|幾點|營業|評價|資訊|訂位)$/, '').trim();
        if (name.length < 2) return null;
        const hits = API().findStores(name);
        if (!hits.length) return null;
        return { html: `找到這些「${esc(name)}」：<br>${storeCards(hits)}`, chips: [] };
      } },
  ];

  function answer(text) {
    const t = text.trim();
    if (!t) return;
    addMsg(esc(t), 'user');
    for (const rule of RULES) {
      const m = t.match(rule.re);
      if (m) {
        const res = rule.fn(m, t);
        if (res) { botSay(res.html, res.chips); return; }
      }
    }
    botSay('這題我還不會 🐻💦 你可以試試：<br>・地點：「西門附近」「大安區有什麼」<br>・類型：「想吃火鍋」<br>・店名：「鼎王」<br>・或「隨機推薦」', DEFAULT_CHIPS);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    answer(input.value);
    input.value = '';
  });
})();

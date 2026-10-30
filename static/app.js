/**
 * 底値＆在庫マネージャー - ハイブリッド＆サーバーレス対応プラットフォーム (Vanilla JS)
 *
 * 【特徴】
 * 1. GitHub Pages 等の静的ホスティングでは自動的に「ブラウザ内DB (LocalStorage)」で100%サーバーレス稼働。
 *    ローカルで `python app.py` を起動している場合は SQLite API と自動連動（かつブラウザにもミラー保存）。
 * 2. 「3. データ管理・同期」タブで以下をフルサポート:
 *    - JSON完全バックアップ書き出し ＆ 読み込み（追加マージ / 完全上書き復元）
 *    - CSV書き出し（Excel対応 BOM付きUTF-8: 商品＆底値一覧 / 価格調査ログ / 購入・在庫リスト）＆ CSVインポート
 *    - 容量モニター ＆ 「底値レコード保護つき古い調査ログ整理（スリム化）」
 *    - PC ⇔ スマホ クラウド同期（GitHub Gist Push/Pull、Google Drive/Web Share共有シート連携、同期コードコピー＆ペースト）
 */

const STORAGE_KEY_DB = "price_stock_manager_db_v1";
const STORAGE_KEY_SYNC_CFG = "price_stock_manager_sync_cfg_v1";

const state = {
  mode: "local", // "api" (Flask+SQLite) or "local" (GitHub Pages / Browser Storage)
  items: [],
  selectedItemId: null,
  purchases: [],
  allPurchases: [],
  currentStatusFilter: "すべて",
  priceChecks: [],
};

// =========================================================
// ユーティリティ関数
// =========================================================

function formatYen(value) {
  if (value === null || value === undefined || value === "") {
    return "---";
  }
  return Number(value).toLocaleString("ja-JP");
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message, variant = "dark") {
  const toastEl = document.getElementById("appToast");
  const toastBody = document.getElementById("appToastBody");
  if (!toastEl || !toastBody) return;

  toastEl.className = `toast align-items-center text-bg-${variant} border-0 rounded-3 shadow`;
  toastBody.textContent = message;

  const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 });
  toast.show();
}

function getSelectedItem() {
  if (!state.selectedItemId) return null;
  return state.items.find((it) => Number(it.id) === Number(state.selectedItemId)) || null;
}

// =========================================================
// ブラウザ内サーバーレスDBエンジン (GitHub Pages 用)
// =========================================================

function getDefaultSampleStore() {
  const today = getTodayStr();
  return {
    schema_version: 1,
    nextIds: { item: 4, check: 5, purchase: 3 },
    items: [
      { id: 1, jan_code: "4901301396815", name: "アタックZERO 詰め替え 1200g", category: "日用品" },
      { id: 2, jan_code: "4902430866002", name: "ジョイ コンパクト 食器用洗剤 特大", category: "日用品" },
      { id: 3, jan_code: "4902102072618", name: "綾鷹 ラベルレス 525ml×24本", category: "食品・飲料" },
    ],
    price_checks: [
      { id: 1, item_id: 1, shop_name: "ウエルシア", price: 980, point_back: 30, checked_date: today, memo: "通常価格" },
      { id: 2, item_id: 1, shop_name: "オーケー", price: 848, point_back: 0, checked_date: today, memo: "会員現金払いで最安" },
      { id: 3, item_id: 2, shop_name: "マツモトキヨシ", price: 328, point_back: 15, checked_date: today, memo: "10%OFFクーポン併用" },
      { id: 4, item_id: 3, shop_name: "Amazon", price: 1890, point_back: 95, checked_date: today, memo: "定期おトク便セール" },
    ],
    purchases: [
      { id: 1, item_id: 1, shop_name: "オーケー", buy_price: 848, quantity: 2, purchase_date: today, stock_status: "在庫あり" },
      { id: 2, item_id: 2, shop_name: "マツモトキヨシ", buy_price: 328, quantity: 1, purchase_date: today, stock_status: "買い出し要" },
    ],
  };
}

function loadLocalStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DB);
    if (!raw) {
      const initial = getDefaultSampleStore();
      saveLocalStore(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
    parsed.price_checks = Array.isArray(parsed.price_checks) ? parsed.price_checks : [];
    parsed.purchases = Array.isArray(parsed.purchases) ? parsed.purchases : [];
    if (!parsed.nextIds) {
      parsed.nextIds = {
        item: Math.max(0, ...parsed.items.map((x) => Number(x.id) || 0)) + 1,
        check: Math.max(0, ...parsed.price_checks.map((x) => Number(x.id) || 0)) + 1,
        purchase: Math.max(0, ...parsed.purchases.map((x) => Number(x.id) || 0)) + 1,
      };
    }
    return parsed;
  } catch (e) {
    const fallback = getDefaultSampleStore();
    saveLocalStore(fallback);
    return fallback;
  }
}

function saveLocalStore(store) {
  store.nextIds = {
    item: Math.max(0, ...store.items.map((x) => Number(x.id) || 0)) + 1,
    check: Math.max(0, ...store.price_checks.map((x) => Number(x.id) || 0)) + 1,
    purchase: Math.max(0, ...store.purchases.map((x) => Number(x.id) || 0)) + 1,
  };
  localStorage.setItem(STORAGE_KEY_DB, JSON.stringify(store));
}

function computeItemsWithMinPriceFromStore(store) {
  return [...store.items]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .map((item) => {
      const checks = store.price_checks.filter((c) => Number(c.item_id) === Number(item.id));
      const buys = store.purchases.filter((p) => Number(p.item_id) === Number(item.id));

      const candidates = [
        ...checks.map((c) => ({ price: Number(c.price), shop_name: c.shop_name, dt: c.checked_date })),
        ...buys.map((p) => ({ price: Number(p.buy_price), shop_name: p.shop_name, dt: p.purchase_date })),
      ];

      let min_price = null;
      let min_price_shop = null;
      let min_price_date = null;

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.price - b.price || String(b.dt).localeCompare(String(a.dt)));
        min_price = candidates[0].price;
        min_price_shop = candidates[0].shop_name;
        min_price_date = candidates[0].dt;
      }

      let min_effective_price = null;
      if (checks.length > 0) {
        min_effective_price = Math.min(...checks.map((c) => Number(c.price) - Number(c.point_back || 0)));
      }

      return {
        ...item,
        min_price,
        min_effective_price,
        min_price_shop,
        min_price_date,
        check_count: checks.length,
      };
    });
}

// =========================================================
// データアクセス抽象化レイヤー (Flask API / GitHub Pages 自動判別)
// =========================================================

async function detectBackendMode() {
  // URLパラメータ ?mode=local が指定されているか、GitHub Pages (*.github.io) や file:// の場合は即座にローカルモード
  const host = window.location.hostname || "";
  if (
    window.location.protocol === "file:" ||
    host.endsWith("github.io") ||
    new URLSearchParams(window.location.search).get("mode") === "local"
  ) {
    state.mode = "local";
    updateModeIndicators();
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch("/api/items", { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "ok") {
        state.mode = "api";
        updateModeIndicators();
        return;
      }
    }
  } catch (_) {
    // APIサーバー非稼働時は自動的にサーバーレス（ブラウザ保存）モードへフォールバック
  }

  state.mode = "local";
  updateModeIndicators();
}

function updateModeIndicators() {
  const headerBadge = document.getElementById("storageEngineBadge");
  const detailBadge = document.getElementById("dataModeDetailBadge");
  if (state.mode === "api") {
    if (headerBadge) {
      headerBadge.textContent = "Flask + SQLite 接続中";
      headerBadge.className = "badge bg-success-subtle text-success-emphasis extra-small rounded-pill px-2";
    }
    if (detailBadge) {
      detailBadge.textContent = "SQLite (database.db) + ブラウザミラー";
    }
  } else {
    if (headerBadge) {
      headerBadge.textContent = "GitHub Pages サーバーレス保存";
      headerBadge.className = "badge bg-warning-subtle text-warning-emphasis extra-small rounded-pill px-2";
    }
    if (detailBadge) {
      detailBadge.textContent = "ブラウザ内ストレージ (Indexed/LocalStorage)";
    }
  }
}

async function fetchItems() {
  if (state.mode === "api") {
    const res = await fetch("/api/items");
    const data = await res.json();
    if (res.ok && data.status === "ok") {
      state.items = data.items || [];
    }
  } else {
    const store = loadLocalStore();
    state.items = computeItemsWithMinPriceFromStore(store);
  }
  renderItemSelect();
  renderItemsSummaryList();
  updateMinPriceBanner();
  evaluateLowestPriceHighlight();
}

async function fetchPriceChecks(itemId = null) {
  if (state.mode === "api") {
    const url = itemId ? `/api/price-checks?item_id=${encodeURIComponent(itemId)}` : "/api/price-checks";
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok && data.status === "ok") {
      state.priceChecks = data.price_checks || [];
    }
  } else {
    const store = loadLocalStore();
    const itemMap = new Map(store.items.map((i) => [Number(i.id), i]));
    let list = store.price_checks.map((pc) => {
      const it = itemMap.get(Number(pc.item_id)) || {};
      return {
        ...pc,
        item_name: it.name || "不明な商品",
        item_category: it.category || "日用品",
        effective_price: Number(pc.price) - Number(pc.point_back || 0),
      };
    });
    if (itemId) {
      list = list.filter((pc) => Number(pc.item_id) === Number(itemId));
    }
    list.sort((a, b) => String(b.checked_date).localeCompare(String(a.checked_date)) || Number(b.id) - Number(a.id));
    state.priceChecks = list.slice(0, 50);
  }
  renderPriceCheckHistory();
  updateShopSuggestions(state.allPurchases);
}

async function fetchPurchases() {
  if (state.mode === "api") {
    const statusQuery =
      state.currentStatusFilter && state.currentStatusFilter !== "すべて"
        ? `?status=${encodeURIComponent(state.currentStatusFilter)}`
        : "";

    const [filteredRes, allRes] = await Promise.all([
      fetch(`/api/purchases${statusQuery}`),
      fetch("/api/purchases"),
    ]);

    const filteredData = await filteredRes.json();
    const allData = await allRes.json();

    if (filteredRes.ok && filteredData.status === "ok") {
      state.purchases = filteredData.purchases || [];
    }
    state.allPurchases = allRes.ok && allData.status === "ok" ? allData.purchases || [] : state.purchases;
  } else {
    const store = loadLocalStore();
    const itemsWithMin = computeItemsWithMinPriceFromStore(store);
    const itemMap = new Map(itemsWithMin.map((i) => [Number(i.id), i]));

    const allList = store.purchases
      .map((p) => {
        const it = itemMap.get(Number(p.item_id)) || {};
        return {
          ...p,
          item_name: it.name || "不明な商品",
          item_category: it.category || "日用品",
          jan_code: it.jan_code || null,
          min_price: it.min_price ?? null,
        };
      })
      .sort((a, b) => String(b.purchase_date).localeCompare(String(a.purchase_date)) || Number(b.id) - Number(a.id));

    state.allPurchases = allList;
    if (state.currentStatusFilter && state.currentStatusFilter !== "すべて") {
      state.purchases = allList.filter((p) => p.stock_status === state.currentStatusFilter);
    } else {
      state.purchases = allList;
    }
  }

  updatePurchaseCounters(state.allPurchases);
  renderPurchases();
  updateShopSuggestions(state.allPurchases);
  await updateDataStatsView();
}

async function getFullSnapshotData() {
  if (state.mode === "api") {
    const res = await fetch("/api/data/snapshot");
    const data = await res.json();
    if (res.ok && data.status === "ok") {
      // ブラウザ側にもミラー保存しておく
      saveLocalStore(data.snapshot);
      return data.snapshot;
    }
  }
  const store = loadLocalStore();
  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    items: store.items,
    price_checks: store.price_checks,
    purchases: store.purchases,
  };
}

async function applyFullSnapshotData(snapshot, mode = "merge") {
  if (!snapshot || !Array.isArray(snapshot.items)) {
    throw new Error("バックアップデータの形式が正しくありません。");
  }

  if (state.mode === "api") {
    const res = await fetch("/api/data/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, mode }),
    });
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      throw new Error(data.message || "データの復元に失敗しました。");
    }
    await getFullSnapshotData();
  } else {
    const current = loadLocalStore();
    if (mode === "replace") {
      const replaced = {
        schema_version: 1,
        items: (snapshot.items || []).map((it, idx) => ({
          id: Number(it.id) || idx + 1,
          jan_code: it.jan_code || null,
          name: String(it.name || "").trim(),
          category: String(it.category || "日用品").trim(),
        })),
        price_checks: (snapshot.price_checks || []).map((pc, idx) => ({
          id: Number(pc.id) || idx + 1,
          item_id: Number(pc.item_id),
          shop_name: String(pc.shop_name || "").trim(),
          price: Number(pc.price) || 0,
          point_back: Number(pc.point_back || 0),
          checked_date: pc.checked_date || getTodayStr(),
          memo: String(pc.memo || ""),
        })),
        purchases: (snapshot.purchases || []).map((pu, idx) => ({
          id: Number(pu.id) || idx + 1,
          item_id: Number(pu.item_id),
          shop_name: String(pu.shop_name || "").trim(),
          buy_price: Number(pu.buy_price) || 0,
          quantity: Math.max(1, Number(pu.quantity || 1)),
          purchase_date: pu.purchase_date || getTodayStr(),
          stock_status: pu.stock_status || "在庫あり",
        })),
      };
      saveLocalStore(replaced);
    } else {
      // merge モード: 品名またはJANコードで名寄せして統合
      const idMap = new Map();
      let nextItemId = Math.max(0, ...current.items.map((x) => Number(x.id) || 0)) + 1;
      let nextCheckId = Math.max(0, ...current.price_checks.map((x) => Number(x.id) || 0)) + 1;
      let nextPurchaseId = Math.max(0, ...current.purchases.map((x) => Number(x.id) || 0)) + 1;

      for (const it of snapshot.items || []) {
        const oldId = Number(it.id);
        const name = String(it.name || "").trim();
        const jan = it.jan_code ? String(it.jan_code).trim() : null;
        const category = String(it.category || "日用品").trim();
        if (!name) continue;

        let found = current.items.find((x) => (jan && x.jan_code === jan) || x.name === name);
        if (!found) {
          found = { id: nextItemId++, jan_code: jan, name, category };
          current.items.push(found);
        }
        idMap.set(oldId, found.id);
      }

      for (const pc of snapshot.price_checks || []) {
        const mappedItemId = idMap.get(Number(pc.item_id)) || Number(pc.item_id);
        if (!current.items.some((x) => Number(x.id) === mappedItemId)) continue;
        current.price_checks.push({
          id: nextCheckId++,
          item_id: mappedItemId,
          shop_name: String(pc.shop_name || "").trim(),
          price: Number(pc.price) || 0,
          point_back: Number(pc.point_back || 0),
          checked_date: pc.checked_date || getTodayStr(),
          memo: String(pc.memo || ""),
        });
      }

      for (const pu of snapshot.purchases || []) {
        const mappedItemId = idMap.get(Number(pu.item_id)) || Number(pu.item_id);
        if (!current.items.some((x) => Number(x.id) === mappedItemId)) continue;
        current.purchases.push({
          id: nextPurchaseId++,
          item_id: mappedItemId,
          shop_name: String(pu.shop_name || "").trim(),
          buy_price: Number(pu.buy_price) || 0,
          quantity: Math.max(1, Number(pu.quantity || 1)),
          purchase_date: pu.purchase_date || getTodayStr(),
          stock_status: pu.stock_status || "在庫あり",
        });
      }

      saveLocalStore(current);
    }
  }

  await refreshAllViews();
}

async function refreshAllViews() {
  await Promise.all([fetchItems(), fetchPriceChecks(state.selectedItemId), fetchPurchases()]);
}

// =========================================================
// レンダリング & UI更新: タブ1 (価格比較・入力)
// =========================================================

function renderItemSelect() {
  const selectEl = document.getElementById("itemSelect");
  const searchKeyword = (document.getElementById("itemSearchInput")?.value || "").trim().toLowerCase();

  const filteredItems = state.items.filter((item) => {
    if (!searchKeyword) return true;
    const target = `${item.name} ${item.category || ""} ${item.jan_code || ""}`.toLowerCase();
    return target.includes(searchKeyword);
  });

  const currentVal = state.selectedItemId ? String(state.selectedItemId) : "";

  let html = `<option value="">-- 商品を選択してください (${filteredItems.length}件) --</option>`;
  for (const item of filteredItems) {
    const minText =
      item.min_price !== null && item.min_price !== undefined
        ? `最安: ¥${formatYen(item.min_price)}`
        : "未調査";
    const selectedAttr = String(item.id) === currentVal ? "selected" : "";
    html += `<option value="${item.id}" ${selectedAttr}>[${escapeHtml(item.category)}] ${escapeHtml(item.name)} （${minText}）</option>`;
  }

  selectEl.innerHTML = html;

  if (searchKeyword && filteredItems.length === 1 && String(filteredItems[0].id) !== currentVal) {
    selectItemById(filteredItems[0].id, false);
    selectEl.value = String(filteredItems[0].id);
  }
}

function selectItemById(itemId, reloadSelect = true) {
  state.selectedItemId = itemId ? Number(itemId) : null;
  if (reloadSelect) {
    const selectEl = document.getElementById("itemSelect");
    if (selectEl) {
      selectEl.value = state.selectedItemId ? String(state.selectedItemId) : "";
    }
  }
  updateMinPriceBanner();
  evaluateLowestPriceHighlight();
  renderItemsSummaryList();
  fetchPriceChecks(state.selectedItemId);
}

function updateMinPriceBanner() {
  const banner = document.getElementById("minPriceBanner");
  const titleEl = document.getElementById("selectedItemTitle");
  const valueEl = document.getElementById("minPriceDisplay");
  const metaEl = document.getElementById("minPriceMeta");
  const historyBadge = document.getElementById("historyFilterBadge");

  const item = getSelectedItem();

  if (!item) {
    banner.classList.remove("has-item");
    titleEl.textContent = "商品を選択すると過去最安値を表示します";
    valueEl.innerHTML = `--- <span class="fs-6 fw-normal">円</span>`;
    metaEl.textContent = "商品マスターから選択するか、「＋新規商品を追加」から登録してください";
    if (historyBadge) historyBadge.textContent = "全商品の最新ログ";
    return;
  }

  banner.classList.add("has-item");
  titleEl.innerHTML = `<span class="badge bg-primary me-1">${escapeHtml(item.category)}</span><strong class="text-dark">${escapeHtml(item.name)}</strong> の過去最安値`;
  if (historyBadge) historyBadge.textContent = `${item.name} の履歴`;

  if (item.min_price !== null && item.min_price !== undefined) {
    valueEl.innerHTML = `${formatYen(item.min_price)} <span class="fs-5 fw-bold">円</span>`;
    const shopInfo = item.min_price_shop
      ? `（最安店舗: ${escapeHtml(item.min_price_shop)} / ${escapeHtml(item.min_price_date || "-")}）`
      : "";
    const effInfo =
      item.min_effective_price !== null &&
      item.min_effective_price !== undefined &&
      item.min_effective_price < item.min_price
        ? ` ｜ 実質最安: ${formatYen(item.min_effective_price)}円`
        : "";
    metaEl.innerHTML = `${shopInfo}${effInfo}`;
  } else {
    valueEl.innerHTML = `<span class="fs-4 text-secondary">記録なし（初回調査）</span>`;
    metaEl.textContent = "まだ価格データが登録されていません。今回の価格が基準になります。";
  }
}

function evaluateLowestPriceHighlight() {
  const priceRaw = document.getElementById("priceInput").value;
  const pointRaw = document.getElementById("pointInput").value;
  const effectivePreview = document.getElementById("effectivePricePreview");
  const diffText = document.getElementById("priceDiffText");
  const alertEl = document.getElementById("lowestPriceAlert");
  const alertTitle = document.getElementById("lowestAlertTitle");
  const alertDetail = document.getElementById("lowestAlertDetail");
  const diffBadge = document.getElementById("lowestDiffBadge");

  if (priceRaw === "" || priceRaw === null || Number(priceRaw) < 0) {
    effectivePreview.textContent = "--- 円";
    diffText.textContent = "価格を入力してください";
    alertEl.classList.add("d-none");
    return;
  }

  const price = parseInt(priceRaw, 10) || 0;
  const point = parseInt(pointRaw, 10) || 0;
  const effectivePrice = Math.max(0, price - point);

  effectivePreview.textContent = `${formatYen(effectivePrice)} 円`;

  const item = getSelectedItem();
  if (!item || item.min_price === null || item.min_price === undefined) {
    diffText.textContent = item ? "初回登録（この価格が最安値になります）" : "商品を選択すると最安値と比較します";
    alertEl.classList.add("d-none");
    return;
  }

  const minPrice = Number(item.min_price);
  const diffByRaw = price - minPrice;
  const diffByEffective = effectivePrice - minPrice;

  if (price < minPrice) {
    const saveAmount = minPrice - price;
    alertEl.classList.remove("d-none");
    alertTitle.textContent = "🎉 最安値更新！（額面でも過去最安！）";
    alertDetail.textContent = `過去最安値 ${formatYen(minPrice)}円 より ${formatYen(saveAmount)}円 安いです！`;
    diffBadge.textContent = `-${formatYen(saveAmount)}円 更新！`;
    diffText.innerHTML = `<span class="text-danger fw-bold">過去最安より ${formatYen(saveAmount)}円 お得！</span>`;
  } else if (effectivePrice < minPrice) {
    const saveAmount = minPrice - effectivePrice;
    alertEl.classList.remove("d-none");
    alertTitle.textContent = "🎉 最安値更新！（ポイント還元込みで実質最安！）";
    alertDetail.textContent = `実質 ${formatYen(effectivePrice)}円 は過去最安値 ${formatYen(minPrice)}円 を下回っています！`;
    diffBadge.textContent = `実質 -${formatYen(saveAmount)}円 更新！`;
    diffText.innerHTML = `<span class="text-danger fw-bold">実質価格で ${formatYen(saveAmount)}円 最安更新！</span>`;
  } else if (price === minPrice || effectivePrice === minPrice) {
    alertEl.classList.add("d-none");
    diffText.innerHTML = `<span class="text-success fw-bold">過去最安値（${formatYen(minPrice)}円）と同額タイです</span>`;
  } else {
    alertEl.classList.add("d-none");
    diffText.innerHTML = `<span class="text-secondary">過去最安より +${formatYen(diffByEffective)}円（額面 +${formatYen(diffByRaw)}円）</span>`;
  }
}

function renderPriceCheckHistory() {
  const container = document.getElementById("priceCheckHistoryList");
  if (!container) return;

  if (!state.priceChecks || state.priceChecks.length === 0) {
    container.innerHTML = `
      <div class="text-center text-muted py-4 small">
        <i class="bi bi-journal-x d-block fs-4 mb-1"></i>
        価格調査ログはまだありません
      </div>
    `;
    return;
  }

  const selectedItem = getSelectedItem();
  const currentMin = selectedItem && selectedItem.min_price !== null ? Number(selectedItem.min_price) : null;

  const html = state.priceChecks
    .map((row) => {
      const isLowest = currentMin !== null && Number(row.price) <= currentMin;
      const pointBadge =
        row.point_back && Number(row.point_back) > 0
          ? `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle ms-1">-${formatYen(row.point_back)}pt (実質¥${formatYen(row.effective_price)})</span>`
          : "";
      const lowestBadge = isLowest
        ? `<span class="badge bg-danger ms-1"><i class="bi bi-trophy-fill me-1"></i>最安</span>`
        : "";

      return `
        <div class="border-bottom py-2 d-flex align-items-center justify-content-between gap-2">
          <div class="min-w-0">
            <div class="fw-bold small text-truncate">
              ${!selectedItem ? `<span class="text-primary me-1">[${escapeHtml(row.item_name)}]</span>` : ""}
              <i class="bi bi-shop text-secondary me-1"></i>${escapeHtml(row.shop_name)}
              ${lowestBadge}
            </div>
            <div class="extra-small text-muted">
              ${escapeHtml(row.checked_date)}
              ${row.memo ? ` ・ <span class="text-secondary">${escapeHtml(row.memo)}</span>` : ""}
            </div>
          </div>
          <div class="text-end flex-shrink-0">
            <div class="fw-bolder ${isLowest ? "text-danger" : "text-dark"}">
              ¥${formatYen(row.price)}
            </div>
            ${pointBadge}
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = html;
}

function renderItemsSummaryList() {
  const container = document.getElementById("itemsSummaryList");
  if (!container) return;

  if (!state.items || state.items.length === 0) {
    container.innerHTML = `
      <div class="text-center text-muted py-3 small">
        登録されている商品がありません。「＋新規商品を追加」から作成してください。
      </div>
    `;
    return;
  }

  const html = state.items
    .map((item) => {
      const isActive = Number(item.id) === Number(state.selectedItemId);
      const hasMin = item.min_price !== null && item.min_price !== undefined;
      return `
        <div
          class="item-summary-row border rounded-3 p-2 mb-2 d-flex align-items-center justify-content-between ${
            isActive ? "active-item" : ""
          }"
          data-item-id="${item.id}"
        >
          <div class="min-w-0 pe-2">
            <div class="d-flex align-items-center gap-1">
              <span class="badge bg-secondary-subtle text-secondary extra-small">${escapeHtml(item.category)}</span>
              <span class="fw-bold small text-truncate">${escapeHtml(item.name)}</span>
            </div>
            <div class="extra-small text-muted mt-1">
              ${
                hasMin
                  ? `最安店舗: ${escapeHtml(item.min_price_shop || "-")} (${escapeHtml(item.min_price_date || "-")})`
                  : "価格ログ未登録"
              }
            </div>
          </div>
          <div class="text-end flex-shrink-0">
            <span class="extra-small text-muted d-block">過去最安</span>
            <span class="fw-bolder ${hasMin ? "text-primary" : "text-muted"}">
              ${hasMin ? `¥${formatYen(item.min_price)}` : "---"}
            </span>
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = html;

  container.querySelectorAll(".item-summary-row").forEach((el) => {
    el.addEventListener("click", () => {
      const id = Number(el.getAttribute("data-item-id"));
      selectItemById(id, true);
    });
  });
}

function updateShopSuggestions(purchasesList = []) {
  const datalist = document.getElementById("shopHistoryList");
  if (!datalist) return;

  const shops = new Set(["ウエルシア", "マツモトキヨシ", "オーケー", "イオン", "Amazon", "楽天24"]);
  state.priceChecks.forEach((c) => {
    if (c.shop_name) shops.add(c.shop_name);
  });
  purchasesList.forEach((p) => {
    if (p.shop_name) shops.add(p.shop_name);
  });

  datalist.innerHTML = Array.from(shops)
    .map((s) => `<option value="${escapeHtml(s)}"></option>`)
    .join("");
}

// =========================================================
// レンダリング & UI更新: タブ2 (買ったもの・在庫管理)
// =========================================================

function updatePurchaseCounters(allPurchases) {
  const totalCount = allPurchases.length;
  const inStockCount = allPurchases.filter((p) => p.stock_status === "在庫あり").length;
  const needBuyCount = allPurchases.filter((p) => p.stock_status === "買い出し要").length;

  const countAllEl = document.getElementById("countAllBadge");
  const countInStockEl = document.getElementById("countInStockBadge");
  const countNeedBuyEl = document.getElementById("countNeedBuyBadge");
  const headerNeedBuyCount = document.getElementById("needBuyCount");
  const tabNeedBuyBadge = document.getElementById("tabNeedBuyBadge");

  if (countAllEl) countAllEl.textContent = totalCount;
  if (countInStockEl) countInStockEl.textContent = inStockCount;
  if (countNeedBuyEl) countNeedBuyEl.textContent = needBuyCount;
  if (headerNeedBuyCount) headerNeedBuyCount.textContent = needBuyCount;

  if (tabNeedBuyBadge) {
    tabNeedBuyBadge.textContent = needBuyCount;
    tabNeedBuyBadge.classList.toggle("d-none", needBuyCount === 0);
  }
}

function renderPurchases() {
  const tbody = document.getElementById("purchasesTableBody");
  const cardList = document.getElementById("purchasesCardList");
  const emptyState = document.getElementById("purchasesEmptyState");
  const searchQuery = (document.getElementById("purchaseSearchInput")?.value || "").trim().toLowerCase();

  const filtered = state.purchases.filter((p) => {
    if (!searchQuery) return true;
    const text = `${p.item_name || ""} ${p.item_category || ""} ${p.shop_name || ""}`.toLowerCase();
    return text.includes(searchQuery);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    cardList.innerHTML = "";
    emptyState.classList.remove("d-none");
    return;
  }

  emptyState.classList.add("d-none");

  tbody.innerHTML = filtered
    .map((p) => {
      const isNeedBuy = p.stock_status === "買い出し要";
      const statusBtnClass = isNeedBuy ? "status-need-buy" : "status-in-stock";
      const statusIcon = isNeedBuy ? "bi-exclamation-triangle-fill" : "bi-check-circle-fill";

      const isLowest = p.min_price !== null && Number(p.buy_price) <= Number(p.min_price);
      const minCompareBadge = isLowest
        ? `<span class="badge bg-success-subtle text-success border border-success-subtle ms-1">最安購入</span>`
        : p.min_price !== null
        ? `<span class="extra-small text-muted d-block">底値: ¥${formatYen(p.min_price)}</span>`
        : "";

      return `
        <tr class="${isNeedBuy ? "table-danger bg-opacity-10" : ""}">
          <td>
            <button
              type="button"
              class="btn btn-sm status-toggle-btn ${statusBtnClass}"
              data-toggle-purchase-id="${p.id}"
              title="タップして「在庫あり ⇔ 買い出し要」を切り替え"
            >
              <i class="bi ${statusIcon} me-1"></i>${escapeHtml(p.stock_status)}
              <i class="bi bi-arrow-left-right ms-1 opacity-75 extra-small"></i>
            </button>
          </td>
          <td>
            <div class="fw-bold text-dark">${escapeHtml(p.item_name)}</div>
            <span class="badge bg-secondary-subtle text-secondary extra-small">${escapeHtml(p.item_category)}</span>
          </td>
          <td>
            <i class="bi bi-shop text-muted me-1"></i>${escapeHtml(p.shop_name)}
          </td>
          <td class="text-end">
            <span class="fw-bolder fs-6">¥${formatYen(p.buy_price)}</span>
            ${minCompareBadge}
          </td>
          <td class="text-center">
            <span class="badge bg-light text-dark border">${p.quantity}個</span>
          </td>
          <td class="text-muted small">${escapeHtml(p.purchase_date)}</td>
          <td class="text-end">
            <button
              type="button"
              class="btn btn-sm btn-outline-primary rounded-pill px-2"
              data-compare-item-id="${p.item_id}"
              title="この商品の価格を比較・再入力"
            >
              <i class="bi bi-search me-1"></i>価格比較へ
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  cardList.innerHTML = filtered
    .map((p) => {
      const isNeedBuy = p.stock_status === "買い出し要";
      const statusBtnClass = isNeedBuy ? "status-need-buy" : "status-in-stock";
      const statusIcon = isNeedBuy ? "bi-exclamation-triangle-fill" : "bi-check-circle-fill";

      return `
        <div class="purchase-card p-3 shadow-xs ${isNeedBuy ? "need-buy-card" : ""}">
          <div class="d-flex align-items-start justify-content-between gap-2 mb-2">
            <div>
              <span class="badge bg-secondary-subtle text-secondary extra-small mb-1">
                ${escapeHtml(p.item_category)}
              </span>
              <h3 class="h6 fw-bold mb-0 text-dark">${escapeHtml(p.item_name)}</h3>
            </div>
            <button
              type="button"
              class="btn btn-sm status-toggle-btn ${statusBtnClass}"
              data-toggle-purchase-id="${p.id}"
            >
              <i class="bi ${statusIcon} me-1"></i>${escapeHtml(p.stock_status)}
              <i class="bi bi-arrow-repeat ms-1"></i>
            </button>
          </div>
          <div class="d-flex align-items-center justify-content-between text-muted small pt-1 border-top">
            <div>
              <div><i class="bi bi-shop me-1"></i>${escapeHtml(p.shop_name)} （${p.quantity}個）</div>
              <div class="extra-small"><i class="bi bi-calendar3 me-1"></i>${escapeHtml(p.purchase_date)}</div>
            </div>
            <div class="text-end">
              <div class="fw-bolder fs-5 text-dark">¥${formatYen(p.buy_price)}</div>
              <button
                type="button"
                class="btn btn-link btn-sm p-0 extra-small text-decoration-none"
                data-compare-item-id="${p.item_id}"
              >
                <i class="bi bi-arrow-up-right-circle me-1"></i>再購入・価格比較
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-toggle-purchase-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const purchaseId = Number(btn.getAttribute("data-toggle-purchase-id"));
      await handleTogglePurchaseStatus(purchaseId, btn);
    });
  });

  document.querySelectorAll("[data-compare-item-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = Number(btn.getAttribute("data-compare-item-id"));
      selectItemById(itemId, true);
      const compareTabBtn = document.getElementById("tab-compare-btn");
      if (compareTabBtn) {
        bootstrap.Tab.getOrCreateInstance(compareTabBtn).show();
      }
      document.getElementById("priceInput")?.focus();
    });
  });
}

// =========================================================
// 基本CRUDアクションハンドラー (Flask API / Local 両対応)
// =========================================================

async function handleCreateItem() {
  const nameInput = document.getElementById("newItemName");
  const categorySelect = document.getElementById("newItemCategory");
  const janInput = document.getElementById("newItemJan");

  const name = (nameInput.value || "").trim();
  const category = categorySelect.value || "日用品";
  const jan_code = (janInput.value || "").trim();

  if (!name) {
    showToast("新規登録する商品名を入力してください", "danger");
    nameInput.focus();
    return;
  }

  try {
    let createdItem = null;
    if (state.mode === "api") {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, jan_code: jan_code || null }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "ok") {
        showToast(data.message || "商品の登録に失敗しました", "danger");
        return;
      }
      createdItem = data.item;
    } else {
      const store = loadLocalStore();
      if (jan_code && store.items.some((x) => x.jan_code === jan_code)) {
        showToast("同じJANコードの商品が既に登録されています。", "danger");
        return;
      }
      createdItem = {
        id: store.nextIds.item++,
        jan_code: jan_code || null,
        name,
        category,
      };
      store.items.push(createdItem);
      saveLocalStore(store);
    }

    nameInput.value = "";
    janInput.value = "";
    document.getElementById("newItemPanel").classList.add("d-none");

    state.selectedItemId = createdItem.id;
    await refreshAllViews();
    showToast(`「${createdItem.name}」を登録して選択しました`, "success");
    document.getElementById("shopNameInput")?.focus();
  } catch (err) {
    showToast(err.message || "エラーが発生しました", "danger");
  }
}

function validatePriceFormInput() {
  const itemId = state.selectedItemId || document.getElementById("itemSelect").value;
  const shopName = (document.getElementById("shopNameInput").value || "").trim();
  const priceStr = document.getElementById("priceInput").value;
  const pointStr = document.getElementById("pointInput").value;
  const quantityStr = document.getElementById("quantityInput").value;
  const dateStr = document.getElementById("dateInput").value || getTodayStr();
  const memo = (document.getElementById("memoInput").value || "").trim();

  if (!itemId) {
    showToast("STEP 1 で商品を選択（または新規追加）してください", "warning");
    document.getElementById("itemSelect").focus();
    return null;
  }
  if (!shopName) {
    showToast("店舗名を入力してください", "warning");
    document.getElementById("shopNameInput").focus();
    return null;
  }
  if (priceStr === "" || Number(priceStr) < 0) {
    showToast("今回の価格を正しく入力してください", "warning");
    document.getElementById("priceInput").focus();
    return null;
  }

  return {
    item_id: Number(itemId),
    shop_name: shopName,
    price: parseInt(priceStr, 10),
    buy_price: parseInt(priceStr, 10),
    point_back: parseInt(pointStr || "0", 10) || 0,
    quantity: Math.max(1, parseInt(quantityStr || "1", 10) || 1),
    checked_date: dateStr,
    purchase_date: dateStr,
    memo,
  };
}

async function handleSavePriceCheckOnly() {
  const payload = validatePriceFormInput();
  if (!payload) return;

  try {
    if (state.mode === "api") {
      const res = await fetch("/api/price-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "ok") {
        showToast(data.message || "価格調査ログの保存に失敗しました", "danger");
        return;
      }
    } else {
      const store = loadLocalStore();
      store.price_checks.push({
        id: store.nextIds.check++,
        item_id: payload.item_id,
        shop_name: payload.shop_name,
        price: payload.price,
        point_back: payload.point_back,
        checked_date: payload.checked_date,
        memo: payload.memo,
      });
      saveLocalStore(store);
    }

    await refreshAllViews();
    showToast("価格調査ログを保存しました！", "primary");

    document.getElementById("priceInput").value = "";
    document.getElementById("pointInput").value = "0";
    document.getElementById("memoInput").value = "";
    evaluateLowestPriceHighlight();
  } catch (err) {
    showToast(err.message || "エラーが発生しました", "danger");
  }
}

async function handleBuyAtThisPrice() {
  const payload = validatePriceFormInput();
  if (!payload) return;

  try {
    if (state.mode === "api") {
      const res = await fetch("/api/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          stock_status: "在庫あり",
          also_log_price_check: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "ok") {
        showToast(data.message || "購入記録の保存に失敗しました", "danger");
        return;
      }
    } else {
      const store = loadLocalStore();
      store.purchases.push({
        id: store.nextIds.purchase++,
        item_id: payload.item_id,
        shop_name: payload.shop_name,
        buy_price: payload.buy_price,
        quantity: payload.quantity,
        purchase_date: payload.purchase_date,
        stock_status: "在庫あり",
      });
      store.price_checks.push({
        id: store.nextIds.check++,
        item_id: payload.item_id,
        shop_name: payload.shop_name,
        price: payload.buy_price,
        point_back: payload.point_back,
        checked_date: payload.purchase_date,
        memo: payload.memo || "購入と同時に価格記録",
      });
      saveLocalStore(store);
    }

    await refreshAllViews();
    showToast("★購入履歴＆在庫（在庫あり）に追加し、価格ログも更新しました！", "success");

    document.getElementById("priceInput").value = "";
    document.getElementById("pointInput").value = "0";
    document.getElementById("quantityInput").value = "1";
    document.getElementById("memoInput").value = "";
    evaluateLowestPriceHighlight();
  } catch (err) {
    showToast(err.message || "エラーが発生しました", "danger");
  }
}

async function handleTogglePurchaseStatus(purchaseId, buttonEl) {
  if (buttonEl) buttonEl.disabled = true;
  try {
    let updatedItemName = "";
    let updatedStatus = "";

    if (state.mode === "api") {
      const res = await fetch(`/api/purchases/${purchaseId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "ok") {
        showToast(data.message || "ステータスの変更に失敗しました", "danger");
        return;
      }
      updatedItemName = data.purchase.item_name;
      updatedStatus = data.purchase.stock_status;
    } else {
      const store = loadLocalStore();
      const target = store.purchases.find((p) => Number(p.id) === Number(purchaseId));
      if (!target) return;
      target.stock_status = target.stock_status === "在庫あり" ? "買い出し要" : "在庫あり";
      saveLocalStore(store);
      const itemObj = store.items.find((i) => Number(i.id) === Number(target.item_id));
      updatedItemName = itemObj ? itemObj.name : "アイテム";
      updatedStatus = target.stock_status;
    }

    showToast(
      `「${updatedItemName}」を【${updatedStatus}】に切り替えました`,
      updatedStatus === "買い出し要" ? "warning" : "success"
    );
    await fetchPurchases();
  } catch (err) {
    showToast(err.message || "エラーが発生しました", "danger");
  } finally {
    if (buttonEl) buttonEl.disabled = false;
  }
}

// =========================================================
// 【タブ3】データ管理・JSON/CSV入出力・容量整理・クラウド同期
// =========================================================

async function updateDataStatsView() {
  const snapshot = await getFullSnapshotData();
  const itemsCount = (snapshot.items || []).length;
  const checksCount = (snapshot.price_checks || []).length;
  const purchasesCount = (snapshot.purchases || []).length;

  const statItemsEl = document.getElementById("statItemsCount");
  const statChecksEl = document.getElementById("statChecksCount");
  const statPurchasesEl = document.getElementById("statPurchasesCount");
  if (statItemsEl) statItemsEl.textContent = itemsCount;
  if (statChecksEl) statChecksEl.textContent = checksCount;
  if (statPurchasesEl) statPurchasesEl.textContent = purchasesCount;

  const jsonBytes = new Blob([JSON.stringify(snapshot)]).size;
  const kb = (jsonBytes / 1024).toFixed(1);
  const maxKb = 5120; // LocalStorage 5MB目安
  const ratio = Math.min(100, (jsonBytes / (maxKb * 1024)) * 100);

  const sizeTextEl = document.getElementById("storageSizeText");
  const barEl = document.getElementById("storageProgressBar");
  if (sizeTextEl) {
    sizeTextEl.textContent = `${kb} KB / 5,120 KB (${ratio.toFixed(1)}%)`;
  }
  if (barEl) {
    barEl.style.width = `${Math.max(2, ratio)}%`;
    barEl.className = `progress-bar ${
      ratio > 80 ? "bg-danger" : ratio > 50 ? "bg-warning" : "bg-success"
    }`;
  }
}

function downloadBlobFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCsvField(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCsvRows(csvText) {
  const clean = csvText.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];
  const lines = clean.split(/\r?\n/);
  return lines.map((line) => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  });
}

// 1. JSON 完全バックアップ書き出し
async function handleExportJson() {
  const snapshot = await getFullSnapshotData();
  const filename = `price_stock_backup_${getTodayStr()}.json`;
  downloadBlobFile(JSON.stringify(snapshot, null, 2), filename, "application/json;charset=utf-8");
  showToast(`JSONバックアップ (${filename}) を書き出しました`, "success");
}

// 2. CSV 書き出し（Excel対応 UTF-8 BOM付き）
async function handleExportCsv(type) {
  const BOM = "\uFEFF";
  const snapshot = await getFullSnapshotData();
  const itemMap = new Map((snapshot.items || []).map((i) => [Number(i.id), i]));

  if (type === "items") {
    const header = ["id", "name", "category", "jan_code", "min_price", "min_effective_price", "min_price_shop", "min_price_date"];
    const rows = state.items.map((it) =>
      [
        it.id,
        it.name,
        it.category,
        it.jan_code || "",
        it.min_price ?? "",
        it.min_effective_price ?? "",
        it.min_price_shop || "",
        it.min_price_date || "",
      ]
        .map(toCsvField)
        .join(",")
    );
    const csv = BOM + [header.join(","), ...rows].join("\r\n");
    downloadBlobFile(csv, `items_min_prices_${getTodayStr()}.csv`, "text/csv;charset=utf-8");
    showToast("商品＆底値一覧CSVを書き出しました", "success");
  } else if (type === "checks") {
    const header = ["id", "item_id", "item_name", "category", "shop_name", "price", "point_back", "checked_date", "memo"];
    const rows = (snapshot.price_checks || []).map((c) => {
      const it = itemMap.get(Number(c.item_id)) || {};
      return [
        c.id,
        c.item_id,
        it.name || "",
        it.category || "",
        c.shop_name,
        c.price,
        c.point_back || 0,
        c.checked_date,
        c.memo || "",
      ]
        .map(toCsvField)
        .join(",");
    });
    const csv = BOM + [header.join(","), ...rows].join("\r\n");
    downloadBlobFile(csv, `price_checks_${getTodayStr()}.csv`, "text/csv;charset=utf-8");
    showToast("価格調査ログCSVを書き出しました", "success");
  } else if (type === "purchases") {
    const header = ["id", "item_id", "item_name", "category", "shop_name", "buy_price", "quantity", "purchase_date", "stock_status"];
    const rows = (snapshot.purchases || []).map((p) => {
      const it = itemMap.get(Number(p.item_id)) || {};
      return [
        p.id,
        p.item_id,
        it.name || "",
        it.category || "",
        p.shop_name,
        p.buy_price,
        p.quantity || 1,
        p.purchase_date,
        p.stock_status,
      ]
        .map(toCsvField)
        .join(",");
    });
    const csv = BOM + [header.join(","), ...rows].join("\r\n");
    downloadBlobFile(csv, `purchases_inventory_${getTodayStr()}.csv`, "text/csv;charset=utf-8");
    showToast("購入・在庫リストCSVを書き出しました", "success");
  }
}

// 3. JSON / CSV ファイル読み込み（インポート）
async function handleImportFile() {
  const fileInput = document.getElementById("importFileInput");
  const modeSelect = document.getElementById("importModeSelect");
  const file = fileInput?.files?.[0];
  const mode = modeSelect?.value || "merge";

  if (!file) {
    showToast("読み込むファイル (.json または .csv) を選択してください", "warning");
    return;
  }

  try {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".json")) {
      const parsed = JSON.parse(text);
      const snapshot = parsed.snapshot || parsed;
      await applyFullSnapshotData(snapshot, mode);
      showToast(`JSONファイルからデータを${mode === "replace" ? "完全復元" : "追加統合"}しました！`, "success");
    } else if (file.name.toLowerCase().endsWith(".csv")) {
      const rows = parseCsvRows(text);
      if (rows.length < 2) {
        showToast("CSVファイルにデータ行が含まれていません", "warning");
        return;
      }
      const headers = rows[0].map((h) => h.trim().toLowerCase());
      const dataRows = rows.slice(1);
      const snapshot = { items: [], price_checks: [], purchases: [] };

      let tempItemId = 1;
      const itemNameToId = new Map();

      const ensureItem = (name, category = "日用品", jan = null) => {
        const key = name.trim();
        if (!itemNameToId.has(key)) {
          const id = tempItemId++;
          itemNameToId.set(key, id);
          snapshot.items.push({ id, name: key, category: category || "日用品", jan_code: jan });
        }
        return itemNameToId.get(key);
      };

      if (headers.includes("buy_price") || headers.includes("stock_status")) {
        // 購入・在庫CSV
        dataRows.forEach((r, idx) => {
          const obj = Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]));
          const itemName = obj.item_name || obj.name || `商品_${idx + 1}`;
          const itemId = ensureItem(itemName, obj.category || "日用品");
          snapshot.purchases.push({
            id: idx + 1,
            item_id: itemId,
            shop_name: obj.shop_name || "不明店舗",
            buy_price: Number(obj.buy_price || obj.price || 0),
            quantity: Number(obj.quantity || 1),
            purchase_date: obj.purchase_date || getTodayStr(),
            stock_status: obj.stock_status || "在庫あり",
          });
        });
      } else if (headers.includes("checked_date") || headers.includes("point_back")) {
        // 価格調査ログCSV
        dataRows.forEach((r, idx) => {
          const obj = Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]));
          const itemName = obj.item_name || obj.name || `商品_${idx + 1}`;
          const itemId = ensureItem(itemName, obj.category || "日用品");
          snapshot.price_checks.push({
            id: idx + 1,
            item_id: itemId,
            shop_name: obj.shop_name || "不明店舗",
            price: Number(obj.price || 0),
            point_back: Number(obj.point_back || 0),
            checked_date: obj.checked_date || getTodayStr(),
            memo: obj.memo || "",
          });
        });
      } else {
        // 商品一覧CSV
        dataRows.forEach((r, idx) => {
          const obj = Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]));
          const itemName = obj.name || obj.item_name;
          if (!itemName) return;
          const itemId = ensureItem(itemName, obj.category || "日用品", obj.jan_code || null);
          if (obj.min_price !== undefined && obj.min_price !== "") {
            snapshot.price_checks.push({
              id: idx + 1,
              item_id: itemId,
              shop_name: obj.min_price_shop || "CSVインポート最安",
              price: Number(obj.min_price),
              point_back: 0,
              checked_date: obj.min_price_date || getTodayStr(),
              memo: "CSVからインポート",
            });
          }
        });
      }

      await applyFullSnapshotData(snapshot, mode);
      showToast("CSVデータを読み込みました！", "success");
    } else {
      showToast("対応していないファイル形式です (.json または .csv を選択してください)", "danger");
    }
    fileInput.value = "";
  } catch (err) {
    showToast(`読み込みエラー: ${err.message}`, "danger");
  }
}

// 4. 容量整理（底値レコードを保護して古い調査ログのみ削除）
async function handleCleanupOldChecks() {
  const keepCount = Math.max(1, parseInt(document.getElementById("cleanupKeepCount")?.value || "10", 10));

  try {
    let deletedCount = 0;
    if (state.mode === "api") {
      const res = await fetch("/api/data/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_per_item: keepCount }),
      });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        deletedCount = data.deleted_count || 0;
      }
    } else {
      const store = loadLocalStore();
      const keptChecks = [];
      for (const item of store.items) {
        const itemChecks = store.price_checks
          .filter((c) => Number(c.item_id) === Number(item.id))
          .sort((a, b) => String(b.checked_date).localeCompare(String(a.checked_date)) || Number(b.id) - Number(a.id));

        if (itemChecks.length <= keepCount) {
          keptChecks.push(...itemChecks);
          continue;
        }

        const minRaw = Math.min(...itemChecks.map((c) => Number(c.price)));
        const minEff = Math.min(...itemChecks.map((c) => Number(c.price) - Number(c.point_back || 0)));
        const keepIds = new Set(itemChecks.slice(0, keepCount).map((c) => c.id));

        for (const c of itemChecks) {
          if (Number(c.price) === minRaw || Number(c.price) - Number(c.point_back || 0) === minEff) {
            keepIds.add(c.id);
          }
        }
        for (const c of itemChecks) {
          if (keepIds.has(c.id)) {
            keptChecks.push(c);
          } else {
            deletedCount++;
          }
        }
      }
      store.price_checks = keptChecks;
      saveLocalStore(store);
    }

    await refreshAllViews();
    showToast(
      deletedCount > 0
        ? `過去最安値を保護したまま、古い調査ログ ${deletedCount}件 を整理しました！`
        : "整理対象の古い調査ログはありませんでした（容量は十分空きがあります）",
      "info"
    );
  } catch (err) {
    showToast(err.message || "データ整理に失敗しました", "danger");
  }
}

// 5. GitHub Gist クラウド同期 (Push / Pull)
function loadSyncConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_SYNC_CFG) || "{}");
  } catch (_) {
    return {};
  }
}

function saveSyncConfig(cfg) {
  localStorage.setItem(STORAGE_KEY_SYNC_CFG, JSON.stringify(cfg));
  const badge = document.getElementById("lastSyncTimeBadge");
  if (badge && cfg.lastSync) {
    badge.textContent = `最終クラウド同期: ${cfg.lastSync}`;
  }
}

async function handleGistPush() {
  const token = (document.getElementById("gistTokenInput")?.value || "").trim();
  let gistId = (document.getElementById("gistIdInput")?.value || "").trim();

  if (!token) {
    showToast("GitHub Personal Access Token (gist権限) を入力してください", "warning");
    document.getElementById("gistTokenInput")?.focus();
    return;
  }

  try {
    const snapshot = await getFullSnapshotData();
    const bodyPayload = {
      description: "底値＆在庫マネージャー クラウド同期データ (Price & Stock Manager)",
      public: false,
      files: {
        "price_stock_sync.json": {
          content: JSON.stringify(snapshot, null, 2),
        },
      },
    };

    const url = gistId ? `https://api.github.com/gists/${encodeURIComponent(gistId)}` : "https://api.github.com/gists";
    const method = gistId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "GitHub Gistへの保存に失敗しました");
    }

    gistId = data.id;
    document.getElementById("gistIdInput").value = gistId;
    const nowStr = new Date().toLocaleString("ja-JP");
    saveSyncConfig({ token, gistId, lastSync: nowStr });

    showToast(`GitHub Gist (ID: ${gistId.slice(0, 8)}...) へクラウド保存しました！`, "success");
  } catch (err) {
    showToast(`Gist同期エラー: ${err.message}`, "danger");
  }
}

async function handleGistPull() {
  const token = (document.getElementById("gistTokenInput")?.value || "").trim();
  const gistId = (document.getElementById("gistIdInput")?.value || "").trim();

  if (!gistId) {
    showToast("取得する Gist ID を入力してください", "warning");
    document.getElementById("gistIdInput")?.focus();
    return;
  }

  try {
    const headers = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "GitHub Gistからのデータ取得に失敗しました");
    }

    const fileObj =
      data.files?.["price_stock_sync.json"] || Object.values(data.files || {})[0];
    if (!fileObj || !fileObj.content) {
      throw new Error("Gist内に同期用のJSONデータが見つかりません");
    }

    const snapshot = JSON.parse(fileObj.content);
    await applyFullSnapshotData(snapshot, "replace");

    const nowStr = new Date().toLocaleString("ja-JP");
    saveSyncConfig({ token, gistId, lastSync: nowStr });
    showToast("GitHub Gist から最新データを取得して同期しました！", "success");
  } catch (err) {
    showToast(`Gist取得エラー: ${err.message}`, "danger");
  }
}

// 6. スマホ共有シート / Google Drive 直接保存連携 (Web Share API Level 2 / File System Access API)
async function handleShareCloudFile() {
  const snapshot = await getFullSnapshotData();
  const jsonStr = JSON.stringify(snapshot, null, 2);
  const filename = `price_stock_sync_${getTodayStr()}.json`;
  const file = new File([jsonStr], filename, { type: "application/json" });

  // スマホ等の Web Share API (Google DriveアプリやAirDrop、LINE Keepへ直接送信可能)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: "底値＆在庫マネージャー バックアップデータ",
        text: "PC・スマホ同期用のJSONデータです（Googleドライブ等に保存してください）",
        files: [file],
      });
      showToast("共有シートからクラウドへ送信しました", "success");
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }

  // PC Chrome/Edge 等の File System Access API（Googleドライブ同期フォルダへ直接上書き保存可能）
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "JSON Sync File", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      showToast("指定したクラウドフォルダにJSONを保存しました！", "success");
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }

  // フォールバック: 通常ダウンロード
  downloadBlobFile(jsonStr, filename, "application/json;charset=utf-8");
  showToast("JSONファイルをダウンロードしました（Googleドライブへアップロードしてください）", "info");
}

// 7. 同期コード（Base64）コピー ＆ ペースト移行
async function handleCopySyncCode() {
  try {
    const snapshot = await getFullSnapshotData();
    const jsonStr = JSON.stringify(snapshot);
    const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
    await navigator.clipboard.writeText(encoded);
    showToast("同期コードをクリップボードにコピーしました！別端末で貼り付けてください", "success");
  } catch (err) {
    showToast("コピーに失敗しました", "danger");
  }
}

// 8. スマホアクセス用 QRコード生成
function renderQrCode(urlText) {
  const container = document.getElementById("qrCodeCanvasContainer");
  if (!container) return;
  container.innerHTML = "";
  const cleanUrl = (urlText || "").trim() || window.location.href;

  if (typeof QRCode !== "undefined") {
    new QRCode(container, {
      text: cleanUrl,
      width: 196,
      height: 196,
      colorDark: "#1e3a8a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    // 万一CDNスクリプトがブロックされた場合のSVG/画像APIフォールバック
    const img = document.createElement("img");
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=196x196&data=${encodeURIComponent(cleanUrl)}`;
    img.alt = "QR Code";
    img.width = 196;
    img.height = 196;
    container.appendChild(img);
  }
}

async function initQrModalUrl() {
  const urlInput = document.getElementById("qrTargetUrlInput");
  const hintEl = document.getElementById("qrUrlHintText");
  if (!urlInput) return;

  let targetUrl = window.location.href;

  // ローカル（localhost / 127.0.0.1）で Flask サーバー起動中の場合は、スマホから直接繋がる LAN IP を自動取得
  if (
    state.mode === "api" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ) {
    try {
      const res = await fetch("/api/network-info");
      const data = await res.json();
      if (res.ok && data.lan_url) {
        targetUrl = data.lan_url;
        if (hintEl) {
          hintEl.innerHTML = `<i class="bi bi-wifi text-success me-1"></i><strong>自宅Wi-Fiモード:</strong> 同じWi-Fiに接続したスマホで読み取ると、PCのサーバー (<code>${escapeHtml(
            data.lan_url
          )}</code>) に直接繋がります。`;
        }
      }
    } catch (_) {
      // ignore
    }
  } else if (window.location.protocol === "file:") {
    // ローカルファイルを直接開いている場合は保存済みのGitHub Pages URLまたは入力案内を表示
    const savedUrl = localStorage.getItem("price_stock_public_url") || "";
    targetUrl = savedUrl || "https://example.github.io/price-manager/";
    if (hintEl) {
      hintEl.innerHTML = `<i class="bi bi-info-circle text-primary me-1"></i>GitHub Pages に公開したURLを上の欄に入力すると、そのURLのQRコードが生成されます（自動保存されます）。`;
    }
  } else if (hintEl) {
    hintEl.innerHTML = `<i class="bi bi-globe text-success me-1"></i>現在開いている公開URL (<code>${escapeHtml(
      targetUrl
    )}</code>) のQRコードを表示しています。`;
  }

  urlInput.value = targetUrl;
  renderQrCode(targetUrl);
}

async function handlePasteSyncCode() {
  try {
    let code = "";
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        code = await navigator.clipboard.readText();
      } catch (_) {
        // 権限ダイアログ拒否時はプロンプト入力へフォールバック
      }
    }
    if (!code || !code.trim()) {
      code = window.prompt("コピーした同期コード（またはJSON文字列）をここに貼り付けてください:") || "";
    }
    code = code.trim();
    if (!code) return;

    const jsonStr = code.startsWith("{") ? code : decodeURIComponent(escape(atob(code)));
    const snapshot = JSON.parse(jsonStr);
    await applyFullSnapshotData(snapshot, "merge");
    showToast("同期コードからデータを復元・統合しました！", "success");
  } catch (err) {
    showToast("同期コードの形式が正しくありません", "danger");
  }
}

// =========================================================
// 初期化 & イベントリスナー登録
// =========================================================

document.addEventListener("DOMContentLoaded", async () => {
  const dateInput = document.getElementById("dateInput");
  if (dateInput) {
    dateInput.value = getTodayStr();
  }

  // 保存済みGist同期設定の復元
  const syncCfg = loadSyncConfig();
  if (syncCfg.token && document.getElementById("gistTokenInput")) {
    document.getElementById("gistTokenInput").value = syncCfg.token;
  }
  if (syncCfg.gistId && document.getElementById("gistIdInput")) {
    document.getElementById("gistIdInput").value = syncCfg.gistId;
  }
  if (syncCfg.lastSync && document.getElementById("lastSyncTimeBadge")) {
    document.getElementById("lastSyncTimeBadge").textContent = `最終クラウド同期: ${syncCfg.lastSync}`;
  }

  // 動作モード自動判別（Flask API or GitHub Pages サーバーレス）
  await detectBackendMode();

  // タブ1 イベント
  document.getElementById("itemSearchInput")?.addEventListener("input", renderItemSelect);
  document.getElementById("itemSelect")?.addEventListener("change", (e) => {
    selectItemById(e.target.value, false);
  });

  document.getElementById("toggleNewItemFormBtn")?.addEventListener("click", () => {
    const panel = document.getElementById("newItemPanel");
    const isHidden = panel.classList.contains("d-none");
    panel.classList.toggle("d-none", !isHidden);
    if (isHidden) {
      const searchVal = (document.getElementById("itemSearchInput")?.value || "").trim();
      const newNameInput = document.getElementById("newItemName");
      if (searchVal && !newNameInput.value) {
        newNameInput.value = searchVal;
      }
      newNameInput.focus();
    }
  });

  document.getElementById("closeNewItemPanelBtn")?.addEventListener("click", () => {
    document.getElementById("newItemPanel").classList.add("d-none");
  });

  document.getElementById("createItemBtn")?.addEventListener("click", handleCreateItem);
  document.getElementById("newItemName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateItem();
    }
  });

  document.getElementById("priceInput")?.addEventListener("input", evaluateLowestPriceHighlight);
  document.getElementById("pointInput")?.addEventListener("input", evaluateLowestPriceHighlight);
  document.getElementById("saveCheckOnlyBtn")?.addEventListener("click", handleSavePriceCheckOnly);
  document.getElementById("buyAtThisPriceBtn")?.addEventListener("click", handleBuyAtThisPrice);

  // タブ2 イベント
  document.querySelectorAll("[data-status-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("[data-status-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentStatusFilter = btn.getAttribute("data-status-filter") || "すべて";
      await fetchPurchases();
    });
  });

  const headerNeedBuyBadge = document.getElementById("headerNeedBuyBadge");
  if (headerNeedBuyBadge) {
    headerNeedBuyBadge.style.cursor = "pointer";
    headerNeedBuyBadge.addEventListener("click", () => {
      const inventoryTabBtn = document.getElementById("tab-inventory-btn");
      if (inventoryTabBtn) {
        bootstrap.Tab.getOrCreateInstance(inventoryTabBtn).show();
      }
      document.querySelector('[data-status-filter="買い出し要"]')?.click();
    });
  }

  document.getElementById("purchaseSearchInput")?.addEventListener("input", renderPurchases);
  document.getElementById("goToCompareTabBtn")?.addEventListener("click", () => {
    const compareTabBtn = document.getElementById("tab-compare-btn");
    if (compareTabBtn) {
      bootstrap.Tab.getOrCreateInstance(compareTabBtn).show();
    }
  });

  // タブ3（データ管理・同期）イベント
  document.getElementById("exportJsonBtn")?.addEventListener("click", handleExportJson);
  document.getElementById("exportItemsCsvBtn")?.addEventListener("click", () => handleExportCsv("items"));
  document.getElementById("exportChecksCsvBtn")?.addEventListener("click", () => handleExportCsv("checks"));
  document.getElementById("exportPurchasesCsvBtn")?.addEventListener("click", () => handleExportCsv("purchases"));
  document.getElementById("runImportFileBtn")?.addEventListener("click", handleImportFile);
  document.getElementById("runCleanupBtn")?.addEventListener("click", handleCleanupOldChecks);

  document.getElementById("loadSampleDataBtn")?.addEventListener("click", async () => {
    const sample = getDefaultSampleStore();
    await applyFullSnapshotData(sample, "merge");
    showToast("サンプルデータを投入しました！", "info");
  });

  document.getElementById("clearAllDataBtn")?.addEventListener("click", async () => {
    if (!window.confirm("本当にすべてのデータ（商品・調査ログ・購入在庫）を初期化しますか？\n※事前にJSONバックアップを書き出すことをおすすめします。")) {
      return;
    }
    if (state.mode === "api") {
      await fetch("/api/data/clear", { method: "POST" });
    }
    saveLocalStore({ schema_version: 1, items: [], price_checks: [], purchases: [] });
    state.selectedItemId = null;
    await refreshAllViews();
    showToast("全データを初期化しました", "secondary");
  });

  document.getElementById("gistPushBtn")?.addEventListener("click", handleGistPush);
  document.getElementById("gistPullBtn")?.addEventListener("click", handleGistPull);
  document.getElementById("shareCloudFileBtn")?.addEventListener("click", handleShareCloudFile);
  document.getElementById("directFileSyncBtn")?.addEventListener("click", () => {
    const fileInput = document.getElementById("importFileInput");
    if (fileInput) {
      fileInput.click();
      fileInput.onchange = () => {
        if (fileInput.files?.length) handleImportFile();
      };
    }
  });
  document.getElementById("copySyncCodeBtn")?.addEventListener("click", handleCopySyncCode);
  document.getElementById("pasteSyncCodeBtn")?.addEventListener("click", handlePasteSyncCode);

  // スマホQRコードモーダル関連イベント
  const qrModalEl = document.getElementById("qrCodeModal");
  if (qrModalEl) {
    qrModalEl.addEventListener("show.bs.modal", () => {
      initQrModalUrl();
    });
  }
  document.getElementById("qrTargetUrlInput")?.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val) {
      localStorage.setItem("price_stock_public_url", val);
      renderQrCode(val);
    }
  });
  document.getElementById("copyQrUrlBtn")?.addEventListener("click", async () => {
    const val = document.getElementById("qrTargetUrlInput")?.value || "";
    if (!val) return;
    await navigator.clipboard.writeText(val);
    showToast("URLをクリップボードにコピーしました！", "primary");
  });

  // 初回全データ読み込み
  try {
    await refreshAllViews();
  } catch (err) {
    showToast(err.message || "初期データの読み込みに失敗しました", "danger");
  }
});

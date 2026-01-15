const fmtYen = (n) => n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
const fmtPct = (v) => v == null ? "-" : (v * 100).toFixed(1) + "%";

let RAW_SUMMARY = null;     // ./data/raw/summary.json
let RAW_ROWS = [];          // ./data/raw/rows.json（279行）
let RAW_MASTER = null;      // ./data/master/symbol_master.json（辞書）

// いまの「軸」：チップの対象（= group by のキー）
// まずは「景品ジャンル」から始め、後でUIで切替を追加していく
let axisKey = "景品ジャンル";  // 例: "3本爪", "投入法", "キャラ", "年代" など

let selected = new Set();   // 選択中の軸値（= チップで選ぶ）
let sortKey = "sales";
let sortDir = "desc";       // "asc" | "desc"

async function main() {
  // ★ A方式：rows.json と raw/summary.json を読む
  RAW_SUMMARY = await fetchJson("./data/raw/summary.json");
  RAW_ROWS = await fetchJson("./data/raw/rows.json");

  // symbol_master は無くても動く（後で入る前提）
  try {
    RAW_MASTER = await fetchJson("./data/master/symbol_master.json");
  } catch (e) {
    console.warn("symbol_master.json not found (optional).", e);
    RAW_MASTER = null;
  }

  // 初期：軸の全値を全選択
  const byAxis = buildAggByAxis(axisKey, RAW_ROWS);
  selected = new Set(byAxis.map(r => r.axis ?? "(未設定)"));

  renderSymbolChips(); // チップ生成
  wireEvents();
  render();            // 初回描画
}

function wireEvents() {
  document.querySelector("#btn_all")?.addEventListener("click", () => {
    selected = new Set(visibleAxisValuesByQuery());
    render();
    syncChipsChecked();
  });

  document.querySelector("#btn_none")?.addEventListener("click", () => {
    selected = new Set();
    render();
    syncChipsChecked();
  });

  document.querySelector("#q")?.addEventListener("input", () => {
    // 検索はチップの表示だけ更新
    renderSymbolChips();
  });

  // ソート（thクリック）
  document.querySelectorAll("#tbl thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) {
        sortDir = (sortDir === "desc") ? "asc" : "desc";
      } else {
        sortKey = key;
        sortDir = (key === "symbol") ? "asc" : "desc";
      }
      render();
    });
  });
}

/**
 * いまのUIは「記号チップ」前提だったので、
 * A方式では「軸の値（例：景品ジャンル=食品）」をチップ化する。
 */
function renderSymbolChips() {
  const box = document.querySelector("#symbol_box");
  if (!box) return;
  box.innerHTML = "";

  const q = (document.querySelector("#q")?.value || "").trim().toLowerCase();

  // rows から軸別集計（チップの売上サブ表示に使う）
  const byAxis = buildAggByAxis(axisKey, RAW_ROWS);

  const rows = byAxis
    .filter(r => {
      const v = (r.axis ?? "(未設定)");
      if (!q) return true;
      return String(v).toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => String(a.axis ?? "").localeCompare(String(b.axis ?? ""), "ja"));

  rows.forEach(r => {
    const v = r.axis ?? "(未設定)";
    const chip = document.createElement("label");
    chip.className = "chip";
    chip.innerHTML = `
      <input type="checkbox" />
      <span class="tag">${escapeHtml(v)}</span>
      <span class="sub">${fmtYen(r.sales)}</span>
    `;
    const cb = chip.querySelector("input");
    cb.checked = selected.has(v);

    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(v);
      else selected.delete(v);
      render();
    });

    box.appendChild(chip);
  });
}

function syncChipsChecked() {
  document.querySelectorAll("#symbol_box .chip").forEach(chip => {
    const v = chip.querySelector(".tag")?.textContent ?? "";
    const cb = chip.querySelector("input");
    cb.checked = selected.has(v);
  });
}

function visibleAxisValuesByQuery() {
  const q = (document.querySelector("#q")?.value || "").trim().toLowerCase();
  const byAxis = buildAggByAxis(axisKey, RAW_ROWS);
  return byAxis
    .map(r => (r.axis ?? "(未設定)"))
    .filter(v => !q || String(v).toLowerCase().includes(q));
}

/**
 * 「意味」列：現状は景品ジャンル軸だけ意味を出す想定
 * （RAW_MASTERの構造がカテゴリ別辞書になっている前提）
 *
 * 例：axisKey="景品ジャンル" のとき、axis値がコードなら意味に変換できる。
 * ただし A方式では axis値自体が「食品」など人間語になってることが多いので、
 * 変換できなければそのまま空でOK。
 */
function getMeaningByAxisValue(axisKey, v) {
  if (!RAW_MASTER) return "";
  const dict = RAW_MASTER[axisKey] || {};
  return dict[v] ?? "";
}

/**
 * 原価率の色（あなた指定）
 * - 0%: 青
 * - 32%以上: 赤
 * - 25〜31%: 白グラデーション
 */
function rateStyleBySpec(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return "";
  const pct = rate * 100;

  if (pct >= 32) {
    return `
      background: #d93025;
      color: #fff;
      font-weight: 700;
      border-radius: 8px;
      padding: 4px 10px;
      display: inline-block;
      min-width: 72px;
      text-align: right;
    `.trim();
  }

  if (pct <= 0) {
    return `
      background: #1a73e8;
      color: #fff;
      font-weight: 700;
      border-radius: 8px;
      padding: 4px 10px;
      display: inline-block;
      min-width: 72px;
      text-align: right;
    `.trim();
  }

  if (pct >= 25 && pct <= 31) {
    const t = (pct - 25) / (31 - 25); // 0..1
    const alpha = 0.15 + t * 0.60;   // 0.15..0.75
    return `
      background: rgba(255,255,255,${alpha});
      color: #111;
      font-weight: 700;
      border: 1px solid rgba(0,0,0,0.10);
      border-radius: 8px;
      padding: 4px 10px;
      display: inline-block;
      min-width: 72px;
      text-align: right;
    `.trim();
  }

  if (pct < 25) {
    return `
      background: rgba(26,115,232,0.20);
      color: #111;
      font-weight: 700;
      border: 1px solid rgba(26,115,232,0.20);
      border-radius: 8px;
      padding: 4px 10px;
      display: inline-block;
      min-width: 72px;
      text-align: right;
    `.trim();
  }

  return `
    background: rgba(217,48,37,0.20);
    color: #111;
    font-weight: 700;
    border: 1px solid rgba(217,48,37,0.20);
    border-radius: 8px;
    padding: 4px 10px;
    display: inline-block;
    min-width: 72px;
    text-align: right;
  `.trim();
}

/**
 * ★A方式の核：rows → 軸別集計（RAW_BY_SYMBOL相当）を作る
 * 出力の形は、既存UIに合わせて：
 * { axis, sales, claw, cost_rate, count }
 */
function buildAggByAxis(axisKey, rows) {
  const map = new Map();

  for (const r of rows) {
    // rows.json の構造は build_data.mjs が作ったもの
    // 例: r["景品ジャンル"] / r["3本爪"] / r["投入法"] ... が入っている想定
    const axisVal = (r?.[axisKey] ?? "").trim() || "(未設定)";

    const cur = map.get(axisVal) || { axis: axisVal, sales: 0, claw: 0, count: 0 };
    cur.sales += num(r.sales);
    cur.claw += num(r.claw);
    cur.count += 1; // ★ST数＝行数（ブースID＝マシン数）
    map.set(axisVal, cur);
  }

  const arr = Array.from(map.values()).map(o => {
    const cost_rate = o.sales ? (o.claw * 1.1) / o.sales : null;
    return { ...o, cost_rate };
  });

  return arr;
}

function render() {
  // 更新日時（raw summary）
  document.querySelector("#updated").textContent =
    "更新: " + new Date(RAW_SUMMARY.updated_at).toLocaleString("ja-JP");

  // まず軸別集計を作る
  const byAxis = buildAggByAxis(axisKey, RAW_ROWS);

  // チップ選択でフィルタ（＝軸値の絞り込み）
  const filteredAgg = byAxis.filter(r => selected.has(r.axis ?? "(未設定)"));

  // KPI：選択中の合計（フィルタ後の合計）
  const totalSales = filteredAgg.reduce((a, r) => a + num(r.sales), 0);
  const totalClaw  = filteredAgg.reduce((a, r) => a + num(r.claw), 0);
  const costRate   = totalSales ? (totalClaw * 1.1) / totalSales : null;

  document.querySelector("#k_sales").textContent = fmtYen(totalSales);
  document.querySelector("#k_claw").textContent  = fmtYen(totalClaw);

  const kRate = document.querySelector("#k_rate");
  kRate.textContent = fmtPct(costRate);
  kRate.setAttribute("style", rateStyleBySpec(costRate));

  // フィルタ状況（選択中カテゴリ数/全カテゴリ数）
  document.querySelector("#k_filtered").textContent =
    `選択中: ${selected.size}/${byAxis.length} ${escapeHtml(axisKey)}`;

  // ソート（既存のsortKeyは sales/claw/cost_rate/count を想定）
  const sorted = filteredAgg.slice().sort((a, b) => cmpAgg(a, b, sortKey, sortDir));

  // テーブル描画
  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";

  sorted.forEach(r => {
    const axisVal = r.axis ?? "(未設定)";
    const meaning = getMeaningByAxisValue(axisKey, axisVal);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(axisVal)}</td>
      <td class="meaning" title="${escapeHtml(meaning)}">${escapeHtml(meaning)}</td>
      <td>${fmtYen(num(r.sales))}</td>
      <td>${fmtYen(num(r.claw))}</td>
      <td><span style="${rateStyleBySpec(r.cost_rate)}">${fmtPct(r.cost_rate)}</span></td>
      <td>${r.count ?? ""}</td>
    `;
    tb.appendChild(tr);
  });

  // 検索でチップが再生成されてる場合があるので、同期
  syncChipsChecked();
}

function cmpAgg(a, b, key, dir) {
  const s = (dir === "desc") ? -1 : 1;

  // 既存UIの th[data-sort="symbol"] を「軸の文字列」に読み替える
  if (key === "symbol") {
    return s * String(a.axis ?? "").localeCompare(String(b.axis ?? ""), "ja");
  }

  const av = num(a[key]);
  const bv = num(b[key]);
  if (av === bv) return 0;
  return (av < bv ? -1 : 1) * s;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.json();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

main().catch(e => {
  console.error(e);
  alert("読み込み失敗: " + e.message);
});

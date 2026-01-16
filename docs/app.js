/******************************************************
 * app.js（A方式：実データ）
 *  - ./data/raw/rows.json（ブースID=行＝マシン数）
 *  - ./data/raw/summary.json
 *  - ./data/master/symbol_master.json（辞書）
 *
 * 目的（今回の段階）
 * 1) セレクトで「投入法」を 3本爪 / 2本爪 に切替
 * 2) 切替に応じて “軸” を 3本爪 / 2本爪 に自動で切替（= 内訳が変わる）
 * 3) チップ・テーブル・KPI が全部連動
 *
 * 前提（HTML側）
 *  - 既存：#btn_all, #btn_none, #q, #symbol_box, #tbl, #updated, #k_sales, #k_claw, #k_rate, #k_filtered
 *  - 追加：投入法セレクト #mode_claw （value="3本爪" / "2本爪"）
 ******************************************************/

const fmtYen = (n) => n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
const fmtPct = (v) => v == null ? "-" : (v * 100).toFixed(1) + "%";

let RAW_SUMMARY = null;     // ./data/raw/summary.json
let RAW_ROWS = [];          // ./data/raw/rows.json（279行）
let RAW_MASTER = null;      // ./data/master/symbol_master.json（辞書）

// 投入法（まずここでフィルタ）
let clawMode = "3本爪";     // "3本爪" | "2本爪"

// 軸（group by のキー）…今回は clawMode に連動して「3本爪」「2本爪」を切替
let axisKey = "3本爪";      // "3本爪" | "2本爪"

// チップの選択（軸の値）
let selected = new Set();   // 例：["単品", "複数", "山積み"] or ["ブリッジ", ...]
let sortKey = "sales";
let sortDir = "desc";       // "asc" | "desc"

async function main() {
  // A方式：raw を読む
  RAW_SUMMARY = await fetchJson("./data/raw/summary.json");
  RAW_ROWS = await fetchJson("./data/raw/rows.json");

  // symbol_master は無くても動く
  try {
    RAW_MASTER = await fetchJson("./data/master/symbol_master.json");
  } catch (e) {
    console.warn("symbol_master.json not found (optional).", e);
    RAW_MASTER = null;
  }

  // 初期：セレクトと axisKey を同期（HTMLに #mode_claw があるならその値優先）
  const sel = document.querySelector("#mode_claw");
  if (sel && sel.value) {
    clawMode = sel.value;
  }
  axisKey = (clawMode === "2本爪") ? "2本爪" : "3本爪";

  // 初期：軸の全値を全選択
  const byAxis = getAggForCurrentAxis();
  selected = new Set(byAxis.map(r => r.axis ?? "(未設定)"));

  renderSymbolChips();
  wireEvents();
  render();

  // ★追加：③ 構成KPI をマウント（投入法フィルタ後の rows を渡す）
  const compMount = document.querySelector("#composition");
  if (compMount && window.CompositionKPI) {
    window.__comp = window.CompositionKPI.mount({
      mountEl: compMount,
      getRows: () => getRowsForClawMode()
    });
  }
}

function wireEvents() {
  // 全選択
  document.querySelector("#btn_all")?.addEventListener("click", () => {
    selected = new Set(visibleAxisValuesByQuery());
    render();
    syncChipsChecked();
  });

  // 全解除
  document.querySelector("#btn_none")?.addEventListener("click", () => {
    selected = new Set();
    render();
    syncChipsChecked();
  });

  // 検索（チップだけ再描画）
  document.querySelector("#q")?.addEventListener("input", () => {
    renderSymbolChips();
  });

  // 投入法セレクト：3本爪/2本爪 切替（ここが今回の肝）
  document.querySelector("#mode_claw")?.addEventListener("change", (e) => {
    clawMode = e.target.value; // "3本爪" / "2本爪"
    axisKey = (clawMode === "2本爪") ? "2本爪" : "3本爪";

    // 対象データが変わるので「全選択」に作り直し
    const byAxis = getAggForCurrentAxis();
    selected = new Set(byAxis.map(r => r.axis ?? "(未設定)"));

    // 検索欄は維持（必要ならここでクリアしてもOK）
    renderSymbolChips();
    render();

    // ★追加：③も更新
    window.__comp?.refresh?.();
  });

  // ソート（thクリック）
  document.querySelectorAll("#tbl thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) {
        sortDir = (sortDir === "desc") ? "asc" : "desc";
      } else {
        sortKey = key;
        // 文字列の列は asc 初期、数値列は desc 初期
        sortDir = (key === "symbol") ? "asc" : "desc";
      }
      render();
    });
  });
}

/**
 * rows.json の値が「記号」だった場合に、マスタ辞書で「意味」に寄せる
 * 例：RAW_MASTER["投入法"]["2"] = "2本爪" など
 */
function normalizeByMaster(category, v) {
  if (v == null) return "";
  const raw = String(v).trim();
  if (!RAW_MASTER) return raw;
  const dict = RAW_MASTER[category];
  if (!dict) return raw;
  return dict[raw] ?? raw;
}

/**
 * 投入法（3本爪/2本爪）で rows を絞る
 * rows の列名は「投入法」を想定
 */
function getRowsForClawMode() {
  return RAW_ROWS.filter(r => {
    // まず rows の値を「意味」に寄せる（記号でも日本語でもOK）
    const pm = normalizeByMaster("投入法", r?.["投入法"]);
    return pm === clawMode;
  });
}

/**
 * 今の状態（clawMode/axisKey）で “軸別集計” を返す
 */
function getAggForCurrentAxis() {
  const rows = getRowsForClawMode();
  return buildAggByAxis(axisKey, rows);
}

/**
 * チップ描画：軸の値をチップ化する
 */
function renderSymbolChips() {
  const box = document.querySelector("#symbol_box");
  if (!box) return;
  box.innerHTML = "";

  const q = (document.querySelector("#q")?.value || "").trim().toLowerCase();

  const byAxis = getAggForCurrentAxis();

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
  const byAxis = getAggForCurrentAxis();
  return byAxis
    .map(r => (r.axis ?? "(未設定)"))
    .filter(v => !q || String(v).toLowerCase().includes(q));
}

/**
 * 「意味」列を出したい場合の変換
 * - 今回の軸は axisKey = "3本爪" or "2本爪"
 * - RAW_MASTER[axisKey][コード] = 意味 の形なら変換できる
 * - axis値がすでに日本語（意味）なら、変換できなくても空でOK
 */
function getMeaningByAxisValue(axisKey, v) {
  if (!RAW_MASTER) return "";
  const dict = RAW_MASTER[axisKey] || {};
  // v がコードなら意味が出る。v が意味そのものならヒットしない→空
  return dict[String(v).trim()] ?? "";
}

/**
 * 原価率の色（あなた指定）
 * - 0%: 青
 * - 32%以上: 赤
 * - 25〜31%: 白グラデーション
 * rate は 0.308 のような割合
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
 * rows → 軸別集計を作る
 * 出力：{ axis, sales, claw, cost_rate, count }
 *
 * count は「行数」=「ブースID=マシン数」(あなた指定)
 *
 * rows.json の想定カラム：
 *  - r.sales
 *  - r.claw
 *  - r[axisKey]（今回：r["3本爪"] または r["2本爪"]）
 *
 * ★もし rows.json 側のキーが別名なら、ここだけ合わせればOK
 */
function buildAggByAxis(axisKey, rows) {
  const map = new Map();

  for (const r of rows) {
    const axisVal = (r?.[axisKey] ?? "").toString().trim() || "(未設定)";

    const cur = map.get(axisVal) || { axis: axisVal, sales: 0, claw: 0, count: 0 };
    cur.sales += num(r.sales);
    cur.claw += num(r.claw);
    cur.count += 1;
    map.set(axisVal, cur);
  }

  return Array.from(map.values()).map(o => {
    const cost_rate = o.sales ? (o.claw * 1.1) / o.sales : null;
    return { ...o, cost_rate };
  });
}

function render() {
  // 更新日時
  const updated = document.querySelector("#updated");
  if (updated && RAW_SUMMARY?.updated_at) {
    updated.textContent = "更新: " + new Date(RAW_SUMMARY.updated_at).toLocaleString("ja-JP");
  }

  // 軸別集計（投入法で絞った上で）
  const byAxis = getAggForCurrentAxis();

  // チップ選択でフィルタ
  const filteredAgg = byAxis.filter(r => selected.has(r.axis ?? "(未設定)"));

  // KPI（フィルタ後合計）
  const totalSales = filteredAgg.reduce((a, r) => a + num(r.sales), 0);
  const totalClaw  = filteredAgg.reduce((a, r) => a + num(r.claw), 0);
  const costRate   = totalSales ? (totalClaw * 1.1) / totalSales : null;

  const kSales = document.querySelector("#k_sales");
  const kClaw  = document.querySelector("#k_claw");
  const kRate  = document.querySelector("#k_rate");
  const kFilt  = document.querySelector("#k_filtered");

  if (kSales) kSales.textContent = fmtYen(totalSales);
  if (kClaw)  kClaw.textContent  = fmtYen(totalClaw);

  if (kRate) {
    kRate.textContent = fmtPct(costRate);
    kRate.setAttribute("style", rateStyleBySpec(costRate));
  }

  if (kFilt) {
    // 例：選択中: 2/3 3本爪（3本爪の内訳カテゴリ数）
    kFilt.textContent = `選択中: ${selected.size}/${byAxis.length} ${axisKey}（投入法=${clawMode}）`;
  }

  // ソート
  const sorted = filteredAgg.slice().sort((a, b) => cmpAgg(a, b, sortKey, sortDir));

  // テーブル描画
  const tb = document.querySelector("#tbl tbody");
  if (tb) tb.innerHTML = "";

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
    tb?.appendChild(tr);
  });

  syncChipsChecked();
}

function cmpAgg(a, b, key, dir) {
  const s = (dir === "desc") ? -1 : 1;

  // th[data-sort="symbol"] を「軸の文字列」に読み替え
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

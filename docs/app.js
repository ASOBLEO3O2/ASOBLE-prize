/******************************************************
 * app.js（MVP：実データ一覧 + KPI）
 * 入口は維持：
 *  - ./data/raw/rows.json
 *  - ./data/raw/summary.json
 *
 * 仕様（確定）
 *  - 投入法：全体 / 3本爪 / 2本爪（デフォルト=全体）
 *  - 実データ：フィルタ後のみ、売上降順
 *  - 表示列：
 *    マシン名, 景品名, 総売り上げ, 消化数, 消化額, 原価率, 更新日（※日付のみ）
 *  - KPI：
 *    売上合計, 消化額合計, 原価率, 平均（1台あたり売上）, 台数（machine_keyユニーク）
 *
 * ★追加：ジャンル2段フィルタ
 *  - 景品ジャンル（食品/ぬいぐるみ/雑貨）
 *  - 子ジャンル（景品ジャンルに応じて食品ジャンル/ぬいぐるみジャンル/雑貨ジャンル）
 ******************************************************/

const fmtYen = (n) => (n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円");
const fmtNum = (n) => (n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)));
const fmtPct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");

let RAW_SUMMARY = null;
let RAW_ROWS = [];

let clawMode = "all"; // "all" | "3本爪" | "2本爪"

// ★ジャンル2段
let prizeGenre = "";              // 景品ジャンル（食品/ぬいぐるみ/雑貨）
let subGenreSelected = new Set(); // 子ジャンルの複数選択（OR）

async function main() {
  RAW_SUMMARY = await fetchJson("./data/raw/summary.json");
  RAW_ROWS = await fetchJson("./data/raw/rows.json");

  const sel = document.querySelector("#mode_claw");
  if (sel && sel.value) clawMode = sel.value;

  wireEvents();
  render();
}

function wireEvents() {
  document.querySelector("#mode_claw")?.addEventListener("change", (e) => {
    clawMode = e.target.value || "all";
    render();
  });

  document.querySelector("#q")?.addEventListener("input", () => {
    render();
  });

  // ジャンル解除
  document.querySelector("#genre_clear")?.addEventListener("click", () => {
    prizeGenre = "";
    subGenreSelected = new Set();
    render();
  });
}

/** rows.json の列名ゆらぎ吸収 */
function pick(r, keys) {
  for (const k of keys) {
    if (r != null && r[k] != null && String(r[k]).trim() !== "") return r[k];
  }
  return null;
}

function normalizeStr(v) {
  return String(v ?? "").trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  const s2 = s.replace(/\//g, "-");
  const d2 = new Date(s2);
  return isNaN(d2.getTime()) ? null : d2;
}

/** 日付のみ（YYYY/MM/DD） */
function fmtDateOnly(v) {
  const raw = normalizeStr(v);
  if (!raw || raw === "#N/A" || raw === "N/A" || raw === "#REF!") return "-";

  const m = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, "0");
    const da = String(m[3]).padStart(2, "0");
    return `${y}/${mo}/${da}`;
  }

  const d = v instanceof Date ? v : parseDate(raw);
  if (!d) return raw || "-";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${da}`;
}

/** 原価率の見た目（既存仕様） */
function rateBadgeStyle(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) {
    return "background:rgba(255,255,255,.06); color:#e8eef6;";
  }
  const pct = rate * 100;
  if (pct >= 32) return "background:#d93025; color:#fff; border-color:rgba(255,255,255,.18);";
  if (pct <= 0) return "background:#1a73e8; color:#fff; border-color:rgba(255,255,255,.18);";
  if (pct >= 25 && pct <= 31) return "background:rgba(255,255,255,.75); color:#111; border-color:rgba(0,0,0,.08);";
  if (pct < 25) return "background:rgba(26,115,232,.20); color:#e8eef6;";
  return "background:rgba(217,48,37,.18); color:#e8eef6;";
}

/**
 * 投入法フィルタ
 */
function filterByClawMode(rows) {
  if (clawMode === "all") return rows;

  return rows.filter((r) => {
    const pm = normalizeStr(pick(r, ["投入法", "claw_mode", "mode_claw"]));
    return pm === clawMode;
  });
}

/**
 * 検索（景品名/マシン名）
 */
function filterByQuery(rows) {
  const q = normalizeStr(document.querySelector("#q")?.value).toLowerCase();
  if (!q) return rows;

  return rows.filter((r) => {
    const machine = normalizeStr(
      pick(r, ["machine_name", "マシン名（ブースID）", "マシン名", "ブースID", "booth_id", "machine"])
    ).toLowerCase();

    const item = normalizeStr(
      pick(r, ["景品名", "最終景品", "最終景品名", "item_name", "prize_name"])
    ).toLowerCase();

    return machine.includes(q) || item.includes(q);
  });
}

/**
 * ジャンル2段フィルタ
 * - 1段目：景品ジャンル（食品/ぬいぐるみ/雑貨）
 * - 2段目：選ばれた景品ジャンルに応じた子ジャンル（複数選択OR）
 */
function filterByGenre(rows) {
  let out = rows;

  if (prizeGenre) {
    out = out.filter((r) => normalizeStr(pick(r, ["景品ジャンル"])) === prizeGenre);
  }

  // 子ジャンル：選択がある場合のみ適用
  if (prizeGenre && subGenreSelected.size > 0) {
    const subKey =
      prizeGenre === "食品" ? "食品ジャンル"
      : prizeGenre === "ぬいぐるみ" ? "ぬいぐるみジャンル"
      : prizeGenre === "雑貨" ? "雑貨ジャンル"
      : "";

    if (subKey) {
      out = out.filter((r) => {
        const v = normalizeStr(pick(r, [subKey]));
        return subGenreSelected.has(v);
      });
    }
  }

  return out;
}

/**
 * rows から表示に必要な形へ正規化（raw保持）
 */
function normalizeRow(r) {
  const machine = pick(r, ["machine_name", "マシン名（ブースID）", "マシン名", "ブースID", "booth_id", "machine"]);
  const machineKey = pick(r, ["machine_key", "対応マシン名", "対応マシン", "machine_ref"]);

  const item = pick(r, ["景品名", "最終景品", "最終景品名", "item_name", "prize_name"]);
  const sales = pick(r, ["総売り上げ", "総売上", "総売上げ", "売上", "sales"]);
  const cnt = pick(r, ["consume_count", "消化数", "消化回数", "count", "plays"]);
  const claw = pick(r, ["消化額", "claw"]);
  const rateRaw = pick(r, ["原価率", "cost_rate"]);

  const updatedDate = pick(r, ["updated_date", "更新日", "updatedDate"]);
  const updatedAt = pick(r, ["updated_at", "更新日時", "updated"]);

  const salesN = num(sales);
  const clawN = num(claw);

  const rateN =
    rateRaw != null && rateRaw !== "" ? Number(rateRaw) : salesN ? (clawN * 1.1) / salesN : null;

  return {
    machine: normalizeStr(machine) || "-",
    machine_key: normalizeStr(machineKey) || "",

    item: normalizeStr(item) || "-",
    sales: salesN,
    count: num(cnt),
    claw: clawN,
    cost_rate: Number.isFinite(rateN) ? rateN : null,

    updated_date: updatedDate ?? updatedAt ?? "",

    // ジャンル（UI生成用）
    prize_genre: normalizeStr(pick(r, ["景品ジャンル"])) || "",
    food_genre: normalizeStr(pick(r, ["食品ジャンル"])) || "",
    nui_genre: normalizeStr(pick(r, ["ぬいぐるみジャンル"])) || "",
    goods_genre: normalizeStr(pick(r, ["雑貨ジャンル"])) || "",

    _raw: r,
  };
}

/** チップ描画（共通） */
function renderChips(rootId, values, selectedSetOrValue, onToggle) {
  const root = document.querySelector(rootId);
  if (!root) return;
  root.innerHTML = "";

  for (const v of values) {
    const btn = document.createElement("button");
    btn.type = "button";

    const isOn =
      selectedSetOrValue instanceof Set ? selectedSetOrValue.has(v) : selectedSetOrValue === v;

    btn.className = "chip" + (isOn ? " on" : "");
    btn.textContent = v;

    btn.addEventListener("click", () => onToggle(v));
    root.appendChild(btn);
  }
}

/** 候補値作成 */
function uniqueSorted(values) {
  const s = new Set(values.map((x) => normalizeStr(x)).filter((x) => x));
  return Array.from(s).sort((a, b) => a.localeCompare(b, "ja"));
}

function render() {
  // 更新表示（summary優先、日付のみ）
  const updatedEl = document.querySelector("#updated");
  if (updatedEl) {
    const su = RAW_SUMMARY?.updated_at ?? RAW_SUMMARY?.updated ?? RAW_SUMMARY?.updatedAt;
    updatedEl.textContent = "更新: " + (su ? fmtDateOnly(su) : "-");
  }

  // フィルタ適用（RAW段階）
  let rows = RAW_ROWS.slice();
  rows = filterByClawMode(rows);
  rows = filterByQuery(rows);

  // 正規化（UI候補生成用）
  const normAll = rows.map(normalizeRow);

  // ===== ジャンルUI（候補生成） =====
  // 景品ジャンル候補：データからユニーク抽出（食品/ぬいぐるみ/雑貨 以外があっても拾う）
  const prizeGenreValues = uniqueSorted(normAll.map((r) => r.prize_genre));

  // 1段目：景品ジャンルチップ
  renderChips("#chips_genre", prizeGenreValues, prizeGenre, (v) => {
    // 切替時は子ジャンルリセット
    if (prizeGenre === v) {
      prizeGenre = "";
      subGenreSelected = new Set();
    } else {
      prizeGenre = v;
      subGenreSelected = new Set();
    }
    render();
  });

  // 2段目：子ジャンル候補（景品ジャンルに応じて出し分け）
  let subValues = [];
  if (prizeGenre === "食品") subValues = uniqueSorted(normAll.filter(r => r.prize_genre==="食品").map((r) => r.food_genre));
  else if (prizeGenre === "ぬいぐるみ") subValues = uniqueSorted(normAll.filter(r => r.prize_genre==="ぬいぐるみ").map((r) => r.nui_genre));
  else if (prizeGenre === "雑貨") subValues = uniqueSorted(normAll.filter(r => r.prize_genre==="雑貨").map((r) => r.goods_genre));
  else subValues = [];

  renderChips("#chips_subgenre", subValues, subGenreSelected, (v) => {
    if (subGenreSelected.has(v)) subGenreSelected.delete(v);
    else subGenreSelected.add(v);
    render();
  });

  // ===== ジャンルフィルタ適用 =====
  rows = filterByGenre(rows);

  // フィルタ後の正規化
  const norm = rows.map(normalizeRow);

  // 売上降順
  norm.sort((a, b) => b.sales - a.sales);

  // KPI（machine_keyユニーク）
  const uniqueMachineKeys = new Set(
    norm
      .map((r) => normalizeStr(r.machine_key))
      .filter((v) => v !== "" && v !== "-" && v !== "#N/A" && v !== "N/A")
  );
  const machines = uniqueMachineKeys.size;

  const totalSales = norm.reduce((a, r) => a + num(r.sales), 0);
  const totalClaw = norm.reduce((a, r) => a + num(r.claw), 0);
  const costRate = totalSales ? (totalClaw * 1.1) / totalSales : null;
  const avgSales = machines ? totalSales / machines : null;

  const kSales = document.querySelector("#k_sales");
  const kClaw = document.querySelector("#k_claw");
  const kRate = document.querySelector("#k_rate");
  const kAvg = document.querySelector("#k_avg");
  const kMac = document.querySelector("#k_machines");
  const kFilt = document.querySelector("#k_filtered");

  if (kSales) kSales.textContent = fmtYen(totalSales);
  if (kClaw) kClaw.textContent = fmtYen(totalClaw);
  if (kRate) kRate.textContent = fmtPct(costRate);
  if (kAvg) kAvg.textContent = avgSales == null ? "-" : fmtYen(avgSales);
  if (kMac) kMac.textContent = `台数: ${fmtNum(machines)}`;

  if (kFilt) {
    const modeLabel = clawMode === "all" ? "全体" : clawMode;
    const q = normalizeStr(document.querySelector("#q")?.value);
    const g = prizeGenre ? ` / 景品ジャンル:${prizeGenre}` : "";
    const sg = (subGenreSelected.size > 0) ? ` / 子:${Array.from(subGenreSelected).join(",")}` : "";
    kFilt.textContent = `対象: ${fmtNum(machines)}台 / 投入法: ${modeLabel}${q ? ` / 検索: "${q}"` : ""}${g}${sg}`;
  }

  // テーブル描画
  const tb = document.querySelector("#tbl tbody");
  if (!tb) return;
  tb.innerHTML = "";

  for (const r of norm) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.machine)}</td>
      <td>${escapeHtml(r.item)}</td>
      <td class="num">${fmtYen(r.sales)}</td>
      <td class="num">${fmtNum(r.count)}</td>
      <td class="num">${fmtYen(r.claw)}</td>
      <td class="num">
        <span class="badgeRate" style="${rateBadgeStyle(r.cost_rate)}">${fmtPct(r.cost_rate)}</span>
      </td>
      <td>${escapeHtml(fmtDateOnly(r.updated_date))}</td>
    `;
    tb.appendChild(tr);
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.json();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

main().catch((e) => {
  console.error(e);
  alert("読み込み失敗: " + e.message);
});

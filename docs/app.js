/******************************************************
 * app.js（MVP：実データ一覧 + KPI）
 * 入口は維持：
 *  - ./data/raw/rows.json（ブースID=行＝マシン）
 *  - ./data/raw/summary.json
 *
 * 仕様（確定）
 *  - 投入法は「フィルタの1種」：全体 / 3本爪 / 2本爪（デフォルト=全体）
 *  - 下段は「フィルタ後の実データのみ」表示、売上降順
 *  - 表示列：
 *    マシン名（ブースID）, 景品名, 総売り上げ, 消化数, 消化額, 原価率, 更新日時
 *  - KPI：
 *    売上合計, 消化額合計, 原価率, 平均（1台あたり売上）, 台数
 ******************************************************/

const fmtYen = (n) => n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
const fmtNum = (n) => n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n));
const fmtPct = (v) => v == null ? "-" : (v * 100).toFixed(1) + "%";

let RAW_SUMMARY = null;
let RAW_ROWS = [];

let clawMode = "all"; // "all" | "3本爪" | "2本爪"

async function main() {
  RAW_SUMMARY = await fetchJson("./data/raw/summary.json");
  RAW_ROWS = await fetchJson("./data/raw/rows.json");

  // UI初期
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

  // "YYYY/MM/DD HH:mm:ss" などを想定（Dateが解釈できない場合は軽く置換）
  const s2 = s.replace(/\//g, "-");
  const d2 = new Date(s2);
  return isNaN(d2.getTime()) ? null : d2;
}

function fmtDate(v) {
  const raw = normalizeStr(v);

  // Google Sheets のエラーが混ざるケース吸収
  if (!raw || raw === "#N/A" || raw === "N/A" || raw === "#REF!") return "-";

  const d = v instanceof Date ? v : parseDate(raw);
  if (!d) return raw || "-";
  return d.toLocaleString("ja-JP");
}

/** 原価率の見た目（あなたの既存仕様に寄せた簡易版） */
function rateBadgeStyle(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) {
    return "background:rgba(255,255,255,.06); color:#e8eef6;";
  }
  const pct = rate * 100;

  // 32%以上：赤
  if (pct >= 32) return "background:#d93025; color:#fff; border-color:rgba(255,255,255,.18);";
  // 0%付近：青
  if (pct <= 0) return "background:#1a73e8; color:#fff; border-color:rgba(255,255,255,.18);";
  // 25〜31%：白寄り
  if (pct >= 25 && pct <= 31) return "background:rgba(255,255,255,.75); color:#111; border-color:rgba(0,0,0,.08);";
  // それ以外：薄色
  if (pct < 25) return "background:rgba(26,115,232,.20); color:#e8eef6;";
  return "background:rgba(217,48,37,.18); color:#e8eef6;";
}

/**
 * 投入法フィルタ
 * - rows 側に「投入法」列がある前提（記号から導出する段階は次フェーズ）
 * - 値の揺れは軽く吸収
 */
function filterByClawMode(rows) {
  if (clawMode === "all") return rows;

  return rows.filter(r => {
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

  return rows.filter(r => {
    const machine = normalizeStr(
      pick(r, ["マシン名（ブースID）", "マシン名", "ブースID", "machine", "machine_name", "booth_id"])
    ).toLowerCase();
    const item = normalizeStr(
      pick(r, ["景品名", "最終景品", "最終景品名", "item_name", "prize_name"])
    ).toLowerCase();
    return machine.includes(q) || item.includes(q);
  });
}

/**
 * rows から表示に必要な形へ正規化
 */
function normalizeRow(r) {
  const machine = pick(r, ["マシン名（ブースID）", "マシン名", "ブースID", "machine", "machine_name", "booth_id"]);
  const item    = pick(r, ["景品名", "最終景品", "最終景品名", "item_name", "prize_name"]);

  const sales   = pick(r, ["総売り上げ", "総売上", "総売上げ", "売上", "sales"]);

  // ★ここが今回の肝：rows.json は consume_count
  const cnt     = pick(r, ["consume_count", "消化数", "消化回数", "count", "plays"]);

  const claw    = pick(r, ["消化額", "claw"]);
  const rateRaw = pick(r, ["原価率", "cost_rate"]);

  // ★rows.json は updated_at
  const updated = pick(r, ["updated_at", "更新日時", "updated"]);

  const salesN = num(sales);
  const clawN  = num(claw);

  // 原価率は列があればそれを優先。無ければ計算で補完（消化額×1.1/売上）
  const rateN = (rateRaw != null && rateRaw !== "") ? Number(rateRaw) : (salesN ? (clawN * 1.1) / salesN : null);

  return {
    machine: normalizeStr(machine) || "-",
    item: normalizeStr(item) || "-",
    sales: salesN,
    count: num(cnt),
    claw: clawN,
    cost_rate: (Number.isFinite(rateN) ? rateN : null),
    updated_at: updated,
  };
}

function render() {
  // 更新日時（summary優先）
  const updatedEl = document.querySelector("#updated");
  if (updatedEl) {
    const su = RAW_SUMMARY?.updated_at ?? RAW_SUMMARY?.updated ?? RAW_SUMMARY?.updatedAt;
    updatedEl.textContent = "更新: " + (su ? fmtDate(su) : "-");
  }

  // フィルタ適用
  let rows = RAW_ROWS.slice();
  rows = filterByClawMode(rows);
  rows = filterByQuery(rows);

  // 正規化
  const norm = rows.map(normalizeRow);

  // 売上降順（確定）
  norm.sort((a, b) => (b.sales - a.sales));

  // KPI（フィルタ後母数）
  const machines = norm.length;
  const totalSales = norm.reduce((a, r) => a + num(r.sales), 0);
  const totalClaw  = norm.reduce((a, r) => a + num(r.claw), 0);
  const costRate   = totalSales ? (totalClaw * 1.1) / totalSales : null;
  const avgSales   = machines ? (totalSales / machines) : null;

  const kSales = document.querySelector("#k_sales");
  const kClaw  = document.querySelector("#k_claw");
  const kRate  = document.querySelector("#k_rate");
  const kAvg   = document.querySelector("#k_avg");
  const kMac   = document.querySelector("#k_machines");
  const kFilt  = document.querySelector("#k_filtered");

  if (kSales) kSales.textContent = fmtYen(totalSales);
  if (kClaw)  kClaw.textContent  = fmtYen(totalClaw);

  if (kRate) {
    kRate.textContent = fmtPct(costRate);
    // 既存の色分けを badge に寄せるため、ここは素の表示（CSSでカードのまま）
  }

  if (kAvg) kAvg.textContent = avgSales == null ? "-" : fmtYen(avgSales);
  if (kMac) kMac.textContent = `台数: ${fmtNum(machines)}`;

  if (kFilt) {
    const modeLabel = (clawMode === "all") ? "全体" : clawMode;
    const q = normalizeStr(document.querySelector("#q")?.value);
    kFilt.textContent = `対象: ${fmtNum(machines)}台 / 投入法: ${modeLabel}${q ? ` / 検索: "${q}"` : ""}`;
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
      <td>${escapeHtml(fmtDate(r.updated_at))}</td>
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
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

main().catch(e => {
  console.error(e);
  alert("読み込み失敗: " + e.message);
});

/******************************************************
 * app.js（MVP：実データ一覧 + KPI）
 * 入口は維持：
 *  - ./data/raw/rows.json
 *  - ./data/raw/summary.json
 *
 * 仕様（確定）
 *  - 投入法は「フィルタの1種」：全体 / 3本爪 / 2本爪（デフォルト=全体）
 *  - 下段は「フィルタ後の実データのみ」表示、売上降順
 *  - 表示列：
 *    マシン名, 景品名, 総売り上げ, 消化数, 消化額, 原価率, 更新日（※日付のみ）
 *  - KPI：
 *    売上合計, 消化額合計, 原価率, 平均（1台あたり売上）, 台数
 *
 * ★今回の修正点
 *  - 表示マシン名：rows.json の machine_name を優先（01/左など含む）
 *  - 台数/平均の「台数」は rows.json の machine_key（H列=対応マシン名）をユニーク集計
 *  - 更新日時：rows.json の updated_date を優先（YYYY/MM/DD）。無ければ旧 updated_at
 ******************************************************/

const fmtYen = (n) => (n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円");
const fmtNum = (n) => (n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)));
const fmtPct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");

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

  const s2 = s.replace(/\//g, "-");
  const d2 = new Date(s2);
  return isNaN(d2.getTime()) ? null : d2;
}

/**
 * 日付のみ表示（YYYY/MM/DD）
 * - updated_date が既に "YYYY/MM/DD" ならそのまま返す
 * - updated_at 等の日時文字列なら Date で解釈して日付だけに整形
 */
function fmtDateOnly(v) {
  const raw = normalizeStr(v);

  if (!raw || raw === "#N/A" || raw === "N/A" || raw === "#REF!") return "-";

  // 既に YYYY/MM/DD ぽいならそのまま（時間なし想定）
  const m = raw.match(/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/);
  if (m) {
    // 表記を YYYY/MM/DD に揃える
    const mm = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (mm) {
      const y = mm[1];
      const mo = String(mm[2]).padStart(2, "0");
      const da = String(mm[3]).padStart(2, "0");
      return `${y}/${mo}/${da}`;
    }
    return raw.replace(/-/g, "/");
  }

  // "YYYY/MM/DD HH:mm:ss" 等を Date で解釈して日付だけ
  const d = v instanceof Date ? v : parseDate(raw);
  if (!d) return raw || "-";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${da}`;
}

/** 原価率の見た目（あなたの既存仕様に寄せた簡易版） */
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
 * - rows 側に「投入法」列がある前提
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
    // 表示名は machine_name 優先。無い場合は booth_id 等へフォールバック
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
 * rows から表示に必要な形へ正規化
 * - machine: 表示用（machine_name）
 * - machine_key: 集計用キー（H列=対応マシン名）
 * - updated_date: 日付のみ（updated_date 優先）
 */
function normalizeRow(r) {
  // 表示用マシン名（01/左など含む）
  const machine = pick(r, ["machine_name", "マシン名（ブースID）", "マシン名", "ブースID", "booth_id", "machine"]);

  // 集計キー（H列：対応マシン名）
  const machineKey = pick(r, ["machine_key", "対応マシン名", "対応マシン", "machine_ref"]);

  const item = pick(r, ["景品名", "最終景品", "最終景品名", "item_name", "prize_name"]);

  const sales = pick(r, ["総売り上げ", "総売上", "総売上げ", "売上", "sales"]);
  const cnt = pick(r, ["consume_count", "消化数", "消化回数", "count", "plays"]);
  const claw = pick(r, ["消化額", "claw"]);
  const rateRaw = pick(r, ["原価率", "cost_rate"]);

  // ★更新日時：新 = updated_date（日付のみ）を優先。無ければ旧 updated_at
  const updatedDate = pick(r, ["updated_date", "更新日", "updatedDate"]);
  const updatedAt = pick(r, ["updated_at", "更新日時", "updated"]);

  const salesN = num(sales);
  const clawN = num(claw);

  // 原価率は列があればそれを優先。無ければ計算で補完（消化額×1.1/売上）
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

    // 表示は日付のみ
    updated_date: updatedDate ?? updatedAt ?? "",
  };
}

function render() {
  // 更新表示（summary優先）※ここは「更新:」のままでもOK。日付だけに寄せるなら fmtDateOnly にする
  const updatedEl = document.querySelector("#updated");
  if (updatedEl) {
    const su = RAW_SUMMARY?.updated_at ?? RAW_SUMMARY?.updated ?? RAW_SUMMARY?.updatedAt;
    updatedEl.textContent = "更新: " + (su ? fmtDateOnly(su) : "-");
  }

  // フィルタ適用
  let rows = RAW_ROWS.slice();
  rows = filterByClawMode(rows);
  rows = filterByQuery(rows);

  // 正規化
  const norm = rows.map(normalizeRow);

  // 売上降順（確定）
  norm.sort((a, b) => b.sales - a.sales);

  // KPI（フィルタ後母数）
  // ★台数は machine_key（対応マシン名）のユニーク数
  const uniqueMachineKeys = new Set(
    norm
      .map((r) => normalizeStr(r.machine_key))
      .filter((v) => v !== "" && v !== "-" && v !== "#N/A" && v !== "N/A")
  );
  const machines = uniqueMachineKeys.size;

  const totalSales = norm.reduce((a, r) => a + num(r.sales), 0);
  const totalClaw = norm.reduce((a, r) => a + num(r.claw), 0);
  const costRate = totalSales ? (totalClaw * 1.1) / totalSales : null;

  // ★平均は「1台あたり（machine_key単位）」＝ totalSales / ユニーク台数
  const avgSales = machines ? totalSales / machines : null;

  const kSales = document.querySelector("#k_sales");
  const kClaw = document.querySelector("#k_claw");
  const kRate = document.querySelector("#k_rate");
  const kAvg = document.querySelector("#k_avg");
  const kMac = document.querySelector("#k_machines");
  const kFilt = document.querySelector("#k_filtered");

  if (kSales) kSales.textContent = fmtYen(totalSales);
  if (kClaw) kClaw.textContent = fmtYen(totalClaw);

  if (kRate) {
    kRate.textContent = fmtPct(costRate);
  }

  if (kAvg) kAvg.textContent = avgSales == null ? "-" : fmtYen(avgSales);
  if (kMac) kMac.textContent = `台数: ${fmtNum(machines)}`;

  if (kFilt) {
    const modeLabel = clawMode === "all" ? "全体" : clawMode;
    const q = normalizeStr(document.querySelector("#q")?.value);
    // 行数も併記したいなら追加で出せる（例: `${fmtNum(norm.length)}行`）
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

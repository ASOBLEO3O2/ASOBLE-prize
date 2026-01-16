/******************************************************
 * app.js（MVP：実データ一覧 + KPI + フィルタ）
 *
 * 入口：
 *  - ./data/raw/rows.json
 *  - ./data/raw/summary.json
 *
 * 仕様（維持）
 *  - 表示マシン名：machine_name（01/左など含む）
 *  - 台数：machine_key（対応マシン名）ユニーク
 *  - 更新日：日付のみ（updated_date 優先、なければ updated_at）
 *  - 売上降順
 *
 * フィルタ（左縦積み）
 *  - マシン（machine_key）複数選択（OR）
 *  - 投入法（全体/3本爪/2本爪）
 *  - ジャンル2段：景品ジャンル → (食品/ぬい/雑貨ジャンル) 複数選択（OR）
 *  - 性別（ターゲット）複数選択（OR）
 *  - 年代 複数選択（OR）
 *  - 検索（景品名/マシン名）部分一致
 *
 * 追加表示
 *  - ジャンル別サマリ（景品ジャンル単位の売上/消化/原価率/台数）
 ******************************************************/

const fmtYen = (n) => (n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円");
const fmtNum = (n) => (n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)));
const fmtPct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");

let RAW_SUMMARY = null;
let RAW_ROWS = [];

// 投入法
let clawMode = "all"; // "all" | "3本爪" | "2本爪"

// マシン（対応マシン名＝machine_key）
let machineSelected = new Set();
let machineQuery = "";

// ジャンル2段
let prizeGenre = "";              // 景品ジャンル（食品/ぬいぐるみ/雑貨）
let subGenreSelected = new Set(); // 子ジャンル 複数

// 性別（ターゲット）
let targetSelected = new Set();

// 年代
let ageSelected = new Set();

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

  document.querySelector("#q_machine")?.addEventListener("input", (e) => {
    machineQuery = (e.target.value || "").toString();
    render();
  });

  document.querySelector("#machine_clear")?.addEventListener("click", () => {
    machineSelected = new Set();
    machineQuery = "";
    const qm = document.querySelector("#q_machine");
    if (qm) qm.value = "";
    render();
  });

  document.querySelector("#genre_clear")?.addEventListener("click", () => {
    prizeGenre = "";
    subGenreSelected = new Set();
    render();
  });

  document.querySelector("#target_clear")?.addEventListener("click", () => {
    targetSelected = new Set();
    render();
  });

  document.querySelector("#age_clear")?.addEventListener("click", () => {
    ageSelected = new Set();
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

  const d = v instanceof Date ? v : (parseDate(raw) ?? null);
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

/** フィルタ：投入法 */
function filterByClawMode(rows) {
  if (clawMode === "all") return rows;
  return rows.filter((r) => {
    const pm = normalizeStr(pick(r, ["投入法", "claw_mode", "mode_claw"]));
    return pm === clawMode;
  });
}

/** フィルタ：検索（景品名/マシン名） */
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

/** フィルタ：マシン（machine_key複数選択 OR） */
function filterByMachine(rows) {
  if (!machineSelected || machineSelected.size === 0) return rows;
  return rows.filter((r) => {
    const mk = normalizeStr(pick(r, ["machine_key", "対応マシン名", "対応マシン", "machine_ref"]));
    return machineSelected.has(mk);
  });
}

/** フィルタ：ジャンル2段 */
function filterByGenre(rows) {
  let out = rows;
  if (prizeGenre) {
    out = out.filter((r) => normalizeStr(pick(r, ["景品ジャンル"])) === prizeGenre);
  }

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

/** フィルタ：ターゲット（性別） */
function filterByTarget(rows) {
  if (!targetSelected || targetSelected.size === 0) return rows;
  return rows.filter((r) => targetSelected.has(normalizeStr(pick(r, ["ターゲット"]))));
}

/** フィルタ：年代 */
function filterByAge(rows) {
  if (!ageSelected || ageSelected.size === 0) return rows;
  return rows.filter((r) => ageSelected.has(normalizeStr(pick(r, ["年代"]))));
}

/** 正規化（表示・集計に必要な形） */
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

    prize_genre: normalizeStr(pick(r, ["景品ジャンル"])) || "",
    food_genre: normalizeStr(pick(r, ["食品ジャンル"])) || "",
    nui_genre: normalizeStr(pick(r, ["ぬいぐるみジャンル"])) || "",
    goods_genre: normalizeStr(pick(r, ["雑貨ジャンル"])) || "",
    target: normalizeStr(pick(r, ["ターゲット"])) || "",
    age: normalizeStr(pick(r, ["年代"])) || "",
  };
}

/** 共通：候補値作成 */
function uniqueSorted(values) {
  const s = new Set(values.map((x) => normalizeStr(x)).filter((x) => x));
  return Array.from(s).sort((a, b) => a.localeCompare(b, "ja"));
}

/** チップ描画（単一選択） */
function renderChipsSingle(rootId, values, selectedValue, onClick) {
  const root = document.querySelector(rootId);
  if (!root) return;
  root.innerHTML = "";

  for (const v of values) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (selectedValue === v ? " on" : "");
    btn.textContent = v;
    btn.addEventListener("click", () => onClick(v));
    root.appendChild(btn);
  }
}

/** チップ描画（複数選択） */
function renderChipsMulti(rootId, values, selectedSet, onToggle) {
  const root = document.querySelector(rootId);
  if (!root) return;
  root.innerHTML = "";

  for (const v of values) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (selectedSet.has(v) ? " on" : "");
    btn.textContent = v;
    btn.addEventListener("click", () => onToggle(v));
    root.appendChild(btn);
  }
}

/** ジャンル別サマリ */
function renderGenreSummary(normRows) {
  const root = document.querySelector("#genre_summary");
  if (!root) return;

  const map = new Map(); // genre -> {sales, claw, machines(Set)}
  for (const r of normRows) {
    const g = (r.prize_genre || "未分類").trim();
    if (!map.has(g)) map.set(g, { sales: 0, claw: 0, machines: new Set() });
    const obj = map.get(g);
    obj.sales += num(r.sales);
    obj.claw += num(r.claw);
    if (r.machine_key) obj.machines.add(r.machine_key);
  }

  const list = Array.from(map.entries()).sort((a, b) => b[1].sales - a[1].sales);

  root.innerHTML = "";
  for (const [g, v] of list) {
    const rate = v.sales ? (v.claw * 1.1) / v.sales : null;
    const el = document.createElement("div");
    el.className = "genreCard";
    el.innerHTML = `
      <div class="ttl">${escapeHtml(g)}</div>
      <div class="row"><span>売上</span><span>${fmtYen(v.sales)}</span></div>
      <div class="row"><span>消化額</span><span>${fmtYen(v.claw)}</span></div>
      <div class="row"><span>原価率</span><span>${fmtPct(rate)}</span></div>
      <div class="row"><span>台数</span><span>${fmtNum(v.machines.size)}台</span></div>
    `;
    root.appendChild(el);
  }
}

function render() {
  // 更新表示（summary優先、日付のみ）
  const updatedEl = document.querySelector("#updated");
  if (updatedEl) {
    const su = RAW_SUMMARY?.updated_at ?? RAW_SUMMARY?.updated ?? RAW_SUMMARY?.updatedAt;
    updatedEl.textContent = "更新: " + (su ? fmtDateOnly(su) : "-");
  }

  // ===== フィルタ（RAW段階）=====
  let rows = RAW_ROWS.slice();
  rows = filterByClawMode(rows);
  rows = filterByQuery(rows);
  rows = filterByMachine(rows);
  rows = filterByGenre(rows);
  rows = filterByTarget(rows);
  rows = filterByAge(rows);

  // 正規化（表示/集計用）
  const norm = rows.map(normalizeRow);
  norm.sort((a, b) => b.sales - a.sales);

  // ===== 候補チップ生成（全RAWから作ると「絞り込みで候補が消える」ので、投入法+検索まで適用した状態から作る）=====
  // ここでは「投入法+検索」のみ反映した pool を作り、候補を安定させる
  let pool = RAW_ROWS.slice();
  pool = filterByClawMode(pool);
  pool = filterByQuery(pool);
  const poolNorm = pool.map(normalizeRow);

  // マシン候補（machine_key）※入力でフィルタ
  let machineValues = uniqueSorted(poolNorm.map((r) => r.machine_key).filter(Boolean));
  const mq = normalizeStr(machineQuery).toLowerCase();
  if (mq) machineValues = machineValues.filter((x) => x.toLowerCase().includes(mq));

  renderChipsMulti("#chips_machine", machineValues, machineSelected, (v) => {
    if (machineSelected.has(v)) machineSelected.delete(v);
    else machineSelected.add(v);
    render();
  });

  // 景品ジャンル候補
  const prizeGenreValues = uniqueSorted(poolNorm.map((r) => r.prize_genre));
  renderChipsSingle("#chips_genre", prizeGenreValues, prizeGenre, (v) => {
    if (prizeGenre === v) {
      prizeGenre = "";
      subGenreSelected = new Set();
    } else {
      prizeGenre = v;
      subGenreSelected = new Set();
    }
    render();
  });

  // 子ジャンル候補（景品ジャンルに応じて）
  let subValues = [];
  if (prizeGenre === "食品") subValues = uniqueSorted(poolNorm.filter(r => r.prize_genre==="食品").map((r) => r.food_genre));
  else if (prizeGenre === "ぬいぐるみ") subValues = uniqueSorted(poolNorm.filter(r => r.prize_genre==="ぬいぐるみ").map((r) => r.nui_genre));
  else if (prizeGenre === "雑貨") subValues = uniqueSorted(poolNorm.filter(r => r.prize_genre==="雑貨").map((r) => r.goods_genre));
  else subValues = [];

  renderChipsMulti("#chips_subgenre", subValues, subGenreSelected, (v) => {
    if (subGenreSelected.has(v)) subGenreSelected.delete(v);
    else subGenreSelected.add(v);
    render();
  });

  // ターゲット（性別）候補
  const targetValues = uniqueSorted(poolNorm.map((r) => r.target));
  renderChipsMulti("#chips_target", targetValues, targetSelected, (v) => {
    if (targetSelected.has(v)) targetSelected.delete(v);
    else targetSelected.add(v);
    render();
  });

  // 年代候補
  const ageValues = uniqueSorted(poolNorm.map((r) => r.age));
  renderChipsMulti("#chips_age", ageValues, ageSelected, (v) => {
    if (ageSelected.has(v)) ageSelected.delete(v);
    else ageSelected.add(v);
    render();
  });

  // ===== KPI（machine_keyユニーク）=====
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
    const mac = machineSelected.size ? ` / マシン:${machineSelected.size}件` : "";
    const g = prizeGenre ? ` / 景品:${prizeGenre}` : "";
    const sg = subGenreSelected.size ? ` / 子:${Array.from(subGenreSelected).join(",")}` : "";
    const tg = targetSelected.size ? ` / 性別:${Array.from(targetSelected).join(",")}` : "";
    const ag = ageSelected.size ? ` / 年代:${Array.from(ageSelected).join(",")}` : "";
    kFilt.textContent = `対象: ${fmtNum(machines)}台 / 投入法: ${modeLabel}${q ? ` / 検索:"${q}"` : ""}${mac}${g}${sg}${tg}${ag}`;
  }

  // ★ジャンル別サマリ（フィルタ後のnormで出す）
  renderGenreSummary(norm);

  // ===== テーブル =====
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


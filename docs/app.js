/******************************************************
 * DB Dashboard (app.js) - FULL REPLACE
 *
 * ✅ 目的
 * - 左フィルタ「マシン（対応マシン名）」は「マスタH列（対応マシン名）」を参照して作る
 * - 台数カウントも「対応マシン名（H列）」でユニーク計算
 * - ドロワー式フィルタ
 * - 中段KPIは「軸を切替」可能（景品ジャンル固定ではない）
 * - 明細はソート（売上/消化/原価率/更新など）できる
 * - 条件フィルタ（例：売上>1万 かつ 原価率<5%）が使える
 *
 * データ
 * - ./data/raw/rows.json
 * - ./data/raw/summary.json
 * - ./data/master/symbol_master.json   ← ここから H列（対応マシン名）を引く
 ******************************************************/

const fmtYen = (n) => n == null || !isFinite(n) ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
const fmtNum = (n) => n == null || !isFinite(n) ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n));
const fmtPct = (v) => v == null || !isFinite(v) ? "-" : (v * 100).toFixed(1) + "%";

let RAW_SUMMARY = null;
let RAW_ROWS = [];
let RAW_MASTER = null;

// ★ master lookup map (normalized boothId -> 対応マシン名)
let MASTER_MACHINE_BY_BOOTH = new Map();

const state = {
  // filters
  machines: new Set(),   // 対応マシン名
  claw: "全体",
  genre: "全て",
  chara: "全て",
  gender: "全て",
  age: "全て",

  // numeric rule filter (row-level)
  minSales: null,
  maxSales: null,
  minCostRate: null,     // 0-1
  maxCostRate: null,     // 0-1

  // axis (mid KPI)
  axisKey: "景品ジャンル",
  axisSortKey: "sales",
  axisSortDir: "desc",

  // table sort
  tableSortKey: "sales",
  tableSortDir: "desc",
};

const AXIS_CANDIDATES = ["景品ジャンル", "投入法", "キャラ", "性別", "年代", "更新日"];
const CLAW_OPTIONS = ["全体", "3本爪", "2本爪"];

// --------------------------
// Load
// --------------------------
async function loadAll() {
  const [rows, summary, master] = await Promise.all([
    fetch("./data/raw/rows.json").then(r => r.json()),
    fetch("./data/raw/summary.json").then(r => r.json()),
    fetch("./data/master/symbol_master.json").then(r => r.json()),
  ]);

  RAW_ROWS = Array.isArray(rows) ? rows : (rows?.rows || []);
  RAW_SUMMARY = summary || null;
  RAW_MASTER = master || null;

  // ★ build master boothId -> machineName map (H列ベース)
  MASTER_MACHINE_BY_BOOTH = buildMasterMachineMap(RAW_MASTER);

  initUI();
  hydrateFromSummary();
  renderAll();
}

function hydrateFromSummary() {
  const updated =
    RAW_SUMMARY?.updated_at ||
    RAW_SUMMARY?.updatedAt ||
    RAW_SUMMARY?.date ||
    RAW_SUMMARY?.updated ||
    null;

  const el = document.getElementById("lastUpdated");
  if (el) el.textContent = "更新: " + (updated ? String(updated) : "-");
}

// --------------------------
// Helpers
// --------------------------
function n(v) {
  const x = Number(v);
  return isFinite(x) ? x : 0;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

function normalizeKey(s) {
  if (s == null) return "";
  return String(s)
    .replace(/\u3000/g, " ")   // 全角スペース→半角
    .trim()
    .replace(/[（]/g, "(")     // 全角カッコ→半角
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")       // 空白除去
    .toLowerCase();
}

function detectField(obj, candidates) {
  if (!obj) return null;
  const keys = Object.keys(obj);
  for (const c of candidates) if (keys.includes(c)) return c;
  for (const k of keys) {
    for (const c of candidates) {
      if (k.includes(c)) return k;
    }
  }
  return null;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uniqueValues(arr) {
  const set = new Set();
  for (const v of arr) {
    const x = (v == null || v === "") ? "未分類" : String(v);
    set.add(x);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
}

// --------------------------
// Row Field Accessors (robust)
// --------------------------
function getSales(row) {
  return n(pick(row, ["総売上", "売上", "sales", "total_sales"]));
}
function getConsume(row) {
  return n(pick(row, ["消化額", "consume", "消化金額", "cost", "消化_額"]));
}
function getConsumeCount(row) {
  return n(pick(row, ["消化数", "consume_count", "count", "消化_数"]));
}
function getUpdatedAt(row) {
  const v = pick(row, ["更新日時", "updatedAt", "updated_at", "日付", "date", "更新日"]);
  return v == null ? "" : String(v);
}
function getPrizeName(row) {
  return String(pick(row, ["景品名", "item_name", "最終景品", "prize"]) || "");
}
function getClaw(row) {
  return String(pick(row, ["投入法", "claw", "投入", "claw_type"]) || "全体");
}
function getGenre(row) {
  return String(pick(row, ["景品ジャンル", "ジャンル", "genre"]) || "未分類");
}
function getChara(row) {
  return String(pick(row, ["キャラ", "キャラ区分", "chara"]) || "未分類");
}
function getGender(row) {
  return String(pick(row, ["性別", "gender"]) || "未分類");
}
function getAge(row) {
  return String(pick(row, ["年代", "age"]) || "未分類");
}

function getBoothId(row) {
  return String(pick(row, ["ブースID", "booth_id", "boothId", "machine_ref", "マシン名"]) || "");
}

/**
 * 対応マシン名（H列）を最優先で解決:
 * 1) rows に 対応マシン名 が入っていればそれ
 * 2) master辞書（ブースID -> 対応マシン名）で引く（H列）
 * 3) fallback: boothId
 */
function getMachineName(row) {
  const directKey = detectField(row, ["対応マシン名", "対応マシン"]);
  if (directKey && row[directKey]) return String(row[directKey]).trim();

  const boothId = getBoothId(row);
  const key = normalizeKey(boothId);
  const fromMaster = MASTER_MACHINE_BY_BOOTH.get(key);
  if (fromMaster) return fromMaster;

  return boothId || "未分類";
}

function calcCostRate(row) {
  const sales = getSales(row);
  const consume = getConsume(row);
  if (!sales) return 0;
  return consume / sales; // 0-1
}

// --------------------------
// Build master map (H列ベース)
// --------------------------
function buildMasterMachineMap(master) {
  const map = new Map();
  if (!master) return map;

  // master: array of rows
  if (Array.isArray(master)) {
    const sample = master[0] || {};
    const boothKey = detectField(sample, ["ブースID", "booth_id", "boothId"]);
    const machineKey = detectField(sample, ["対応マシン名", "対応マシン", "machine_name", "machine"]);

    for (const r of master) {
      const booth = boothKey ? r[boothKey] : null;
      const machine = machineKey ? r[machineKey] : null;
      const b = normalizeKey(booth);
      const m = machine == null ? "" : String(machine).trim();
      if (b && m) map.set(b, m);
    }
    return map;
  }

  // master: { byBoothId: { ... } }
  if (master.byBoothId && typeof master.byBoothId === "object") {
    for (const boothId of Object.keys(master.byBoothId)) {
      const obj = master.byBoothId[boothId];
      const machineKey = detectField(obj, ["対応マシン名", "対応マシン", "machine_name", "machine"]);
      const m = machineKey ? obj[machineKey] : null;
      const b = normalizeKey(boothId);
      if (b && m) map.set(b, String(m).trim());
    }
    return map;
  }

  // master: { "ブースID": { ... } }
  if (typeof master === "object") {
    for (const boothId of Object.keys(master)) {
      const obj = master[boothId];
      if (!obj || typeof obj !== "object") continue;
      const machineKey = detectField(obj, ["対応マシン名", "対応マシン", "machine_name", "machine"]);
      const m = machineKey ? obj[machineKey] : null;
      const b = normalizeKey(boothId);
      if (b && m) map.set(b, String(m).trim());
    }
    return map;
  }

  return map;
}

// --------------------------
// UI Init (Drawer + Filters)
// --------------------------
function initUI() {
  // Drawer open/close
  const drawer = document.getElementById("drawer");
  const overlay = document.getElementById("drawerOverlay");
  const openBtn = document.getElementById("openDrawerBtn");
  const closeBtn = document.getElementById("closeDrawerBtn");
  const applyBtn = document.getElementById("applyFiltersBtn");

  const openDrawer = () => {
    drawer?.classList.add("isOpen");
    overlay?.classList.add("isOpen");
  };
  const closeDrawer = () => {
    drawer?.classList.remove("isOpen");
    overlay?.classList.remove("isOpen");
  };

  openBtn?.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);
  overlay?.addEventListener("click", closeDrawer);

  applyBtn?.addEventListener("click", () => {
    closeDrawer();
    syncNumericInputsToState();
    renderAll();
  });

  // Axis select
  const axisSelect = document.getElementById("axisSelect");
  if (axisSelect) {
    axisSelect.innerHTML = "";
    for (const k of AXIS_CANDIDATES) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      axisSelect.appendChild(opt);
    }
    axisSelect.value = state.axisKey;
    axisSelect.addEventListener("change", () => {
      state.axisKey = axisSelect.value;
      renderAll();
    });
  }

  // axis sort
  const axisSortKey = document.getElementById("axisSortKey");
  const axisSortDirBtn = document.getElementById("axisSortDirBtn");
  axisSortKey && (axisSortKey.value = state.axisSortKey);
  axisSortKey?.addEventListener("change", () => { state.axisSortKey = axisSortKey.value; renderAll(); });
  axisSortDirBtn?.addEventListener("click", () => {
    state.axisSortDir = state.axisSortDir === "desc" ? "asc" : "desc";
    axisSortDirBtn.textContent = state.axisSortDir === "desc" ? "降順" : "昇順";
    renderAll();
  });

  // table sort
  const tableSortKey = document.getElementById("tableSortKey");
  const tableSortDirBtn = document.getElementById("tableSortDirBtn");
  tableSortKey && (tableSortKey.value = state.tableSortKey);
  tableSortKey?.addEventListener("change", () => { state.tableSortKey = tableSortKey.value; renderAll(); });
  tableSortDirBtn?.addEventListener("click", () => {
    state.tableSortDir = state.tableSortDir === "desc" ? "asc" : "desc";
    tableSortDirBtn.textContent = state.tableSortDir === "desc" ? "降順" : "昇順";
    renderAll();
  });

  // clickable headers
  document.querySelectorAll(".table thead th[data-sort]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const k = th.getAttribute("data-sort");
      if (!k) return;
      if (state.tableSortKey === k) {
        state.tableSortDir = state.tableSortDir === "desc" ? "asc" : "desc";
      } else {
        state.tableSortKey = k;
        state.tableSortDir = "desc";
      }
      if (tableSortKey) tableSortKey.value = state.tableSortKey;
      if (tableSortDirBtn) tableSortDirBtn.textContent = state.tableSortDir === "desc" ? "降順" : "昇順";
      renderAll();
    });
  });

  // machine chips (H列対応マシン名を候補に)
  buildMachineChips();
  document.getElementById("machineSearch")?.addEventListener("input", () => buildMachineChips(true));

  // clear machines
  document.getElementById("clearMachinesBtn")?.addEventListener("click", () => {
    state.machines.clear();
    buildMachineChips(true);
    renderAll();
  });

  // claw seg
  buildClawSeg();

  // selects
  buildSelect("genreSelect", uniqueValues(RAW_ROWS.map(getGenre)), (v) => { state.genre = v; });
  buildSelect("charaSelect", uniqueValues(RAW_ROWS.map(getChara)), (v) => { state.chara = v; });
  buildSelect("genderSelect", uniqueValues(RAW_ROWS.map(getGender)), (v) => { state.gender = v; });
  buildSelect("ageSelect", uniqueValues(RAW_ROWS.map(getAge)), (v) => { state.age = v; });

  // numeric inputs / presets
  hookNumericInputs();
  document.getElementById("presetHighSalesLowCost")?.addEventListener("click", () => {
    setVal("minSales", "10000");
    setVal("maxSales", "");
    setVal("minCostPct", "");
    setVal("maxCostPct", "5");
  });
  document.getElementById("presetResetNumeric")?.addEventListener("click", () => {
    setVal("minSales", "");
    setVal("maxSales", "");
    setVal("minCostPct", "");
    setVal("maxCostPct", "");
  });
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v;
}

function buildSelect(id, values, onChange) {
  const el = document.getElementById(id);
  if (!el) return;

  const all = ["全て", ...values];
  el.innerHTML = "";
  for (const v of all) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }

  const keyMap = { genreSelect: "genre", charaSelect: "chara", genderSelect: "gender", ageSelect: "age" };
  const stateKey = keyMap[id];
  el.value = state[stateKey] || "全て";
  el.addEventListener("change", () => onChange(el.value));
}

function buildClawSeg() {
  const seg = document.getElementById("clawSeg");
  if (!seg) return;

  seg.innerHTML = "";
  for (const v of CLAW_OPTIONS) {
    const b = document.createElement("button");
    b.className = "segBtn" + (state.claw === v ? " isOn" : "");
    b.textContent = v;
    b.addEventListener("click", () => {
      state.claw = v;
      buildClawSeg();
    });
    seg.appendChild(b);
  }
}

/**
 * ★ machine chips are built from MASTER_MACHINE_BY_BOOTH.values()
 *   -> This guarantees "対応マシン名" list (H列) only.
 */
function buildMachineChips() {
  const wrap = document.getElementById("machineChipGrid");
  const q = (document.getElementById("machineSearch")?.value || "").trim().toLowerCase();
  if (!wrap) return;

  let allMachines = Array.from(new Set(Array.from(MASTER_MACHINE_BY_BOOTH.values())))
    .filter(x => x && x !== "未分類")
    .sort((a, b) => a.localeCompare(b, "ja"));

  // fallback if master empty
  if (allMachines.length === 0) {
    allMachines = uniqueValues(RAW_ROWS.map(getMachineName)).filter(x => x && x !== "未分類");
  }

  const filtered = q ? allMachines.filter(m => m.toLowerCase().includes(q)) : allMachines;

  wrap.innerHTML = "";
  for (const name of filtered) {
    const btn = document.createElement("button");
    btn.className = "chipBtn" + (state.machines.has(name) ? " isOn" : "");
    btn.textContent = name;
    btn.addEventListener("click", () => {
      if (state.machines.has(name)) state.machines.delete(name);
      else state.machines.add(name);
      btn.classList.toggle("isOn");
    });
    wrap.appendChild(btn);
  }
}

function hookNumericInputs() {
  const ids = ["minSales", "maxSales", "minCostPct", "maxCostPct"];
  for (const id of ids) {
    document.getElementById(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        syncNumericInputsToState();
        renderAll();
      }
    });
  }
}

function syncNumericInputsToState() {
  const minSales = parseFloat(document.getElementById("minSales")?.value);
  const maxSales = parseFloat(document.getElementById("maxSales")?.value);
  const minCostPct = parseFloat(document.getElementById("minCostPct")?.value);
  const maxCostPct = parseFloat(document.getElementById("maxCostPct")?.value);

  state.minSales = isFinite(minSales) ? minSales : null;
  state.maxSales = isFinite(maxSales) ? maxSales : null;
  state.minCostRate = isFinite(minCostPct) ? (minCostPct / 100) : null;
  state.maxCostRate = isFinite(maxCostPct) ? (maxCostPct / 100) : null;
}

// --------------------------
// Filtering + Aggregation
// --------------------------
function passesFilters(row) {
  const machineName = getMachineName(row);
  if (state.machines.size > 0 && !state.machines.has(machineName)) return false;

  if (state.claw !== "全体") {
    const claw = getClaw(row);
    if (claw !== state.claw) return false;
  }

  if (state.genre !== "全て" && getGenre(row) !== state.genre) return false;
  if (state.chara !== "全て" && getChara(row) !== state.chara) return false;
  if (state.gender !== "全て" && getGender(row) !== state.gender) return false;
  if (state.age !== "全て" && getAge(row) !== state.age) return false;

  // numeric rule filter (row-level)
  const sales = getSales(row);
  const cr = calcCostRate(row);

  if (state.minSales != null && sales < state.minSales) return false;
  if (state.maxSales != null && sales > state.maxSales) return false;

  if (state.minCostRate != null && cr < state.minCostRate) return false;
  if (state.maxCostRate != null && cr > state.maxCostRate) return false;

  return true;
}

function getAxisValue(row, axisKey) {
  switch (axisKey) {
    case "景品ジャンル": return getGenre(row);
    case "投入法": return getClaw(row);
    case "キャラ": return getChara(row);
    case "性別": return getGender(row);
    case "年代": return getAge(row);
    case "更新日": return getUpdatedAt(row) || "-";
    default: return String(row?.[axisKey] ?? "未分類");
  }
}

function uniqueMachineCount(rows) {
  const set = new Set();
  for (const r of rows) {
    const m = getMachineName(r);
    if (!m || m === "未分類") continue;
    set.add(m);
  }
  return set.size;
}

function totals(rows) {
  let sales = 0;
  let consume = 0;
  for (const r of rows) {
    sales += getSales(r);
    consume += getConsume(r);
  }
  const cr = sales ? (consume / sales) : 0;
  return { sales, consume, costRate: cr };
}

function groupByAxis(rows, axisKey) {
  const map = new Map();
  for (const r of rows) {
    const key = getAxisValue(r, axisKey) || "未分類";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }

  const out = [];
  for (const [key, list] of map.entries()) {
    const t = totals(list);
    out.push({
      key,
      sales: t.sales,
      consume: t.consume,
      costRate: t.costRate,
      machines: uniqueMachineCount(list),
      rows: list,
    });
  }
  return out;
}

function sortAxisGroups(groups) {
  const dir = state.axisSortDir === "desc" ? -1 : 1;
  const key = state.axisSortKey;
  return groups.sort((a, b) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return String(a.key).localeCompare(String(b.key), "ja") * dir;
  });
}

function sortRows(rows) {
  const dir = state.tableSortDir === "desc" ? -1 : 1;
  const key = state.tableSortKey;

  function val(r) {
    switch (key) {
      case "sales": return getSales(r);
      case "consume": return getConsume(r);
      case "consumeCount": return getConsumeCount(r);
      case "costRate": return calcCostRate(r);
      case "updatedAt": return getUpdatedAt(r) || "";
      case "machine": return getMachineName(r) || "";
      default: return getSales(r);
    }
  }

  return rows.sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv), "ja") * dir;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

// --------------------------
// Render
// --------------------------
function renderAll() {
  const filtered = RAW_ROWS.filter(passesFilters);

  renderActiveFilterChips(filtered);
  renderKPI(filtered);
  renderAxis(filtered);
  renderTable(filtered);
}

function renderActiveFilterChips(filteredRows) {
  const wrap = document.getElementById("activeFilterChips");
  if (!wrap) return;
  wrap.innerHTML = "";

  const chips = [];

  if (state.machines.size > 0) {
    const list = Array.from(state.machines);
    const label = list.length <= 3 ? list.join(" / ") : `${list[0]} ほか${list.length - 1}`;
    chips.push({ k: "マシン", v: label });
  } else {
    chips.push({ k: "マシン", v: "全体" });
  }

  chips.push({ k: "投入法", v: state.claw });

  if (state.genre !== "全て") chips.push({ k: "ジャンル", v: state.genre });
  if (state.chara !== "全て") chips.push({ k: "キャラ", v: state.chara });
  if (state.gender !== "全て") chips.push({ k: "性別", v: state.gender });
  if (state.age !== "全て") chips.push({ k: "年代", v: state.age });

  if (state.minSales != null) chips.push({ k: "売上≥", v: fmtNum(state.minSales) });
  if (state.maxSales != null) chips.push({ k: "売上≤", v: fmtNum(state.maxSales) });
  if (state.minCostRate != null) chips.push({ k: "原価率≥", v: (state.minCostRate * 100).toFixed(0) + "%" });
  if (state.maxCostRate != null) chips.push({ k: "原価率≤", v: (state.maxCostRate * 100).toFixed(0) + "%" });

  chips.push({ k: "対象", v: `${filteredRows.length}行` });

  for (const c of chips) {
    const el = document.createElement("div");
    el.className = "chip";
    el.innerHTML = `<b>${escapeHtml(c.k)}</b> ${escapeHtml(c.v)}`;
    wrap.appendChild(el);
  }
}

function renderKPI(rows) {
  const t = totals(rows);
  const machines = uniqueMachineCount(rows);
  const avg = machines ? (t.sales / machines) : 0;

  const kpiSales = document.getElementById("kpiSales");
  const kpiConsume = document.getElementById("kpiConsume");
  const kpiCostRate = document.getElementById("kpiCostRate");
  const kpiAvg = document.getElementById("kpiAvg");
  const kpiMachineCount = document.getElementById("kpiMachineCount");
  const tableMeta = document.getElementById("tableMeta");

  kpiSales && (kpiSales.textContent = fmtYen(t.sales));
  kpiConsume && (kpiConsume.textContent = fmtYen(t.consume));
  kpiCostRate && (kpiCostRate.textContent = fmtPct(t.costRate));
  kpiAvg && (kpiAvg.textContent = fmtYen(avg));
  kpiMachineCount && (kpiMachineCount.textContent = `台数: ${machines}`);

  tableMeta && (tableMeta.textContent = `対象: ${machines}台 / 投入法: ${state.claw}`);
}

function renderAxis(rows) {
  const wrap = document.getElementById("axisCards");
  if (!wrap) return;
  wrap.innerHTML = "";

  const groups = sortAxisGroups(groupByAxis(rows, state.axisKey));
  for (const g of groups) {
    const card = document.createElement("div");
    card.className = "axisCard";
    card.innerHTML = `
      <div class="axisCard__title">
        <div>${escapeHtml(g.key)}</div>
        <div class="badge">${g.machines}台</div>
      </div>
      <div class="axisCard__grid">
        <div class="row"><span>売上</span><b>${fmtYen(g.sales)}</b></div>
        <div class="row"><span>消化額</span><b>${fmtYen(g.consume)}</b></div>
        <div class="row"><span>原価率</span><b>${fmtPct(g.costRate)}</b></div>
      </div>
    `;
    wrap.appendChild(card);
  }
}

function renderTable(rows) {
  const body = document.getElementById("tableBody");
  if (!body) return;
  body.innerHTML = "";

  const list = sortRows([...rows]);

  for (const r of list) {
    const tr = document.createElement("tr");
    const machineName = getMachineName(r);
    const prize = getPrizeName(r);
    const sales = getSales(r);
    const ccount = getConsumeCount(r);
    const consume = getConsume(r);
    const cr = calcCostRate(r);
    const upd = getUpdatedAt(r) || "-";

    tr.innerHTML = `
      <td>${escapeHtml(machineName)}</td>
      <td>${escapeHtml(prize)}</td>
      <td class="num">${fmtYen(sales)}</td>
      <td class="num">${fmtNum(ccount)}</td>
      <td class="num">${fmtYen(consume)}</td>
      <td class="num"><span class="badge">${fmtPct(cr)}</span></td>
      <td class="num">${escapeHtml(upd)}</td>
    `;
    body.appendChild(tr);
  }
}

// --------------------------
// Boot
// --------------------------
loadAll().catch(err => {
  console.error(err);
  alert("データの読み込みに失敗しました: " + err.message);
});

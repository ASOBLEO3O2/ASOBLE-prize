/******************************************************
 * DB Dashboard (drawer + flexible axis + sorting + rule filter)
 * データ入口は維持:
 *  - ./data/raw/rows.json
 *  - ./data/raw/summary.json
 *  - ./data/master/symbol_master.json
 ******************************************************/

const fmtYen = (n) => n == null || !isFinite(n) ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
const fmtNum = (n) => n == null || !isFinite(n) ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n));
const fmtPct = (v) => v == null || !isFinite(v) ? "-" : (v * 100).toFixed(1) + "%";

let RAW_SUMMARY = null;
let RAW_ROWS = [];
let RAW_MASTER = null;

// UI state
const state = {
  // filters
  machines: new Set(),          // 対応マシン名（ユニーク）
  claw: "全体",                 // 投入法
  genre: "全て",
  chara: "全て",
  gender: "全て",
  age: "全て",

  // numeric rule filter (row-level)
  minSales: null,
  maxSales: null,
  minCostRate: null,            // 0-1
  maxCostRate: null,            // 0-1

  // axis
  axisKey: "景品ジャンル",
  axisSortKey: "sales",
  axisSortDir: "desc",

  // table sort
  tableSortKey: "sales",
  tableSortDir: "desc",
};

// axis candidates (存在するものだけUIに出す)
const AXIS_CANDIDATES = [
  "景品ジャンル",
  "投入法",
  "キャラ",
  "性別",
  "年代",
  "更新日",
];

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

  initUI();
  hydrateFromSummary();
  renderAll();
}

function hydrateFromSummary() {
  const updated = RAW_SUMMARY?.updated_at || RAW_SUMMARY?.updatedAt || RAW_SUMMARY?.date || null;
  document.getElementById("lastUpdated").textContent = "更新: " + (updated ? String(updated) : "-");
}

// --------------------------
// Helpers: normalize fields
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

function getSales(row) {
  return n(pick(row, ["総売上", "売上", "sales", "total_sales"]));
}
function getConsume(row) {
  return n(pick(row, ["消化額", "consume", "消化金額", "cost"]));
}
function getConsumeCount(row) {
  return n(pick(row, ["消化数", "consume_count", "count"]));
}
function getUpdatedAt(row) {
  const v = pick(row, ["更新日時", "updatedAt", "updated_at", "日付", "date"]);
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

/**
 * 台数は「マスタH列（対応マシン名）」を基準にする
 * - rows側に対応マシン名が入っている場合はそれを使う
 * - master側に boothId -> 対応マシン名 辞書がある場合はそれを優先
 *
 * 期待する master の形（どれかに対応）:
 *  1) { byBoothId: { "ブースID": { "対応マシン名": "..." } } }
 *  2) { "ブースID": { "対応マシン名": "..." } }
 *  3) Array rows: [ { ブースID, 対応マシン名, ... }, ... ]
 */
function getBoothId(row) {
  return String(pick(row, ["ブースID", "booth_id", "boothId", "machine_ref", "マシン名"]) || "");
}

function getMasterMachineNameByBoothId(boothId) {
  if (!boothId) return null;
  if (!RAW_MASTER) return null;

  // 1) byBoothId
  if (RAW_MASTER.byBoothId && RAW_MASTER.byBoothId[boothId]) {
    const v = RAW_MASTER.byBoothId[boothId];
    return pick(v, ["対応マシン名", "machine", "machine_name"]);
  }

  // 2) direct map
  if (RAW_MASTER[boothId] && typeof RAW_MASTER[boothId] === "object") {
    return pick(RAW_MASTER[boothId], ["対応マシン名", "machine", "machine_name"]);
  }

  // 3) array
  if (Array.isArray(RAW_MASTER)) {
    const hit = RAW_MASTER.find(r => String(pick(r, ["ブースID", "booth_id", "boothId"])) === boothId);
    if (hit) return pick(hit, ["対応マシン名", "machine", "machine_name"]);
  }

  return null;
}

function getMachineName(row) {
  // master H (対応マシン名) 優先
  const boothId = getBoothId(row);
  const fromMaster = getMasterMachineNameByBoothId(boothId);
  if (fromMaster) return String(fromMaster);

  // rows側に入っている場合
  const v = pick(row, ["対応マシン名", "machine", "machine_name"]);
  if (v) return String(v);

  // fallback: マシン名/ブースID
  const fallback = pick(row, ["マシン名", "machine_ref", "ブースID", "booth_id"]);
  return String(fallback || "");
}

function calcCostRate(row) {
  const sales = getSales(row);
  const consume = getConsume(row);
  if (!sales) return 0;
  return consume / sales; // 0-1
}

// --------------------------
// UI Init
// --------------------------
function initUI() {
  // Drawer open/close
  const drawer = document.getElementById("drawer");
  const overlay = document.getElementById("drawerOverlay");
  const openBtn = document.getElementById("openDrawerBtn");
  const closeBtn = document.getElementById("closeDrawerBtn");
  const applyBtn = document.getElementById("applyFiltersBtn");

  function openDrawer() {
    drawer.classList.add("isOpen");
    overlay.classList.add("isOpen");
  }
  function closeDrawer() {
    drawer.classList.remove("isOpen");
    overlay.classList.remove("isOpen");
  }
  openBtn.addEventListener("click", openDrawer);
  closeBtn.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);
  applyBtn.addEventListener("click", () => {
    closeDrawer();
    syncNumericInputsToState();
    renderAll();
  });

  // Axis select
  const axisSelect = document.getElementById("axisSelect");
  axisSelect.innerHTML = "";
  const availableAxis = getAvailableAxisKeys();
  for (const k of availableAxis) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    axisSelect.appendChild(opt);
  }
  state.axisKey = availableAxis.includes(state.axisKey) ? state.axisKey : availableAxis[0] || "景品ジャンル";
  axisSelect.value = state.axisKey;
  axisSelect.addEventListener("change", () => {
    state.axisKey = axisSelect.value;
    renderAll();
  });

  // axis sort
  const axisSortKey = document.getElementById("axisSortKey");
  const axisSortDirBtn = document.getElementById("axisSortDirBtn");
  axisSortKey.value = state.axisSortKey;
  axisSortKey.addEventListener("change", () => { state.axisSortKey = axisSortKey.value; renderAll(); });
  axisSortDirBtn.addEventListener("click", () => {
    state.axisSortDir = state.axisSortDir === "desc" ? "asc" : "desc";
    axisSortDirBtn.textContent = state.axisSortDir === "desc" ? "降順" : "昇順";
    renderAll();
  });

  // table sort
  const tableSortKey = document.getElementById("tableSortKey");
  const tableSortDirBtn = document.getElementById("tableSortDirBtn");
  tableSortKey.value = state.tableSortKey;
  tableSortKey.addEventListener("change", () => { state.tableSortKey = tableSortKey.value; renderAll(); });
  tableSortDirBtn.addEventListener("click", () => {
    state.tableSortDir = state.tableSortDir === "desc" ? "asc" : "desc";
    tableSortDirBtn.textContent = state.tableSortDir === "desc" ? "降順" : "昇順";
    renderAll();
  });

  // clickable headers (optional convenience)
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
      tableSortKey.value = state.tableSortKey;
      tableSortDirBtn.textContent = state.tableSortDir === "desc" ? "降順" : "昇順";
      renderAll();
    });
  });

  // machine chips
  buildMachineChips();

  // claw seg
  buildClawSeg();

  // selects (genre/chara/gender/age)
  buildSelect("genreSelect", uniqueValues(RAW_ROWS.map(getGenre)), (v) => { state.genre = v; });
  buildSelect("charaSelect", uniqueValues(RAW_ROWS.map(getChara)), (v) => { state.chara = v; });
  buildSelect("genderSelect", uniqueValues(RAW_ROWS.map(getGender)), (v) => { state.gender = v; });
  buildSelect("ageSelect", uniqueValues(RAW_ROWS.map(getAge)), (v) => { state.age = v; });

  // numeric inputs
  hookNumericInputs();

  // presets
  document.getElementById("presetHighSalesLowCost").addEventListener("click", () => {
    document.getElementById("minSales").value = "10000";
    document.getElementById("maxSales").value = "";
    document.getElementById("minCostPct").value = "";
    document.getElementById("maxCostPct").value = "5";
  });
  document.getElementById("presetResetNumeric").addEventListener("click", () => {
    document.getElementById("minSales").value = "";
    document.getElementById("maxSales").value = "";
    document.getElementById("minCostPct").value = "";
    document.getElementById("maxCostPct").value = "";
  });

  // clear machines
  document.getElementById("clearMachinesBtn").addEventListener("click", () => {
    state.machines.clear();
    buildMachineChips(true);
    renderAll();
  });

  // search in drawer
  document.getElementById("machineSearch").addEventListener("input", () => {
    buildMachineChips(true);
  });
}

function getAvailableAxisKeys() {
  const keys = new Set();
  for (const k of AXIS_CANDIDATES) {
    // 1) known computed fields
    if (k === "投入法") { keys.add(k); continue; }
    if (k === "景品ジャンル") { keys.add(k); continue; }
    if (k === "キャラ") { keys.add(k); continue; }
    if (k === "性別") { keys.add(k); continue; }
    if (k === "年代") { keys.add(k); continue; }
    if (k === "更新日") { keys.add(k); continue; }
  }
  return Array.from(keys);
}

function uniqueValues(arr) {
  const s = new Set();
  for (const v of arr) {
    const x = (v == null || v === "") ? "未分類" : String(v);
    s.add(x);
  }
  return Array.from(s).sort((a,b)=>a.localeCompare(b,"ja"));
}

function buildSelect(id, values, onChange) {
  const el = document.getElementById(id);
  const all = ["全て", ...values];
  el.innerHTML = "";
  for (const v of all) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }
  // initial state
  const map = {
    genreSelect: "genre",
    charaSelect: "chara",
    genderSelect: "gender",
    ageSelect: "age",
  };
  const key = map[id];
  el.value = state[key] || "全て";
  el.addEventListener("change", () => {
    onChange(el.value);
  });
}

function buildClawSeg() {
  const seg = document.getElementById("clawSeg");
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

function buildMachineChips(rebuildOnly = false) {
  const wrap = document.getElementById("machineChipGrid");
  const q = (document.getElementById("machineSearch").value || "").trim().toLowerCase();

  // master H (対応マシン名) を基準に、候補を作る
  const allMachines = uniqueValues(RAW_ROWS.map(getMachineName)).filter(x => x && x !== "未分類");

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
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        syncNumericInputsToState();
        renderAll();
      }
    });
  }
}

function syncNumericInputsToState() {
  const minSales = parseFloat(document.getElementById("minSales").value);
  const maxSales = parseFloat(document.getElementById("maxSales").value);
  const minCostPct = parseFloat(document.getElementById("minCostPct").value);
  const maxCostPct = parseFloat(document.getElementById("maxCostPct").value);

  state.minSales = isFinite(minSales) ? minSales : null;
  state.maxSales = isFinite(maxSales) ? maxSales : null;

  state.minCostRate = isFinite(minCostPct) ? (minCostPct / 100) : null;
  state.maxCostRate = isFinite(maxCostPct) ? (maxCostPct / 100) : null;
}

// --------------------------
// Filtering + Aggregation
// --------------------------
function passesFilters(row) {
  // machines (対応マシン名) - state.machines が空なら全て
  const machineName = getMachineName(row);
  if (state.machines.size > 0 && !state.machines.has(machineName)) return false;

  // claw
  if (state.claw !== "全体") {
    const claw = getClaw(row);
    if (claw !== state.claw) return false;
  }

  // category selects
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
    default:
      return String(row[axisKey] ?? "未分類");
  }
}

function uniqueMachineCountFromMasterH(rows) {
  const set = new Set();
  for (const r of rows) {
    const m = getMachineName(r);
    if (!m) continue;
    if (m === "未分類") continue;
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
      machines: uniqueMachineCountFromMasterH(list),
      rows: list,
    });
  }
  return out;
}

function sortAxisGroups(groups) {
  const dir = state.axisSortDir === "desc" ? -1 : 1;
  const key = state.axisSortKey;

  return groups.sort((a,b) => {
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
      case "updatedAt": {
        // 日付文字列をざっくり比較
        const s = getUpdatedAt(r);
        return s ? s : "";
      }
      case "machine": return getMachineName(r);
      default: return getSales(r);
    }
  }

  return rows.sort((a,b) => {
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
  wrap.innerHTML = "";

  const chips = [];

  // machines summary
  if (state.machines.size > 0) {
    const list = Array.from(state.machines);
    const label = list.length <= 3 ? list.join(" / ") : `${list[0]} ほか${list.length-1}`;
    chips.push({ k: "マシン", v: label });
  } else {
    chips.push({ k: "マシン", v: "全体" });
  }

  chips.push({ k: "投入法", v: state.claw });

  if (state.genre !== "全て") chips.push({ k: "ジャンル", v: state.genre });
  if (state.chara !== "全て") chips.push({ k: "キャラ", v: state.chara });
  if (state.gender !== "全て") chips.push({ k: "性別", v: state.gender });
  if (state.age !== "全て") chips.push({ k: "年代", v: state.age });

  // numeric
  if (state.minSales != null) chips.push({ k: "売上≥", v: fmtNum(state.minSales) });
  if (state.maxSales != null) chips.push({ k: "売上≤", v: fmtNum(state.maxSales) });
  if (state.minCostRate != null) chips.push({ k: "原価率≥", v: (state.minCostRate*100).toFixed(0) + "%" });
  if (state.maxCostRate != null) chips.push({ k: "原価率≤", v: (state.maxCostRate*100).toFixed(0) + "%" });

  // right side meta chip (target count)
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
  const machines = uniqueMachineCountFromMasterH(rows);
  const avg = machines ? (t.sales / machines) : 0;

  document.getElementById("kpiSales").textContent = fmtYen(t.sales);
  document.getElementById("kpiConsume").textContent = fmtYen(t.consume);
  document.getElementById("kpiCostRate").textContent = fmtPct(t.costRate);
  document.getElementById("kpiAvg").textContent = fmtYen(avg);
  document.getElementById("kpiMachineCount").textContent = `台数: ${machines}`;

  // table meta
  document.getElementById("tableMeta").textContent = `対象: ${machines}台 / 投入法: ${state.claw}`;
}

function renderAxis(rows) {
  const wrap = document.getElementById("axisCards");
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
// util
// --------------------------
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// boot
loadAll().catch(err => {
  console.error(err);
  alert("データの読み込みに失敗しました: " + err.message);
});

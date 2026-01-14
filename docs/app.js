const fmtYen = (n) => n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
const fmtPct = (v) => v == null ? "-" : (v * 100).toFixed(1) + "%";

let RAW_SUMMARY = null;
let RAW_BY_SYMBOL = [];
let SYMBOL_MASTER = {};

let selected = new Set();
let sortKey = "sales";
let sortDir = "desc";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mix = (a,b,t) => Math.round(a + (b-a)*t);

function rateStyleBySpec(rate){
  if (rate == null) return "";
  const pct = rate * 100;

  const BLUE  = { r: 30,  g: 107, b: 255 };
  const WHITE = { r: 255, g: 255, b: 255 };
  const RED   = { r: 217, g: 48,  b: 37  };

  let bg = WHITE;

  if (pct >= 32) {
    bg = RED;
  } else if (pct >= 25) {
    const t = clamp01((pct - 25) / (31 - 25));
    const start = { r: 245, g: 245, b: 245 };
    bg = { r: mix(start.r, WHITE.r, t), g: mix(start.g, WHITE.g, t), b: mix(start.b, WHITE.b, t) };
  } else {
    const t = clamp01(pct / 25);
    bg = { r: mix(BLUE.r, WHITE.r, t), g: mix(BLUE.g, WHITE.g, t), b: mix(BLUE.b, WHITE.b, t) };
  }

  const luminance = (0.2126*bg.r + 0.7152*bg.g + 0.0722*bg.b) / 255;
  const text = (pct >= 32 || luminance < 0.55) ? "#fff" : "#222";

  return [
    `background: rgb(${bg.r}, ${bg.g}, ${bg.b});`,
    `color: ${text};`,
    `font-weight: 800;`,
    `border-radius: 8px;`,
    `padding: 6px 10px;`,
    `display: inline-block;`,
    `min-width: 72px;`,
    `text-align: right;`,
  ].join(" ");
}

function getMeaning(symbol){
  const key = symbol ?? "(未設定)";
  const v = SYMBOL_MASTER?.[key];
  return (v && String(v).trim()) ? String(v) : "";
}

sync function main() {
  const summary = await fetch("../data/agg/summary.json").then(r => r.json());
  const rows = await fetch("../data/agg/by_symbol.json").then(r => r.json());
  SYMBOL_MASTER = await fetchJsonSafe("../data/master/symbol_master.json", {});

  selected = new Set(RAW_BY_SYMBOL.map(r => r.symbol ?? "(未設定)"));

  renderSymbolChips();
  wireEvents();
  render();
}

function wireEvents(){
  document.querySelector("#btn_all").addEventListener("click", () => {
    selected = new Set(visibleSymbolsByQuery());
    render();
    syncChipsChecked();
  });

  document.querySelector("#btn_none").addEventListener("click", () => {
    selected = new Set();
    render();
    syncChipsChecked();
  });

  document.querySelector("#q").addEventListener("input", () => {
    renderSymbolChips();
  });

  document.querySelectorAll("#tbl thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = (sortDir === "desc") ? "asc" : "desc";
      else { sortKey = key; sortDir = (key === "symbol" || key === "meaning") ? "asc" : "desc"; }
      render();
    });
  });
}

function renderSymbolChips(){
  const box = document.querySelector("#symbol_box");
  box.innerHTML = "";
  const q = (document.querySelector("#q").value || "").toLowerCase();

  RAW_BY_SYMBOL
    .filter(r => !q ? true : String(r.symbol ?? "").toLowerCase().includes(q))
    .slice()
    .sort((a,b) => String(a.symbol).localeCompare(String(b.symbol), "ja"))
    .forEach(r => {
      const sym = r.symbol ?? "(未設定)";
      const meaning = getMeaning(sym);

      const chip = document.createElement("label");
      chip.className = "chip";
      chip.title = meaning ? `${sym}：${meaning}` : `${sym}`;

      chip.innerHTML = `
        <input type="checkbox" />
        <span class="tag">${escapeHtml(sym)}</span>
        <span class="sub">${fmtYen(r.sales)}</span>
      `;
      const cb = chip.querySelector("input");
      cb.checked = selected.has(sym);

      cb.addEventListener("change", () => {
        cb.checked ? selected.add(sym) : selected.delete(sym);
        render();
      });

      box.appendChild(chip);
    });
}

function syncChipsChecked(){
  document.querySelectorAll("#symbol_box .chip").forEach(chip => {
    const sym = chip.querySelector(".tag")?.textContent ?? "";
    chip.querySelector("input").checked = selected.has(sym);
  });
}

function visibleSymbolsByQuery(){
  const q = (document.querySelector("#q").value || "").toLowerCase();
  return RAW_BY_SYMBOL.map(r => r.symbol ?? "(未設定)")
    .filter(s => !q || String(s).toLowerCase().includes(q));
}

function render(){
  document.querySelector("#updated").textContent =
    "更新: " + new Date(RAW_SUMMARY.updated_at).toLocaleString("ja-JP");

  const filtered = RAW_BY_SYMBOL.filter(r => selected.has(r.symbol ?? "(未設定)"));

  const totalSales = filtered.reduce((a,r) => a + num(r.sales), 0);
  const totalClaw  = filtered.reduce((a,r) => a + num(r.claw), 0);
  const costRate   = totalSales ? (totalClaw * 1.1) / totalSales : null;

  document.querySelector("#k_sales").textContent = fmtYen(totalSales);
  document.querySelector("#k_claw").textContent  = fmtYen(totalClaw);

  const kRate = document.querySelector("#k_rate");
  kRate.textContent = fmtPct(costRate);
  kRate.style = rateStyleBySpec(costRate);

  document.querySelector("#k_filtered").textContent =
    `選択中: ${selected.size}/${RAW_BY_SYMBOL.length} 記号`;

  const sorted = filtered.slice().sort((a,b) => cmp(a,b,sortKey,sortDir));

  const tb = document.querySelector("#tbl tbody");
  tb.innerHTML = "";

  sorted.forEach(r => {
    const sym = r.symbol ?? "(未設定)";
    const meaning = getMeaning(sym);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(sym)}</td>
      <td class="meaning" title="${escapeHtml(meaning)}">${escapeHtml(meaning)}</td>
      <td>${fmtYen(num(r.sales))}</td>
      <td>${fmtYen(num(r.claw))}</td>
      <td style="${rateStyleBySpec(r.cost_rate)}">${fmtPct(r.cost_rate)}</td>
      <td>${r.count ?? ""}</td>
    `;
    tb.appendChild(tr);
  });

  syncChipsChecked();
}

function cmp(a,b,key,dir){
  const s = (dir === "desc") ? -1 : 1;
  if (key === "symbol") return s * String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""), "ja");
  if (key === "meaning") return s * String(getMeaning(a.symbol ?? "")).localeCompare(String(getMeaning(b.symbol ?? "")), "ja");
  return s * (num(a[key]) - num(b[key]));
}

function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.json();
}
async function fetchJsonSafe(url,fallback){
  try { return await fetchJson(url); } catch { return fallback; }
}
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

main().catch(e => { console.error(e); alert("読み込み失敗: " + e.message); });

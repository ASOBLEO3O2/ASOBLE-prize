const fmtYen = (n) => n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
const fmtPct = (v) => v == null ? "-" : (v * 100).toFixed(1) + "%";

let RAW_SUMMARY = null;
let RAW_BY_SYMBOL = [];
let RAW_MASTER = null; // { "A": "意味", ... }

let selected = new Set();  // 選択中の記号
let sortKey = "sales";
let sortDir = "desc"; // "asc" | "desc"

async function main() {
  RAW_SUMMARY = await fetchJson("./data/agg/summary.json");
  RAW_BY_SYMBOL = await fetchJson("./data/agg/by_symbol.json");

  // symbol_master は無くても動くように（後で入る前提）
  try {
    RAW_MASTER = await fetchJson("./data/master/symbol_master.json");
  } catch (e) {
    console.warn("symbol_master.json not found (optional).", e);
    RAW_MASTER = null;
  }

  // 初期：全選択（(未設定)も含める）
  selected = new Set(RAW_BY_SYMBOL.map(r => (r.symbol ?? "(未設定)")));

  renderSymbolChips();
  wireEvents();
  render();
}

function wireEvents() {
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

function renderSymbolChips() {
  const box = document.querySelector("#symbol_box");
  box.innerHTML = "";

  const q = (document.querySelector("#q").value || "").trim().toLowerCase();

  const rows = RAW_BY_SYMBOL
    .filter(r => {
      const sym = (r.symbol ?? "(未設定)");
      if (!q) return true;
      return String(sym).toLowerCase().includes(q);
    })
    .slice()
    .sort((a,b) => String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""), "ja"));

  rows.forEach(r => {
    const sym = r.symbol ?? "(未設定)";
    const chip = document.createElement("label");
    chip.className = "chip";
    chip.innerHTML = `
      <input type="checkbox" />
      <span class="tag">${escapeHtml(sym)}</span>
      <span class="sub">${fmtYen(r.sales)}</span>
    `;
    const cb = chip.querySelector("input");
    cb.checked = selected.has(sym);

    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(sym);
      else selected.delete(sym);
      render();
    });

    box.appendChild(chip);
  });
}

function syncChipsChecked() {
  document.querySelectorAll("#symbol_box .chip").forEach(chip => {
    const sym = chip.querySelector(".tag")?.textContent ?? "";
    const cb = chip.querySelector("input");
    cb.checked = selected.has(sym);
  });
}

function visibleSymbolsByQuery() {
  const q = (document.querySelector("#q").value || "").trim().toLowerCase();
  return RAW_BY_SYMBOL
    .map(r => (r.symbol ?? "(未設定)"))
    .filter(sym => !q || String(sym).toLowerCase().includes(q));
}

function getMeaning(sym) {
  if (!RAW_MASTER) return "";
  return RAW_MASTER[sym] ?? "";
}

/**
 * 原価率の色（あなた指定）
 * - 0%: 青
 * - 32%以上: 赤
 * - 25〜31%: 白グラデーション
 *
 * rate は 0.308 のような「割合」
 */
function rateStyleBySpec(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return "";
  const pct = rate * 100;

  // 32%以上：赤
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

  // 0%：青（0に近いほど青を濃く…まではまだ不要とのことだったので固定青）
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

  // 25〜31：白グラデーション（25→薄い / 31→濃い）
  if (pct >= 25 && pct <= 31) {
    const t = (pct - 25) / (31 - 25); // 0..1
    const alpha = 0.15 + t * 0.60;   // 0.15..0.75 いい感じに見える範囲
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

  // それ以外（0〜25未満、31〜32未満）は一旦「何も塗らない」扱いにしてもいいが、
  // 仕様に明記がないので "薄い青" に寄せる（見やすさ優先）
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

  // 31〜32未満（赤に行く直前）：薄い赤
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

function render() {
  // 更新日時
  document.querySelector("#updated").textContent =
    "更新: " + new Date(RAW_SUMMARY.updated_at).toLocaleString("ja-JP");

  // 選択フィルタ
  const filtered = RAW_BY_SYMBOL.filter(r => selected.has(r.symbol ?? "(未設定)"));

  // KPI：選択中の合計
  const totalSales = filtered.reduce((a, r) => a + num(r.sales), 0);
  const totalClaw  = filtered.reduce((a, r) => a + num(r.claw), 0);
  const costRate   = totalSales ? (totalClaw * 1.1) / totalSales : null;

  document.querySelector("#k_sales").textContent = fmtYen(totalSales);
  document.querySelector("#k_claw").textContent  = fmtYen(totalClaw);

  const kRate = document.querySelector("#k_rate");
  kRate.textContent = fmtPct(costRate);
  kRate.setAttribute("style", rateStyleBySpec(costRate));

  // フィルタ状況
  document.querySelector("#k_filtered").textContent =
    `選択中: ${selected.size}/${RAW_BY_SYMBOL.length} 記号`;

  // ソート
  const sorted = filtered.slice().sort((a, b) => cmp(a, b, sortKey, sortDir));

  // テーブル描画
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
      <td><span style="${rateStyleBySpec(r.cost_rate)}">${fmtPct(r.cost_rate)}</span></td>
      <td>${r.count ?? ""}</td>
    `;
    tb.appendChild(tr);
  });

  syncChipsChecked();
}

function cmp(a, b, key, dir) {
  const s = (dir === "desc") ? -1 : 1;

  if (key === "symbol") {
    return s * String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""), "ja");
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

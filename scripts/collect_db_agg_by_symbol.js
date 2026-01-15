import fs from "fs";
import path from "path";
import https from "https";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error("Redirect with no location"));
        return resolve(fetchText(loc));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQ) {
      if (ch === '"' && next === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
      continue;
    }

    if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch === "\r") {}
    else cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function num(v) {
  const x = Number(String(v ?? "").replace(/[,円%]/g, "").trim());
  return Number.isFinite(x) ? x : 0;
}

async function main() {
  const url = process.env.DB_CSV_URL;
  if (!url) throw new Error("Missing DB_CSV_URL");

  console.log("[INFO] db fetch:", url);
  const csv = await fetchText(url);
  const rows = parseCSV(csv).filter(r => r.some(c => String(c ?? "").trim() !== ""));
  if (rows.length < 2) throw new Error("CSV too small");

  const header = rows[0].map(h => String(h ?? "").trim());
  const data = rows.slice(1);

  // DB列名は “完全一致” で探します（あなたが提示してくれたやつ）
  const idxSymbol = header.indexOf("記号");
  const idxSales  = header.indexOf("総売上");
  const idxClaw   = header.indexOf("消化額");

  if (idxSymbol < 0) throw new Error("Column '記号' not found");
  if (idxSales  < 0) throw new Error("Column '総売上' not found");
  if (idxClaw   < 0) throw new Error("Column '消化額' not found");

  const map = new Map(); // symbol -> {symbol, sales, claw, count}
  for (const r of data) {
    const sym = (String(r[idxSymbol] ?? "").trim() || "(未設定)");
    const sales = num(r[idxSales]);
    const claw  = num(r[idxClaw]);

    const cur = map.get(sym) || { symbol: sym, sales: 0, claw: 0, count: 0 };
    cur.sales += sales;
    cur.claw  += claw;
    cur.count += 1;
    map.set(sym, cur);
  }

  const bySymbol = Array.from(map.values()).map(o => {
    const cost_rate = o.sales ? (o.claw * 1.1) / o.sales : null;
    return { ...o, cost_rate };
  });

  const totalSales = bySymbol.reduce((a, r) => a + (r.sales || 0), 0);
  const totalClaw  = bySymbol.reduce((a, r) => a + (r.claw || 0), 0);

  const summary = {
    updated_at: new Date().toISOString(),
    total_sales: totalSales,
    total_claw: totalClaw,
    cost_rate: totalSales ? (totalClaw * 1.1) / totalSales : null
  };

  const outDir = path.join("docs", "data", "agg");
  ensureDir(outDir);

  fs.writeFileSync(path.join(outDir, "by_symbol.json"), JSON.stringify(bySymbol, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log("[OK] wrote docs/data/agg/by_symbol.json rows=", bySymbol.length);
  console.log("[OK] wrote docs/data/agg/summary.json");
}

main().catch((e) => {
  console.error("[ERROR]", e);
  process.exit(1);
});

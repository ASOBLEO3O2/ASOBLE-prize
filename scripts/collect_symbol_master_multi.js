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

// Google公開CSV向け：引用符・カンマ対応
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

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function main() {
  const url = process.env.SYMBOL_MASTER_CSV_URL;
  if (!url) {
    console.error("Missing SYMBOL_MASTER_CSV_URL");
    process.exit(1);
  }

  console.log("[INFO] fetch:", url);
  const csv = await fetchText(url);
  const rows = parseCSV(csv).filter(r => r.some(c => String(c ?? "").trim() !== ""));
  if (rows.length < 2) throw new Error("CSV too small");

  const header = rows[0].map(h => String(h ?? "").trim());
  const data = rows.slice(1);

  // 「○○記号 / ○○」のペア列を全部拾って辞書化
  const pairs = [];
  for (let i = 0; i < header.length - 1; i++) {
    const h1 = header[i];
    const h2 = header[i + 1];
    if (h1.endsWith("記号") && h2 && !h2.endsWith("記号")) {
      const label = h1.replace(/記号$/, ""); // 景品ジャンル記号 → 景品ジャンル
      pairs.push({ label, keyCol: i, valCol: i + 1 });
    }
  }
  if (!pairs.length) throw new Error("No '*記号' pairs found");

  const out = {};
  for (const p of pairs) out[p.label] = {};

  for (const r of data) {
    for (const p of pairs) {
      const k = String(r[p.keyCol] ?? "").trim();
      const v = String(r[p.valCol] ?? "").trim();
      if (!k) continue;
      if (out[p.label][k] == null) out[p.label][k] = v || "";
    }
  }

  const outDir = path.join("docs", "data", "master");
  ensureDir(outDir);
  const outPath = path.join(outDir, "symbol_master.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log("[OK] wrote", outPath, "labels=", Object.keys(out).length);
}

main().catch(e => {
  console.error("[ERROR]", e);
  process.exit(1);
});

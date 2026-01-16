// scripts/build_data.mjs
// Node18+ / GitHub Actions用（外部ライブラリなし）

const CSV_DB_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSYAO0VSIbTG2fa-9W2Jl1NuG9smC4BOfqNZWiwsb5IHEIYWgcUWgCe_SZTWBPrnFiodfIGdxvKe7Up/pub?gid=1317014562&single=true&output=csv";

const CSV_SYMBOL_MASTER_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSYAO0VSIbTG2fa-9W2Jl1NuG9smC4BOfqNZWiwsb5IHEIYWgcUWgCe_SZTWBPrnFiodfIGdxvKe7Up/pub?gid=369838476&single=true&output=csv";

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("docs", "data");
const OUT_RAW = path.join(OUT_DIR, "raw");
const OUT_MASTER = path.join(OUT_DIR, "master");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  return await res.text();
}

// 超簡易CSVパーサ（GoogleのCSV程度ならこれでOK）
// - ダブルクォート対応
function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;

  const s = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
      continue;
    }

    if (c === '"') {
      inQ = true;
      continue;
    }
    if (c === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += c;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

function toObjects(rows) {
  const header = rows[0].map((h) => (h ?? "").trim());
  const objs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const o = {};
    for (let j = 0; j < header.length; j++) {
      const k = header[j];
      if (!k) continue;
      o[k] = (r[j] ?? "").trim();
    }
    const any = Object.values(o).some((v) => v !== "");
    if (any) objs.push(o);
  }
  return { header, objs };
}

function num(x) {
  if (x == null) return 0;
  const n = Number(String(x).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// 列名ゆらぎ吸収：最初にヒットした列の値を返す
function pick(row, keys, fallback = "") {
  for (const k of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      if (v != null && String(v).trim() !== "") return v;
    }
  }
  return fallback;
}

// 更新日時を「日付だけ」にする
function toDateOnlyString(x) {
  const s0 = (x ?? "").toString().trim();
  if (!s0) return "";

  const m = s0.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mm = String(m[2]).padStart(2, "0");
    const dd = String(m[3]).padStart(2, "0");
    return `${y}/${mm}/${dd}`;
  }

  const d = new Date(s0);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}/${mm}/${dd}`;
}

/**
 * 記号解析
 */
const SYMBOL_SPEC = [
  { key: "料金", codeCol: "料金記号", valCol: "料金" },
  { key: "回数", codeCol: "回数記号", valCol: "プレイ回数" },
  { key: "投入法", codeCol: "投入法記号", valCol: "投入法" },
  { key: "3本爪", codeCol: "3本爪記号", valCol: "3本爪" },
  { key: "2本爪", codeCol: "2本爪記号", valCol: "2本爪" },
  { key: "景品ジャンル", codeCol: "景品ジャンル記号", valCol: "景品ジャンル" },
  { key: "食品ジャンル", codeCol: "食品記号", valCol: "食品ジャンル" },
  { key: "ぬいぐるみジャンル", codeCol: "ぬいぐるみ記号", valCol: "ぬいぐるみジャンル" },
  { key: "雑貨ジャンル", codeCol: "雑貨記号", valCol: "雑貨ジャンル" },
  { key: "ターゲット", codeCol: "ターゲット記号", valCol: "ターゲット" },
  { key: "年代", codeCol: "年代記号", valCol: "年代" },
  { key: "キャラ", codeCol: "キャラ記号", valCol: "キャラ" },
  { key: "キャラジャンル", codeCol: "キャラジャンル記号", valCol: "キャラジャンル" },
  { key: "ノンキャラジャンル", codeCol: "ノンキャラジャンル記号", valCol: "ノンキャラジャンル" },
  { key: "映画", codeCol: "映画記号", valCol: "映画" },
  { key: "予約", codeCol: "予約記号", valCol: "予約" },
  { key: "WLオリジナル", codeCol: "WLオリジナル記号", valCol: "WLオリジナル" },
];

function buildSymbolMaster(objs) {
  const master = {};
  for (const spec of SYMBOL_SPEC) master[spec.key] = {};

  for (const r of objs) {
    for (const spec of SYMBOL_SPEC) {
      const code = (r[spec.codeCol] ?? "").trim();
      const val = (r[spec.valCol] ?? "").trim();
      if (code && val) master[spec.key][code] = val;
    }
  }

  const meta = {};
  for (const spec of SYMBOL_SPEC) {
    const keys = Object.keys(master[spec.key] || {});
    keys.sort((a, b) => b.length - a.length);
    meta[spec.key] = { keys };
  }

  return { dict: master, meta, spec: SYMBOL_SPEC };
}

function parseSymbol(symbolStr, symbolMaster) {
  const s = (symbolStr ?? "").trim();
  const out = { raw: s };

  const tokens = s.split(/[^0-9A-Za-zぁ-んァ-ン一-龥]+/).filter(Boolean);

  let tokenHit = 0;
  if (tokens.length >= 2) {
    for (const spec of SYMBOL_SPEC) {
      const dict = symbolMaster.dict[spec.key] || {};
      const hit = tokens.find((t) => dict[t]);
      if (hit) {
        out[spec.key] = dict[hit];
        out[spec.key + "_code"] = hit;
        tokenHit++;
      }
    }
    if (tokenHit >= 2) return out;
  }

  let i = 0;
  for (const spec of SYMBOL_SPEC) {
    const dict = symbolMaster.dict[spec.key] || {};
    const keys = symbolMaster.meta[spec.key]?.keys || [];

    let found = "";
    for (const k of keys) {
      if (s.startsWith(k, i)) {
        found = k;
        break;
      }
    }
    if (found) {
      out[spec.key] = dict[found];
      out[spec.key + "_code"] = found;
      i += found.length;
    } else {
      out[spec.key] = "";
      out[spec.key + "_code"] = "";
    }
  }
  return out;
}

function buildRows(dbObjs, symbolMaster) {
  return dbObjs.map((r) => {
    const symbol = String(pick(r, ["記号", "symbol", "記号_raw", "記号ID"], "")).trim();
    const parsed = parseSymbol(symbol, symbolMaster);

    const sales = num(pick(r, ["総売上", "総売り上げ", "売上", "売上合計", "sales"], 0));
    const claw = num(pick(r, ["消化額", "消化金額", "原価", "claw"], 0));
    const costRate = sales ? (claw * 1.1) / sales : null;

    const consumeCount =
      num(pick(r, ["消化数", "消化回数", "消化", "回数", "プレイ回数", "plays", "count"], 0)) || 0;

    const updatedRaw = String(pick(r, ["更新日時", "更新日", "updated_at", "updatedAt"], "")).trim();
    const updatedDate = toDateOnlyString(updatedRaw);

    const boothId = String(pick(r, ["ブースID", "booth_id"], "")).trim();
    const itemName = String(pick(r, ["景品名", "item_name"], "")).trim();
    const labelId = String(pick(r, ["ラベルID", "label_id"], "")).trim();

    // 表示用：01/左/右を含む「フル表記」
    const machineName = String(
      pick(r, ["ブースID", "マシン名（ブースID）", "マシン名", "machine_name"], "")
    ).trim();

    // 集計用キー：H列「対応マシン名」
    const machineKey = String(
      pick(r, ["対応マシン名", "対応マシン", "machine_key", "machine_ref"], "")
    ).trim();

    return {
      machine_name: machineName,
      machine_key: machineKey,

      booth_id: boothId,
      item_name: itemName,
      label_id: labelId,

      w: num(pick(r, ["幅", "w"], 0)),
      d: num(pick(r, ["奥行き", "奥行", "d"], 0)),

      symbol_raw: symbol,
      consume_count: consumeCount,
      updated_date: updatedDate,

      sales,
      claw,
      cost_rate: costRate,

      ...parsed,
    };
  });
}

function summary(rows) {
  const totalSales = rows.reduce((a, r) => a + num(r.sales), 0);
  const totalClaw = rows.reduce((a, r) => a + num(r.claw), 0);
  const costRate = totalSales ? (totalClaw * 1.1) / totalSales : null;

  return {
    updated_at: new Date().toISOString(),
    row_count: rows.length,
    total_sales: totalSales,
    total

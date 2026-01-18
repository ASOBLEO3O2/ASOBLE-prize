import { GENRES } from "../constants.js";

// summary.cost_rate が total_claw*1.1/total_sales なので、それに揃える
export function calcCostRate(totalSales, totalClaw) {
  if (!totalSales) return 0;
  return (totalClaw * 1.1) / totalSales;
}

function normalizeGenre(g) {
  if (!g) return "未分類";
  // GENRESにあるもの以外は未分類扱い（将来増やすならここを拡張）
  const keys = new Set(GENRES.map(x => x.key));
  return keys.has(g) ? g : "未分類";
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDateStr(s) {
  // "2026/01/13" or "2026-01-13" を想定
  if (!s) return null;
  const t = String(s).replace(/\//g, "-");
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`; // ISO(yyyy-mm-dd)
}

export function buildViewModel(rows, summary) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const rowCount = toNum(summary?.row_count ?? safeRows.length);

  // 上部KPI
  const totalSales = toNum(summary?.total_sales);
  const totalClaw  = toNum(summary?.total_claw);
  const topCostRate = (summary?.cost_rate != null)
    ? Number(summary.cost_rate)
    : calcCostRate(totalSales, totalClaw);

  const avg = rowCount ? (totalSales / rowCount) : 0;

  // 更新日：rowsの updated_date の最大（なければ summary.updated_at）
  let updatedDate = null;
  for (const r of safeRows) {
    const d = parseDateStr(r?.updated_date);
    if (!d) continue;
    if (!updatedDate || d > updatedDate) updatedDate = d;
  }
  if (!updatedDate && summary?.updated_at) {
    // "2026-01-18T00:59:06.748Z" → "2026-01-18"
    const m = String(summary.updated_at).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) updatedDate = m[1];
  }

  // ジャンル別集計
  const init = {};
  for (const g of GENRES) {
    init[g.key] = { machines: 0, sales: 0, consume: 0, costRate: 0, salesShare: 0, machineShare: 0 };
  }

  const byGenre = structuredClone(init);

  // “台数” = rows件数（= booth/machine行）としてカウント（重複排除が必要なら後で調整）
  let machineTotal = 0;

  // details（ジャンルごと）
  const details = {};
  for (const g of GENRES) details[g.key] = [];

  for (const r of safeRows) {
    const genre = normalizeGenre(r?.["景品ジャンル"]);
    const sales = toNum(r?.sales);
    const claw  = toNum(r?.claw); // 消化額
    const cnt   = toNum(r?.consume_count);

    byGenre[genre].machines += 1;
    byGenre[genre].sales += sales;
    byGenre[genre].consume += claw;

    machineTotal += 1;

    details[genre].push({
      machine: r?.booth_id || r?.machine_name || "—",
      item: r?.item_name || "—",
      sales,
      consume: claw,
      count: cnt,
      costRate: calcCostRate(sales, claw),
      date: r?.updated_date || "",
    });
  }

  // costRate & shares
  const denomSales = totalSales || safeRows.reduce((a, r) => a + toNum(r?.sales), 0);
  const denomMachines = machineTotal || safeRows.length || 1;

  for (const g of GENRES) {
    const k = g.key;
    const s = byGenre[k].sales;
    const c = byGenre[k].consume;
    byGenre[k].costRate = calcCostRate(s, c);
    byGenre[k].salesShare = denomSales ? (s / denomSales) : 0;
    byGenre[k].machineShare = denomMachines ? (byGenre[k].machines / denomMachines) : 0;

    // 詳細は「売上降順」にしておく（UIの見やすさ）
    details[k].sort((a, b) => (b.sales || 0) - (a.sales || 0));
  }

  return {
    updatedDate: updatedDate || "",
    topKpi: {
      sales: totalSales || denomSales,
      consume: totalClaw || safeRows.reduce((a, r) => a + toNum(r?.claw), 0),
      costRate: topCostRate,
      avg,
    },
    byGenre,
    details,
    // filtersはStep Cで使うので器だけ持たせる
    filters: {},
  };
}

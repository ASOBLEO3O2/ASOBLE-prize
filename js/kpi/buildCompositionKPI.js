/*******************************************************
 * 構成KPI 集計（独立軸対応）
 *
 * 入力: rows[]  … ブース単位の配列（あなたの rows.json 相当）
 * 出力: [{axis_type, axis_value, sales, sales_ratio, booth_count, booth_ratio, plays, plays_ratio, avg_price}]
 *
 * 仕様:
 * - 軸は独立。混ぜるのは呼び出し側（クロス集計は別途）
 * - 構成KPIは「事実の比率」だけ。評価/色付けはしない
 * - 料金・回数: plays が無い場合は 0 扱い（比率は総回数>0の時だけ有効）
 *******************************************************/

/** 数値の安全変換 */
function toNum(v, def = 0) {
  const n = (typeof v === "number") ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}

/** 料金帯の正規化（price or price_band を吸収） */
function normalizePriceBand(row) {
  const band = row.price_band ?? row.priceBand ?? row.料金帯;
  if (band != null && String(band).trim() !== "") return String(band).trim();

  const price = row.price ?? row.fee ?? row.料金 ?? row.play_price;
  const p = toNum(price, NaN);
  if (!Number.isFinite(p)) return null;
  if (p <= 100) return "100円";
  if (p <= 200) return "200円";
  return "300円以上";
}

/** 運用方式の正規化 */
function normalizeMethod(row) {
  const m = row.method ?? row.claw ?? row.方式 ?? row.爪 ?? row.投入法;
  if (m == null) return null;
  const s = String(m).trim();
  if (!s) return null;
  // 表記揺れ吸収（必要なら追加）
  if (s.includes("3")) return "3本爪";
  if (s.includes("2")) return "2本爪";
  if (s.includes("投入")) return "投入法";
  return s;
}

/** キャラ属性の正規化（true/false or "キャラ"/"ノンキャラ"） */
function normalizeCharacter(row) {
  const v = row.character ?? row.is_character ?? row.キャラ属性 ?? row.キャラ ?? row.char;
  if (v === true) return "キャラ";
  if (v === false) return "ノンキャラ";
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === "キャラ") return "キャラ";
  if (s === "ノンキャラ") return "ノンキャラ";
  // "true"/"false" も吸収
  if (s.toLowerCase() === "true") return "キャラ";
  if (s.toLowerCase() === "false") return "ノンキャラ";
  return s; // それ以外の表記もそのまま
}

/** フラグの正規化（row.flags か個別列を吸収） */
function normalizeFlags(row) {
  const f = row.flags ?? {};
  const reservation = (row.reservation ?? row.is_reservation ?? row.予約景品 ?? f.reservation) ? true : false;
  const movie       = (row.movie ?? row.is_movie ?? row.映画関連 ?? row.映画関連景品 ?? f.movie) ? true : false;
  const original    = (row.original ?? row.is_original ?? row.オリジナル ?? row.オリジナル景品 ?? f.original) ? true : false;
  return { reservation, movie, original };
}

/** 軸値取得（ここだけ差し替えれば列名変更に追従できる） */
function getAxisValue(row, axisType) {
  switch (axisType) {
    case "genre": {
      const g = row.genre ?? row.ジャンル ?? row.景品ジャンル;
      return (g == null || String(g).trim() === "") ? null : String(g).trim();
    }
    case "size": {
      const s = row.size ?? row.サイズ;
      return (s == null || String(s).trim() === "") ? null : String(s).trim();
    }
    case "target": {
      const t = row.target ?? row.ターゲット;
      return (t == null || String(t).trim() === "") ? null : String(t).trim();
    }
    case "character": {
      return normalizeCharacter(row); // "キャラ"/"ノンキャラ"
    }
    case "method": {
      return normalizeMethod(row); // "3本爪"/"2本爪"/"投入法"
    }
    case "price_band": {
      return normalizePriceBand(row); // "100円"/"200円"/"300円以上"
    }
    case "flag": {
      // flag_value は options.flagKey で指定（reservation/movie/original）
      // ここでは値を返さず、後段でフィルタとして扱う
      return null;
    }
    default:
      return null;
  }
}

/**
 * rows を構成KPIに集計
 *
 * @param {Array<Object>} rows
 * @param {Object} options
 * @param {"genre"|"size"|"target"|"character"|"method"|"price_band"|"flag"} options.axisType
 * @param {Object} [options.filter] 任意フィルタ（軸を混ぜるのは表示側、ここは「絞り込み」用途）
 * @param {string|null} [options.filter.genre]
 * @param {string|null} [options.filter.size]
 * @param {string|null} [options.filter.target]
 * @param {string|null} [options.filter.character]  "キャラ"/"ノンキャラ"
 * @param {string|null} [options.filter.method]
 * @param {string|null} [options.filter.price_band]
 * @param {Object} [options.filter.flags] {reservation?:boolean, movie?:boolean, original?:boolean}
 * @param {"reservation"|"movie"|"original"} [options.flagKey] axisType="flag" のとき必須
 * @param {boolean} [options.includeUnknown=false] 軸値がnullのものを "(不明)" として含めるか
 * @returns {Array<Object>}
 */
function buildCompositionKPI(rows, options) {
  const {
    axisType,
    filter = {},
    flagKey = null,
    includeUnknown = false
  } = options || {};

  if (!axisType) throw new Error("options.axisType is required");

  // 1) 行フィルタ（絞り込み）
  const filtered = rows.filter((row) => {
    // flags
    const flags = normalizeFlags(row);
    if (filter.flags) {
      for (const k of ["reservation", "movie", "original"]) {
        if (typeof filter.flags[k] === "boolean" && flags[k] !== filter.flags[k]) return false;
      }
    }

    // 軸系フィルタ（null/空は無視）
    const checks = ["genre", "size", "target", "character", "method", "price_band"];
    for (const t of checks) {
      const want = filter[t];
      if (want == null || String(want).trim() === "") continue;

      let got;
      if (t === "character") got = normalizeCharacter(row);
      else if (t === "method") got = normalizeMethod(row);
      else if (t === "price_band") got = normalizePriceBand(row);
      else got = getAxisValue(row, t);

      if (got !== String(want).trim()) return false;
    }

    // axisType="flag" の場合、ここで flagKey の true/false を切る用途が多い
    if (axisType === "flag") {
      if (!flagKey) throw new Error("axisType='flag' requires options.flagKey (reservation/movie/original)");
      // flagの集計は「ON/OFF比較」したいのでフィルタはかけないのが基本。
      // もし filter.flags で絞ってしまうと比較できないので注意。
    }

    return true;
  });

  // 2) 全体合計（分母）
  const totalSales = filtered.reduce((a, r) => a + toNum(r.sales ?? r.売上 ?? r.総売上, 0), 0);
  const totalBooths = filtered.length;
  const totalPlays = filtered.reduce((a, r) => a + toNum(r.plays ?? r.play_count ?? r.回数 ?? r.プレイ回数, 0), 0);

  // 3) グルーピング
  const map = new Map();

  for (const row of filtered) {
    const sales = toNum(row.sales ?? row.売上 ?? row.総売上, 0);
    const plays = toNum(row.plays ?? row.play_count ?? row.回数 ?? row.プレイ回数, 0);
    const priceBand = normalizePriceBand(row);

    let key;
    if (axisType === "flag") {
      const flags = normalizeFlags(row);
      const on = flags[flagKey] === true;
      key = on ? `${flagKey}:ON` : `${flagKey}:OFF`;
    } else {
      const v = getAxisValue(row, axisType);
      if (v == null) {
        if (!includeUnknown) continue;
        key = "(不明)";
      } else {
        key = v;
      }
    }

    if (!map.has(key)) {
      map.set(key, {
        axis_type: axisType,
        axis_value: key,
        sales: 0,
        booth_count: 0,
        plays: 0,
        // 参考: 料金帯分布を見たい時用（今は未使用。必要なら可視化に使える）
        _priceBands: new Map()
      });
    }

    const agg = map.get(key);
    agg.sales += sales;
    agg.booth_count += 1;
    agg.plays += plays;

    if (priceBand) {
      agg._priceBands.set(priceBand, (agg._priceBands.get(priceBand) || 0) + 1);
    }
  }

  // 4) 出力整形（比率・平均料金）
  const out = Array.from(map.values()).map((d) => {
    const sales_ratio = totalSales > 0 ? d.sales / totalSales : 0;
    const booth_ratio = totalBooths > 0 ? d.booth_count / totalBooths : 0;
    const plays_ratio = totalPlays > 0 ? d.plays / totalPlays : 0;
    const avg_price = d.plays > 0 ? d.sales / d.plays : null;

    return {
      axis_type: d.axis_type,
      axis_value: d.axis_value,
      sales: d.sales,
      sales_ratio,
      booth_count: d.booth_count,
      booth_ratio,
      plays: d.plays,
      plays_ratio,
      avg_price
    };
  });

  // 5) デフォルト並び（売上降順）
  out.sort((a, b) => (b.sales - a.sales));

  return out;
}

/** 使い方サンプル（rows を用意して実行） */
function exampleUsage(rows) {
  // ジャンル別構成
  const byGenre = buildCompositionKPI(rows, { axisType: "genre" });

  // ターゲット別構成（例：食品だけに絞る）
  const byTargetInFood = buildCompositionKPI(rows, {
    axisType: "target",
    filter: { genre: "食品" }
  });

  // 予約景品フラグ（ON/OFF比較）
  const reservationOnOff = buildCompositionKPI(rows, {
    axisType: "flag",
    flagKey: "reservation"
  });

  return { byGenre, byTargetInFood, reservationOnOff };
}

// export { buildCompositionKPI, exampleUsage }; // Nodeで使うなら

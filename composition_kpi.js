/******************************************************
 * composition_kpi.js（非module版）
 * - app.js を壊さずに「③構成KPI」を追加する
 * - window.CompositionKPI を提供
 ******************************************************/

(function () {
  const fmtYen = (n) => n == null ? "-" : new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";
  const fmtPct = (v) => v == null ? "-" : (v * 100).toFixed(1) + "%";

  function num(v) {
    const n = Number(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function text(v) {
    const s = (v ?? "").toString().trim();
    return s ? s : null;
  }

  function normalizeCharacter(r) {
    const v = r["キャラ属性"] ?? r["キャラ"] ?? r.character ?? r.is_character;
    if (v === true) return "キャラ";
    if (v === false) return "ノンキャラ";
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (s === "キャラ") return "キャラ";
    if (s === "ノンキャラ") return "ノンキャラ";
    if (s.toLowerCase() === "true") return "キャラ";
    if (s.toLowerCase() === "false") return "ノンキャラ";
    return s;
  }

  function normalizeMethod(r) {
    // 投入法（意味寄せは app.js 側に normalizeByMaster があるが、ここではそのまま）
    const v = r["投入法"] ?? r.method ?? r.claw_method;
    return text(v);
  }

  function normalizePriceBand(r) {
    const band = r["料金帯"] ?? r.price_band ?? r.priceBand;
    if (band != null && String(band).trim() !== "") return String(band).trim();

    const price = r["料金"] ?? r.price ?? r.fee;
    const p = num(price);
    if (!p) return null;
    if (p <= 100) return "100円";
    if (p <= 200) return "200円";
    return "300円以上";
  }

  function normalizeFlags(r) {
    const f = r.flags ?? {};
    const reservation = (r["予約景品"] ?? r.reservation ?? f.reservation) ? true : false;
    const movie       = (r["映画関連景品"] ?? r.movie ?? f.movie) ? true : false;
    const original    = (r["オリジナル景品"] ?? r.original ?? f.original) ? true : false;
    return { reservation, movie, original };
  }

  function getAxisValue(r, axisType) {
    switch (axisType) {
      case "genre":
        return text(r["ジャンル"] ?? r["景品ジャンル"] ?? r.genre);
      case "size":
        return text(r["サイズ"] ?? r.size);
      case "target":
        return text(r["ターゲット"] ?? r.target);
      case "character":
        return normalizeCharacter(r);
      case "method":
        return normalizeMethod(r);
      case "price_band":
        return normalizePriceBand(r);
      default:
        return null;
    }
  }

  function buildCompositionKPI(rows, opts) {
    const axisType = opts.axisType;
    const includeUnknown = !!opts.includeUnknown;
    const flagKey = opts.flagKey; // axisType="flag" のとき reservation/movie/original

    const totalSales = rows.reduce((a, r) => a + num(r.sales), 0);
    const totalBooths = rows.length;
    const totalPlays = rows.reduce((a, r) => a + num(r.plays ?? r["回数"] ?? r["プレイ回数"]), 0);

    const map = new Map();

    for (const r of rows) {
      const sales = num(r.sales);
      const plays = num(r.plays ?? r["回数"] ?? r["プレイ回数"]);

      let key;
      if (axisType === "flag") {
        const flags = normalizeFlags(r);
        const on = flags[flagKey] === true;
        key = on ? `${flagKey}:ON` : `${flagKey}:OFF`;
      } else {
        const v = getAxisValue(r, axisType);
        if (v == null) {
          if (!includeUnknown) continue;
          key = "(不明)";
        } else {
          key = v;
        }
      }

      if (!map.has(key)) map.set(key, { axis_value: key, sales: 0, booth_count: 0, plays: 0 });
      const agg = map.get(key);
      agg.sales += sales;
      agg.booth_count += 1;
      agg.plays += plays;
    }

    const out = Array.from(map.values()).map(d => {
      const sales_ratio = totalSales > 0 ? d.sales / totalSales : 0;
      const booth_ratio = totalBooths > 0 ? d.booth_count / totalBooths : 0;
      const plays_ratio = totalPlays > 0 ? d.plays / totalPlays : 0;
      const avg_price = d.plays > 0 ? d.sales / d.plays : null;

      return {
        axis_type: axisType,
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

    out.sort((a, b) => b.sales - a.sales);
    return out;
  }

  // UI
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function barRow(label, ratio, rightText) {
    const row = el("div", "kpi-row");
    row.appendChild(el("div", "kpi-row-label", label));

    const track = el("div", "kpi-bar-track");
    const fill = el("div", "kpi-bar-fill");
    const w = Math.max(0, Math.min(100, (Number.isFinite(ratio) ? ratio : 0) * 100));
    fill.style.width = `${w}%`;
    track.appendChild(fill);

    row.appendChild(track);
    row.appendChild(el("div", "kpi-row-right", rightText));
    return row;
  }

  function render(items, mountEl) {
    mountEl.innerHTML = "";

    if (!items || items.length === 0) {
      mountEl.appendChild(el("div", "empty", "表示できるデータがありません"));
      return;
    }

    const list = el("div", "kpi-list");
    for (const it of items) {
      const card = el("div", "kpi-card");

      const head = el("div", "kpi-head");
      head.appendChild(el("div", "kpi-title", it.axis_value));
      head.appendChild(el("div", "kpi-sub", `売上 ${fmtYen(it.sales)} / 台数 ${it.booth_count} / 回数 ${Math.round(it.plays ?? 0)}`));

      const rows = el("div", "kpi-rows");
      rows.appendChild(barRow("売上", it.sales_ratio, fmtPct(it.sales_ratio)));
      rows.appendChild(barRow("台数", it.booth_ratio, fmtPct(it.booth_ratio)));
      rows.appendChild(barRow("回数", it.plays_ratio, fmtPct(it.plays_ratio)));

      const foot = el("div", "kpi-foot");
      foot.appendChild(el("div", "kpi-foot-item", "平均料金"));
      foot.appendChild(el("div", "kpi-foot-value", fmtYen(it.avg_price)));

      card.appendChild(head);
      card.appendChild(rows);
      card.appendChild(foot);
      list.appendChild(card);
    }

    mountEl.appendChild(list);
  }

  function mount({ mountEl, getRows }) {
    mountEl.innerHTML = "";

    // controls
    const top = el("div", "panelHead");
    top.innerHTML = `<h2>③ 構成KPI</h2><div class="muted">売上/台数/回数の構成比</div>`;

    const ctrl = el("div", "filters");
    const row = el("div", "row");

    const axisSel = document.createElement("select");
    axisSel.className = "ctl";
    axisSel.innerHTML = `
      <option value="genre">ジャンル</option>
      <option value="target">ターゲット</option>
      <option value="character">キャラ属性</option>
      <option value="method">運用方式</option>
      <option value="price_band">料金帯</option>
      <option value="flag">フラグ(ON/OFF)</option>
    `;

    const flagSel = document.createElement("select");
    flagSel.className = "ctl";
    flagSel.innerHTML = `
      <option value="reservation">予約</option>
      <option value="movie">映画</option>
      <option value="original">オリジナル</option>
    `;
    flagSel.disabled = true;

    const chk = document.createElement("label");
    chk.className = "chk";
    chk.innerHTML = `<input type="checkbox">不明も含める`;
    const includeUnknownInput = chk.querySelector("input");

    row.appendChild(axisSel);
    row.appendChild(flagSel);
    row.appendChild(chk);
    ctrl.appendChild(row);

    const body = el("div", "panel-body");

    mountEl.appendChild(top);
    mountEl.appendChild(ctrl);
    mountEl.appendChild(body);

    function refresh() {
      const rowsNow = (typeof getRows === "function") ? getRows() : [];
      const axisType = axisSel.value;

      const opts = { axisType, includeUnknown: includeUnknownInput.checked };
      if (axisType === "flag") opts.flagKey = flagSel.value;

      const items = buildCompositionKPI(rowsNow, opts);
      render(items, body);
    }

    axisSel.addEventListener("change", () => {
      flagSel.disabled = axisSel.value !== "flag";
      refresh();
    });
    flagSel.addEventListener("change", refresh);
    includeUnknownInput.addEventListener("change", refresh);

    refresh();

    return { refresh };
  }

  // 公開
  window.CompositionKPI = {
    mount,
    _buildCompositionKPI: buildCompositionKPI, // デバッグ用
  };
})();

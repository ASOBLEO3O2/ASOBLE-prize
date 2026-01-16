const fmtYen = (n) =>
  n == null || !Number.isFinite(n) ? "-" :
  new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "円";

const fmtPct = (v) =>
  v == null || !Number.isFinite(v) ? "-" :
  (v * 100).toFixed(1) + "%";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function barRow(label, ratio, rightText) {
  const row = el("div", { class: "kpi-row" });
  row.appendChild(el("div", { class: "kpi-row-label" }, [label]));
  const track = el("div", { class: "kpi-bar-track" });
  const fill = el("div", { class: "kpi-bar-fill" });
  const w = Math.max(0, Math.min(100, (Number.isFinite(ratio) ? ratio : 0) * 100));
  fill.style.width = `${w}%`;
  track.appendChild(fill);
  row.appendChild(track);
  row.appendChild(el("div", { class: "kpi-row-right" }, [rightText]));
  return row;
}

export function renderComposition(items, mountEl) {
  mountEl.innerHTML = "";

  if (!items || items.length === 0) {
    mountEl.appendChild(el("div", { class: "empty" }, ["表示できるデータがありません"]));
    return;
  }

  const list = el("div", { class: "kpi-list" });

  for (const it of items) {
    const head = el("div", { class: "kpi-head" }, [
      el("div", { class: "kpi-title" }, [it.axis_value]),
      el("div", { class: "kpi-sub" }, [
        `売上 ${fmtYen(it.sales)} / 台数 ${it.booth_count} / 回数 ${Math.round(it.plays ?? 0)}`
      ]),
    ]);

    const rows = el("div", { class: "kpi-rows" }, [
      barRow("売上", it.sales_ratio, fmtPct(it.sales_ratio)),
      barRow("台数", it.booth_ratio, fmtPct(it.booth_ratio)),
      barRow("回数", it.plays_ratio, fmtPct(it.plays_ratio)),
    ]);

    const foot = el("div", { class: "kpi-foot" }, [
      el("div", { class: "kpi-foot-item" }, ["平均料金"]),
      el("div", { class: "kpi-foot-value" }, [fmtYen(it.avg_price)]),
    ]);

    const card = el("div", { class: "kpi-card" }, [head, rows, foot]);
    list.appendChild(card);
  }

  mountEl.appendChild(list);
}

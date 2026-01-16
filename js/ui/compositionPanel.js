import { buildCompositionKPI } from "../kpi/buildCompositionKPI.js";
import { renderComposition } from "./renderComposition.js";

const AXES = [
  { key: "genre", label: "ジャンル" },
  { key: "target", label: "ターゲット" },
  { key: "character", label: "キャラ属性" },
  { key: "method", label: "運用方式" },
  { key: "price_band", label: "料金帯" },
  { key: "flag", label: "フラグ(ON/OFF)" },
];

const FLAGS = [
  { key: "reservation", label: "予約" },
  { key: "movie", label: "映画" },
  { key: "original", label: "オリジナル" },
];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

// rows は app.js 側で読み込んだものを使う（重複fetchしない）
export function mountCompositionPanel({ getRows, subscribe, mountEl }) {
  mountEl.innerHTML = "";

  const axisSel = el("select", { class: "ctl" });
  for (const a of AXES) axisSel.appendChild(el("option", { value: a.key }, [a.label]));

  const flagSel = el("select", { class: "ctl" });
  for (const f of FLAGS) flagSel.appendChild(el("option", { value: f.key }, [f.label]));
  flagSel.disabled = true;

  const includeUnknown = el("label", { class: "chk" }, [
    el("input", { type: "checkbox" }),
    "不明も含める"
  ]);
  const includeUnknownInput = includeUnknown.querySelector("input");

  const top = el("div", { class: "panel-top" }, [
    el("div", { class: "panel-title" }, ["③ 構成KPI"]),
    el("div", { class: "panel-ctls" }, [
      el("div", { class: "ctl-group" }, [el("div", { class: "ctl-label" }, ["軸"]), axisSel]),
      el("div", { class: "ctl-group" }, [el("div", { class: "ctl-label" }, ["フラグ種別"]), flagSel]),
      includeUnknown,
    ]),
  ]);

  const body = el("div", { class: "panel-body" });

  mountEl.appendChild(top);
  mountEl.appendChild(body);

  function refresh() {
    const rows = (typeof getRows === "function") ? getRows() : [];
    const axisType = axisSel.value;

    const opts = {
      axisType,
      includeUnknown: includeUnknownInput.checked,
    };
    if (axisType === "flag") opts.flagKey = flagSel.value;

    const items = buildCompositionKPI(rows, opts);
    renderComposition(items, body);
  }

  axisSel.addEventListener("change", () => {
    flagSel.disabled = axisSel.value !== "flag";
    refresh();
  });
  flagSel.addEventListener("change", refresh);
  includeUnknownInput.addEventListener("change", refresh);

  // app.js 側（投入法切替/初回ロード）から通知を受けたら更新
  if (typeof subscribe === "function") {
    subscribe(() => refresh());
  }

  refresh();
}

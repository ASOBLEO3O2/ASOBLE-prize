import { loadRows } from "./data/loadRows.js";
import { mountCompositionPanel } from "./ui/compositionPanel.js";

async function init() {
  const rows = await loadRows();

  const mountEl = document.getElementById("composition");
  if (!mountEl) {
    console.warn("[WARN] #composition が見つかりません。index.htmlに <div id='composition'></div> を追加してください。");
    return;
  }

  mountCompositionPanel({ rows, mountEl });
}

init();

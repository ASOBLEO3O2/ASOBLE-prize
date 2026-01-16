import { loadRows } from "./data/loadRows.js";
import { buildCompositionKPI } from "./kpi/buildCompositionKPI.js";

async function init() {
  const rows = await loadRows();

  const byGenre = buildCompositionKPI(rows, {
    axisType: "genre"
  });

  console.log(byGenre); // ← まずここで確認
}

init();

export async function loadRawData() {
  const bust = `v=${Date.now()}`;

  const [rowsRes, sumRes] = await Promise.all([
    fetch(`./data/raw/rows.json?${bust}`, { cache: "no-store" }),
    fetch(`./data/raw/summary.json?${bust}`, { cache: "no-store" }),
  ]);

  if (!rowsRes.ok) throw new Error(`rows.json load failed: ${rowsRes.status}`);
  if (!sumRes.ok) throw new Error(`summary.json load failed: ${sumRes.status}`);

  const rows = await rowsRes.json();
  const summary = await sumRes.json();

  return { rows, summary };
}

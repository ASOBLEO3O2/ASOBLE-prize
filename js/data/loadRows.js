export async function loadRows() {
  const res = await fetch("./data/raw/rows.json");
  return await res.json();
}

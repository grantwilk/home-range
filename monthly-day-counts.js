// The 51 daily-high and 121 daily-low cutoffs share one download per
// calendar month. Annual day counts already live in the base climate file.
const requests = new Map();

async function readDayMonth(month) {
  const file = String(month + 1).padStart(2, "0");
  const response = await fetch(
    new URL("./data/monthly-days/" + file + ".json.gz", import.meta.url),
  );
  if (!response.ok)
    throw new Error("The monthly hot and cold day counts could not be loaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const stream = new Blob([bytes]).stream();
  // Some static hosts have already applied HTTP gzip decoding.
  const decoded =
    bytes[0] === 31 && bytes[1] === 139
      ? stream.pipeThrough(new DecompressionStream("gzip"))
      : stream;
  const data = await new Response(decoded).json();
  if (data.month !== month + 1 || !data.counties)
    throw new Error("Unexpected calendar month in the day-count data.");
  return data.counties;
}

export async function loadDayMonth(month, places) {
  if (!requests.has(month)) {
    requests.set(
      month,
      readDayMonth(month).catch((error) => {
        requests.delete(month);
        throw error;
      }),
    );
  }
  const table = await requests.get(month);
  for (const { id, values } of places) {
    const counts = table[id];
    if (!counts) continue;
    (values.monthlyHeatDays ??= [])[month] = counts[0];
    (values.monthlyColdDays ??= [])[month] = counts[1];
  }
}

import { filterId, layers, metricName, viewedId } from "./model.js";
import { referenceSymbols } from "./map-reference.js";

export function openExportOptions({ state, showDialog, onExport }) {
  const pointKeys = [
    ...new Set(
      state.county
        .filter((f) => f.on && Object.hasOwn(referenceSymbols, f.key))
        .map((f) => f.key),
    ),
  ];
  const checkboxes = pointKeys
    .map((key) => {
      const { d, color, label } = referenceSymbols[key];
      return `<label class="pdf-symbol">
        <input type="checkbox" name="symbols" value="${key}" checked>
        <svg aria-hidden="true" viewBox="-8 -8 16 16" width="16" height="16"><path d="${d}" fill="${color}"/></svg>
        <span>${label}</span>
      </label>`;
    })
    .join("");
  showDialog(
    "Export Map PDF",
    `<form id="pdf-options">
      <fieldset><legend>Map Area</legend>
        <div class="pdf-extent">
          <label><input type="radio" name="extent" value="current" checked>Current View</label>
          <label><input type="radio" name="extent" value="national">Whole Country</label>
        </div>
      </fieldset>
      <div><label class="pdf-label" for="pdf-layer">Map Coloring</label>
        <select id="pdf-layer" class="searchinput" name="layer"><option value="solid">Solid Color</option></select>
      </div>
      <fieldset><legend>Place Symbols</legend>
        ${pointKeys.length ? `<div class="pdf-symbols">${checkboxes}</div>` : ""}
        <div class="pdf-note">Cities and towns are always labeled.${pointKeys.length ? "" : " Enable a place filter to include its symbols."}</div>
      </fieldset>
      <div class="pdf-feedback" role="status" aria-live="polite"></div>
      <div class="pdf-actions">
        <button type="button" class="secondary" id="pdf-cancel">Cancel</button>
        <button type="submit" id="pdf-download">Download PDF</button>
      </div>
    </form>`,
  );

  const form = document.getElementById("pdf-options");
  const dialog = form.closest("dialog");
  const layer = form.elements.layer;
  for (const f of state.county) {
    let label = metricName(f.key, f.cutoff);
    if (state.county.some((other) => other !== f && other.key === f.key)) {
      if (f.key === "cities")
        label += ` · ${f.citySize.min.toLocaleString("en-US")}–${f.citySize.max.toLocaleString("en-US")} residents`;
      else if (f.key === "custom")
        label += ` · ${f.points[0]?.[0] ?? "Empty list"}${f.points.length > 1 ? ` (+${f.points.length - 1})` : ""}`;
      else label += ` · ${f.min}–${f.max} ${layers[f.key].unit}`;
    }
    layer.add(new Option(label, filterId(f)));
  }
  layer.value = viewedId(state) ?? "solid";

  const submit = form.querySelector("#pdf-download");
  const feedback = form.querySelector(".pdf-feedback");
  let job;
  const cancel = () => job?.abort();
  dialog.addEventListener("cancel", cancel);
  dialog.addEventListener(
    "close",
    () => {
      cancel();
      dialog.removeEventListener("cancel", cancel);
    },
    { once: true },
  );
  form.querySelector("#pdf-cancel").onclick = () => {
    cancel();
    dialog.close();
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (job) return;
    const data = new FormData(form);
    const settings = {
      extent: data.get("extent"),
      layer: layer.value === "solid" ? null : layer.value,
      symbols: data.getAll("symbols"),
    };
    job = new AbortController();
    const { signal } = job;
    const controls = form.querySelectorAll(
      "fieldset,select,button[type=submit]",
    );
    for (const control of controls) control.disabled = true;
    feedback.textContent = "Preparing your map…";
    submit.textContent = "Exporting…";
    try {
      await onExport(settings, signal);
      if (!signal.aborted && dialog.open && form.isConnected) dialog.close();
    } catch (error) {
      if (signal.aborted || !dialog.open || !form.isConnected) return;
      feedback.textContent =
        error?.message ||
        "The PDF could not be prepared. Try downloading again.";
      for (const control of controls) control.disabled = false;
      submit.textContent = "Download PDF";
      submit.focus();
    } finally {
      job = null;
    }
  };
}

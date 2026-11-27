// Render the chosen extent independently so printing never moves the user's map.
export async function downloadPdfFrame(job, signal) {
  signal.throwIfAborted();
  const frame = document.createElement("iframe");
  frame.className = "pdf-render-frame";
  frame.inert = true;
  frame.setAttribute("aria-hidden", "true");
  frame.title = "Print map";
  const scale = 1055 / Math.max(job.bounds.width, job.bounds.height);
  frame.style.width = Math.max(1, Math.round(scale * job.bounds.width)) + "px";
  frame.style.height =
    Math.max(1, Math.round(scale * job.bounds.height)) + "px";
  frame.src = location.pathname;
  let timer, abort;
  try {
    const { blob, filename } = await new Promise((resolve, reject) => {
      frame.homeRangePdfJob = { ...job, resolve, reject };
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      frame.onerror = () =>
        reject(new Error("The print map could not load. Please try again."));
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "The map took too long to export. Try a smaller area or fewer filters.",
            ),
          ),
        180000,
      );
      document.body.append(frame);
    });
    signal.throwIfAborted();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    frame.remove();
  }
}

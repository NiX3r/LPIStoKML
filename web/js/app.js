(function () {
  "use strict";

  const form = document.getElementById("convert-form");
  const zipInput = document.getElementById("zip-input");
  const uploadZone = document.getElementById("upload-zone");
  const fileNameEl = document.getElementById("file-name");
  const submitBtn = document.getElementById("submit-btn");
  const errorMsg = document.getElementById("error-msg");
  const successMsg = document.getElementById("success-msg");
  const loading = document.getElementById("loading");
  const preview = document.getElementById("preview");
  const previewMap = document.getElementById("preview-map");
  const previewSub = document.getElementById("preview-sub");

  // Drag & drop visual feedback
  uploadZone.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
  uploadZone.addEventListener("drop", e => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) {
      zipInput.files = e.dataTransfer.files;
      showFileNames();
    }
  });

  zipInput.addEventListener("change", showFileNames);

  function showFileNames() {
    fileNameEl.textContent = Array.from(zipInput.files, f => "✓ " + f.name).join("\n");
  }

  function setLoading(on) {
    loading.classList.toggle("show", on);
    submitBtn.disabled = on;
  }

  function showError(text) {
    errorMsg.textContent = text;
    errorMsg.classList.add("show");
    successMsg.classList.remove("show");
  }

  function showSuccess(text) {
    successMsg.textContent = text;
    successMsg.classList.add("show");
    errorMsg.classList.remove("show");
  }

  function download(text, fileName) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/vnd.google-earth.kml+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Simple outline map of the exported blocks (equirectangular, no basemap).
  function renderPreview(blocks) {
    const W = 600, PAD = 24;
    const rings = blocks.flatMap(b => b.polygons.flatMap(p => [p.outer, ...p.holes]));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rings.forEach(r => r.forEach(([x, y]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }));
    const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
    const w = Math.max((maxX - minX) * kx, 1e-9), h = Math.max(maxY - minY, 1e-9);
    const scale = Math.min((W - 2 * PAD) / w, (W * 0.75 - 2 * PAD) / h);
    const H = Math.round(h * scale + 2 * PAD);
    const ox = (W - w * scale) / 2;
    const px = ([x, y]) => [ox + (x - minX) * kx * scale, PAD + (maxY - y) * scale];
    const d = r => "M" + r.map(c => px(c).map(v => v.toFixed(1)).join(",")).join("L") + "Z";

    previewMap.setAttribute("viewBox", `0 0 ${W} ${H}`);
    previewMap.replaceChildren();
    const ns = "http://www.w3.org/2000/svg";
    const labels = [];
    blocks.forEach(b => b.polygons.forEach(p => {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", [p.outer, ...p.holes].map(d).join(""));
      const title = document.createElementNS(ns, "title");
      title.textContent = b.name;
      path.appendChild(title);
      previewMap.appendChild(path);
    }));
    // One label per block, at the centre of its largest part.
    blocks.forEach(b => {
      const box = b.polygons.map(p => {
        const pts = p.outer.map(px);
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }).sort((a, c) => (c[2] - c[0]) * (c[3] - c[1]) - (a[2] - a[0]) * (a[3] - a[1]))[0];
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", ((box[0] + box[2]) / 2).toFixed(1));
      text.setAttribute("y", ((box[1] + box[3]) / 2).toFixed(1));
      text.textContent = b.name;
      labels.push(text);
    });
    labels.forEach(t => previewMap.appendChild(t));
    preview.hidden = false;
  }

  function blockWord(n) {
    return n === 1 ? "půdní blok" : n >= 2 && n <= 4 ? "půdní bloky" : "půdních bloků";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.classList.remove("show");
    successMsg.classList.remove("show");

    if (!zipInput.files.length) { showError("Vyberte ZIP soubor."); return; }
    const idUz = document.getElementById("id_uz").value.trim();
    if (!idUz) { showError("Zadejte ID_UZ."); return; }

    setLoading(true);
    try {
      const zips = await Promise.all(Array.from(zipInput.files, async f => new Uint8Array(await f.arrayBuffer())));
      // Let the spinner paint before the (synchronous) heavy lifting.
      await new Promise(r => setTimeout(r, 30));
      const result = LPIS.convert(zips, {
        idUz,
        outputName: document.getElementById("output_name").value,
        blockNumber: document.getElementById("block_number").value,
      });
      download(result.kml, result.fileName);
      const n = result.blocks.length;
      showSuccess(`✓ Hotovo! Exportováno ${n} ${blockWord(n)} → ${result.fileName}`);
      previewSub.textContent = `ID_UZ ${idUz} · ${n} ${blockWord(n)}`;
      renderPreview(result.blocks);
    } catch (err) {
      preview.hidden = true;
      if (err instanceof LPIS.LpisError) showError(err.message);
      else { console.error(err); showError("Chyba při zpracování: " + (err && err.message || err)); }
    } finally {
      setLoading(false);
    }
  });
})();

const $ = (sel) => document.querySelector(sel);
const deviceRadios = () => Array.from(document.querySelectorAll('input[name="device"]'));
const state = { files: [], targetDir: null };

const fileInput = $("#fileInput");
const btnPickFiles = $("#btnPickFiles");
const btnPickDir = $("#btnPickDir");
const btnCopy = $("#btnCopy");
const btnShare = $("#btnShare");
const fileList = $("#fileList");
const dropZone = $("#dropZone");
const ensureFolder = $("#ensureFolder");
const usbSupport = $("#usbSupport");
const shareNote = $("#shareNote");

// Convert buttons & log
const btnConvertServer = $("#btnConvertServer");
const btnConvertToPDF = $("#btnConvertToPDF");
const btnSendToKindle = $("#btnSendToKindle");
const convertLog = $("#convertLog");

// Optional server endpoint for Calibre conversion
const CONFIG = {
  // e.g. 'https://your-domain.example/api/convert'
  apiEndpoint: ''
};

function currentDevice(){ const picked = deviceRadios().find(r=>r.checked); return picked?picked.value:"tolino"; }
function acceptExtFor(device){ return device==="tolino" ? [".epub",".pdf",".txt"] : [".mobi",".azw",".azw3",".kfx",".pdf",".txt"]; }

function renderList(){
  fileList.innerHTML = "";
  const wanted = acceptExtFor(currentDevice());
  for(const f of state.files){
    const ok = wanted.some(ext => f.name.toLowerCase().endsWith(ext));
    const li = document.createElement("li");
    li.innerHTML = `<span title="${f.name}">${f.name}</span><span>${(f.size/1024/1024).toFixed(2)} MB${ok?"":" · <em>nicht empfohlen</em>"}</span>`;
    fileList.appendChild(li);
  }
}
function addFiles(files){
  for(const f of files){ if (!state.files.some(x=>x.name===f.name && x.size===f.size)) state.files.push(f); }
  renderList();
}

btnPickFiles.addEventListener("click", ()=>fileInput.click());
fileInput.addEventListener("change", ()=>{ addFiles(fileInput.files||[]); fileInput.value=""; });

["dragenter","dragover"].forEach(evt=>dropZone.addEventListener(evt, e=>{e.preventDefault();e.stopPropagation();dropZone.classList.add("drag");}));
["dragleave","drop"].forEach(evt=>dropZone.addEventListener(evt, e=>{e.preventDefault();e.stopPropagation();dropZone.classList.remove("drag");}));
dropZone.addEventListener("drop", (e)=>{ const dt = e.dataTransfer; if(!dt) return; const files = dt.files; if(files && files.length) addFiles(files); });

btnPickDir.addEventListener("click", async()=>{
  if(!window.showDirectoryPicker){ usbSupport.textContent="Ordnerauswahl nicht verfügbar – bitte Teilen-Funktion nutzen oder Browser aktualisieren."; return; }
  try{
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    state.targetDir = dir;
    usbSupport.textContent = "Ordner ausgewählt.";
  } catch(err){ if (err?.name!=="AbortError") console.warn(err); }
});

async function ensureSubFolder(dirHandle, device){
  if(!ensureFolder.checked) return dirHandle;
  const sub = device==="tolino" ? "Books" : "documents";
  try{ return await dirHandle.getDirectoryHandle(sub, { create: true }); } catch { return dirHandle; }
}

async function copyToDir(){
  if(!state.files.length){ alert("Bitte zuerst Dateien auswählen."); return; }
  if(!state.targetDir){ alert("Bitte Zielordner wählen (Gerätespeicher)."); return; }
  const device = currentDevice();
  const wanted = acceptExtFor(device);
  const dir = await ensureSubFolder(state.targetDir, device);
  let okCount=0, skipCount=0;
  for(const file of state.files){
    const extOk = wanted.some(ext => file.name.toLowerCase().endsWith(ext));
    if(!extOk){ skipCount++; continue; }
    const handle = await dir.getFileHandle(file.name, { create: true });
    const ws = await handle.createWritable(); await ws.write(file); await ws.close(); okCount++;
  }
  alert(`Kopiert: ${okCount} · Übersprungen: ${skipCount}`);
}
btnCopy.addEventListener("click", ()=>{ copyToDir().catch(err=>{ console.error(err); alert("Kopieren fehlgeschlagen: "+err.message); }); });

btnShare.addEventListener("click", async()=>{
  if(!state.files.length){ alert("Bitte zuerst Dateien auswählen."); return; }
  const canShareFiles = !!navigator.canShare && navigator.canShare({ files: state.files.slice(0,1) });
  if(!canShareFiles || !navigator.share){ shareNote.textContent="System-Teilen nicht verfügbar."; return; }
  try{ await navigator.share({ files: state.files, title: "An Kindle senden", text: "Bücher senden" }); }
  catch(err){ if (err?.name!=="AbortError"){ console.warn(err); alert("Teilen fehlgeschlagen: "+err.message); } }
});

// --- Conversion: Server EPUB -> AZW3 (Calibre backend) ---
async function convertServerEPUBtoAZW3(file){
  if (!CONFIG.apiEndpoint){
    alert("Kein Konvertierungs-Backend konfiguriert. Trage in src/app.js bei CONFIG.apiEndpoint deine URL ein.");
    return null;
  }
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('target', 'azw3');
  convertLog.textContent = 'Lade Datei hoch…';
  const res = await fetch(CONFIG.apiEndpoint, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Serverfehler: ' + res.status);
  const blob = await res.blob();
  const outName = file.name.replace(/\\.epub$/i, '') + '.azw3';
  convertLog.textContent = 'Konvertierung fertig – lade herunter…';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = outName; a.click();
  URL.revokeObjectURL(url);
  const convertedFile = new File([blob], outName, { type: 'application/octet-stream' });
  state.files.push(convertedFile); renderList();
  convertLog.textContent = 'AZW3 hinzugefügt.';
  return convertedFile;
}

// --- Conversion: Local EPUB -> PDF (simple text export) ---
async function convertLocalEPUBtoPDF(file){
  try{
    convertLog.textContent = 'EPUB wird gelesen…';
    const book = ePub(await file.arrayBuffer());
    const pdfDoc = await PDFLib.PDFDocument.create();
    const spine = await book.loaded.spine;
    for (const item of spine) {
      const doc = await item.load(book.load.bind(book));
      const raw = doc?.documentElement ? doc.documentElement.textContent : '';
      const page = pdfDoc.addPage();
      const fontSize = 12, margin = 50;
      const { width, height } = page.getSize();
      const maxWidth = width - margin*2;
      const text = (raw || '').replace(/\\s+/g,' ').trim();
      const chunks = text.match(/.{1,110}(\\s|$)/g) || [];
      let y = height - margin;
      for (const line of chunks){
        if (y < margin) { y = height - margin; pdfDoc.addPage(); }
        page.drawText(line.trim(), { x: margin, y, size: fontSize, maxWidth });
        y -= fontSize * 1.4;
      }
    }
    const pdfBytes = await pdfDoc.save();
    const outName = file.name.replace(/\\.epub$/i, '') + '.pdf';
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = outName; a.click(); URL.revokeObjectURL(url);
    const convertedFile = new File([blob], outName, { type: 'application/pdf' });
    state.files.push(convertedFile); renderList();
    convertLog.textContent = 'PDF hinzugefügt.';
    return convertedFile;
  } catch(e){
    convertLog.textContent = 'PDF-Konvertierung fehlgeschlagen.';
    throw e;
  }
}

// Conversion buttons
btnConvertServer.addEventListener('click', async () => {
  const epub = state.files.find(f => /\\.epub$/i.test(f.name));
  if (!epub){ alert('Bitte zuerst mindestens eine EPUB-Datei auswählen.'); return; }
  try { await convertServerEPUBtoAZW3(epub); } catch (e){ console.error(e); alert('Konvertierung fehlgeschlagen: ' + e.message); }
});
const btnSaveEach = document.querySelector("#btnSaveEach");

async function saveEachFileIndividually() {
  if (!state.files.length) { alert("Bitte zuerst Dateien auswählen."); return; }
  for (const file of state.files) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: file.name,
        types: [{ description: "E-Books", accept: { "application/octet-stream": [".epub",".pdf",".mobi",".azw",".azw3",".kfx",".txt"] } }]
      });
      const ws = await handle.createWritable();
      await ws.write(file);
      await ws.close();
    } catch (e) {
      if (e && e.name !== "AbortError") console.warn("Speichern abgebrochen/fehlerhaft:", e);
    }
  }
  alert("Speichern abgeschlossen.");
}

btnSaveEach?.addEventListener("click", () => {
  if (!window.showSaveFilePicker) {
    alert("Dieser Browser unterstützt das einzelne Speichern nicht. Bitte die Dateien-App verwenden.");
    return;
  }
  saveEachFileIndividually();
});
btnConvertToPDF.addEventListener('click', async () => {
  const epub = state.files.find(f => /\\.epub$/i.test(f.name));
  if (!epub){ alert('Bitte zuerst mindestens eine EPUB-Datei auswählen.'); return; }
  try { await convertLocalEPUBtoPDF(epub); } catch (e){ console.error(e); alert('PDF-Konvertierung fehlgeschlagen: ' + e.message); }
});
btnSendToKindle.addEventListener('click', async () => {
  const epubs = state.files.filter(f => /\\.epub$/i.test(f.name));
  if (!epubs.length){ alert('Bitte zuerst EPUB-Dateien auswählen.'); return; }
  if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: epubs.slice(0,1) })){
    alert('System-Teilen nicht verfügbar. Bitte die Kindle-App manuell nutzen.');
    return;
  }
  try { await navigator.share({ files: epubs, title: 'Send to Kindle', text: 'EPUB an Kindle senden' }); }
  catch (e){ if (e?.name !== 'AbortError') { console.error(e); alert('Teilen fehlgeschlagen: ' + e.message); } }
});

(function initHints(){
  const fsOK = !!window.showDirectoryPicker;
  usbSupport.textContent = fsOK ? "Ordnerauswahl aktiv." : "Ordnerauswahl nicht verfügbar – nutze die Teilen-Option.";
  const shareOK = !!navigator.share && !!navigator.canShare;
  shareNote.textContent = shareOK ? "Teilen verfügbar (Send to Kindle wählen)." : "Dieser Browser unterstützt Teilen nicht.";
})();

import {readSave, formatExport} from "./save.mjs";

const byId = id => document.getElementById(id);
const fileInput = byId("save-file"), versionInput = byId("version");
const output = byId("output"), status = byId("status"), warning = byId("warning");
const includeItems = byId("include-items"), copyButton = byId("copy");
const copyStatus = byId("copy-status");
let data, save, fileBytes, fileName = "", withItems = true, loadId = 0;

function setEnabled(enabled) {
  for (const control of [includeItems, copyButton]) control.disabled = !enabled;
}

function render() {
  if (!save) return;
  output.value = formatExport(save, data, withItems);
  copyStatus.textContent = "You can also select and copy the text yourself.";
  copyButton.textContent = "Copy to clipboard";
}

function convert() {
  save = undefined;
  output.value = "";
  setEnabled(false);
  warning.hidden = true;
  copyStatus.textContent = "You can also select and copy the text yourself.";
  copyButton.textContent = "Copy to clipboard";
  try {
    save = readSave(fileBytes, data, versionInput.value);
    render();
    status.dataset.state = "success";
    status.textContent = `${fileName} · ${save.party.length} in party · ${save.boxes.length} in boxes`;
    warning.textContent = save.warnings.join(" ");
    warning.hidden = !save.warnings.length;
    setEnabled(true);
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error.message;
  }
}

fileInput.addEventListener("change", async () => {
  const request = ++loadId;
  const file = fileInput.files[0];
  fileBytes = undefined;
  save = undefined;
  output.value = "";
  warning.hidden = true;
  setEnabled(false);
  if (!file) {
    status.dataset.state = "";
    status.textContent = "Choose a save to get started.";
    return;
  }
  fileName = file.name;
  status.dataset.state = "";
  status.textContent = "Reading your save…";
  try {
    if (file.size > 1024 * 1024) throw new Error("This file is too large for a normal Null save. Choose an in-game .sav file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request !== loadId) return;
    fileBytes = bytes;
    convert();
  } catch (error) {
    if (request !== loadId) return;
    status.dataset.state = "error";
    status.textContent = error.message;
  }
});
versionInput.addEventListener("change", () => { if (fileBytes) convert(); });
includeItems.addEventListener("change", () => { withItems = includeItems.checked; render(); });
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = "Copied!";
    copyStatus.textContent = "Copied. Paste it into your calculator’s import box.";
  } catch {
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
    copyStatus.textContent = "Clipboard access is unavailable. The text is selected; use your browser’s Copy command.";
  }
});

try {
  const response = await fetch("./data.json");
  if (!response.ok) throw new Error("Game data could not be loaded.");
  data = await response.json();
  fileInput.disabled = false;
  status.textContent = "Choose a save to get started.";
} catch {
  status.dataset.state = "error";
  status.textContent = "Game data could not be loaded. Refresh the page and try again.";
}

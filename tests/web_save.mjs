import assert from "node:assert/strict";
import fs from "node:fs";
import {readSave, decodeMon, formatExport, calculateLevel, sectionChecksum} from "../web/save.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../web/data.json", import.meta.url)));
const physicalOrders = [];
function permute(prefix, rest) {
  if (!rest.length) physicalOrders.push(prefix);
  for (const letter of rest) permute(prefix + letter, rest.replace(letter, ""));
}
permute("", "GAEM");
function monRecord(personality = 23, nature = 3, egg = false) {
  const bytes = new Uint8Array(104), view = new DataView(bytes.buffer);
  const ot = 0x12345678, key = (personality ^ ot) >>> 0;
  view.setUint32(0, personality, true);
  view.setUint32(4, ot, true);
  bytes[0x15] = egg ? 6 : 2;
  bytes[0x58] = 50;
  const blocks = {
    G: [1 | (1 << 16), 117360, nature << 21],
    A: [237 | (33 << 16), 0, 0],
    E: [0, 0, 0],
    M: [0, (31 | (30 << 5) | (29 << 10) | (26 << 15) | (28 << 20) | (27 << 25)) >>> 0, 0],
  };
  const words = [...physicalOrders[personality % 24]].flatMap(letter => blocks[letter]);
  view.setUint16(30, words.reduce((sum, word) => sum + (word & 65535) + (word >>> 16), 0) & 65535, true);
  words.forEach((word, i) => view.setUint32(36 + i * 4, (word ^ key) >>> 0, true));
  return bytes;
}
function bank(counter = 10) {
  const bytes = new Uint8Array(14 * 4096);
  const storage = new Uint8Array(9 * 0xF80);
  // Slot 48 crosses a sector boundary; slot 360 ends the active boxes.
  for (const slot of [47, 359, 360, 419]) storage.set(monRecord().subarray(0, 84), 4 + slot * 84);
  bytes[4096 + 0x234] = 1;
  bytes.set(monRecord(), 4096 + 0x238);
  for (let id = 5; id <= 13; id++) bytes.set(storage.subarray((id - 5) * 0xF80, (id - 4) * 0xF80), id * 4096);
  const view = new DataView(bytes.buffer);
  for (let id = 0; id < 14; id++) {
    const at = id * 4096;
    view.setUint16(at + 0xFF4, id, true);
    view.setUint32(at + 0xFF8, 0x08012025, true);
    view.setUint32(at + 0xFFC, counter, true);
    view.setUint16(at + 0xFF6, sectionChecksum(bytes.subarray(at, at + 4096)), true);
  }
  return bytes;
}
function twoBanks(first, second) {
  const bytes = new Uint8Array(28 * 4096);
  bytes.set(first); bytes.set(second, first.length);
  return bytes;
}

for (let pid = 0; pid < 24; pid++) {
  const mon = decodeMon(monRecord(pid), data, "1.2.6", true);
  assert.equal(mon.name, "Bulbasaur");
  assert.equal(mon.nature, "Adamant");
  assert.equal(mon.ability, "Chlorophyll");
  assert.deepEqual(mon.ivs, [31, 30, 29, 28, 27, 26]);
  assert.deepEqual(mon.moves, ["Hidden Power", "Tackle"]);
  assert.equal(decodeMon(monRecord(pid, 26), data, "1.2.6", true).nature, data.nature[pid % 25]);
}
const save = readSave(bank(), data);
assert.equal(save.party.length, 1);
assert.equal(save.boxes.length, 2);
assert.equal(save.boxes[0].source, "Box 2, slot 18");
assert.equal(save.boxes[1].source, "Box 12, slot 30");
assert.equal(save.boxes[0].level, 50);
const itemText = formatExport(save, data, true);
assert.match(itemText, /^Bulbasaur @ Poke Ball\nAbility: Chlorophyll\nLevel: 50\nAdamant Nature/);
assert.match(itemText, /- Hidden Power Fire/);
assert.doesNotMatch(formatExport(save, data, false), / @ /);
const megaSave = {...save, boxes: [], party: [{...save.party[0], name: "Charizard", level: 78}]};
assert.match(formatExport(megaSave, data), /Charizard-Mega-X @ Charizardite X/);
assert.doesNotMatch(formatExport(megaSave, data, false), / @ /);
assert.equal(calculateLevel(117359, 3), 49);
assert.equal(calculateLevel(117360, 3), 50);
for (let curve = 0; curve <= 5; curve++) assert.equal(calculateLevel(0xFFFFFFFF, curve), 100);
const damagedRecord = monRecord(); damagedRecord[40] ^= 1;
assert.throws(() => decodeMon(damagedRecord, data, "1.2.6"), /checksum/);
assert.equal(decodeMon(monRecord(0, 3, true), data, "1.2.6").egg, true);
assert.equal(readSave(twoBanks(bank(10), bank(11)), data).counter, 11);
const broken = bank(12); broken[4096 + 100] ^= 1;
const fallback = readSave(twoBanks(bank(11), broken), data);
assert.equal(fallback.counter, 11);
assert.match(fallback.warnings[0], /previous valid/);
const incomplete = bank(12); incomplete.fill(0, 13 * 4096, 14 * 4096);
assert.equal(readSave(twoBanks(bank(11), incomplete), data).counter, 11);
assert.equal(readSave(twoBanks(bank(0xFFFFFFFF), bank(0)), data).counter, 0);
assert.throws(() => readSave(broken, data), /No complete/);
assert.throws(() => readSave(new Uint8Array(1024), data), /in-game/);
assert.throws(() => readSave(bank(), data, "unknown"), /supported/);
assert.equal(readSave(bank(), data, "1.2.4").party.length, 1);

// Exercise the actual page controller with a minimal DOM and clipboard API.
// Browser layout and actual phone permissions remain manual checks.
const elements = new Map();
const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
  elements.set(id, {disabled: true, checked: true, value: "", dataset: {}, files: [], events: {},
    addEventListener(name, callback) { this.events[name] = callback; },
    focus() {}, select() { this.selected = true; }, setSelectionRange() { this.selected = true; }});
}
globalThis.document = {getElementById(id) {
  assert(elements.has(id), `Missing HTML element ${id}`);
  return elements.get(id);
}};
globalThis.fetch = async () => ({ok: true, json: async () => data});
let copied;
Object.defineProperty(globalThis, "navigator", {configurable: true,
  value: {clipboard: {writeText: async text => { copied = text; }}}});
elements.get("version").value = "1.2.6";
await import("../web/app.mjs");
const input = elements.get("save-file"), output = elements.get("output"), copy = elements.get("copy");
assert.equal(input.disabled, false);
const upload = bank();
input.files = [{name: "test.sav", size: upload.length, arrayBuffer: async () => upload.buffer}];
await input.events.change();
assert.equal(copy.disabled, false);
assert.match(output.value, / @ Poke Ball/);
elements.get("include-items").checked = false;
elements.get("include-items").events.change();
assert.doesNotMatch(output.value, / @ /);
await copy.events.click();
assert.equal(copied, output.value);
assert.equal(copy.textContent, "Copied!");
navigator.clipboard.writeText = async () => { throw new Error("Permission denied"); };
await copy.events.click();
assert.equal(output.selected, true);
assert.match(elements.get("copy-status").textContent, /text is selected/);
input.files = [{name: "invalid.sav", size: 1024, arrayBuffer: async () => new ArrayBuffer(1024)}];
await input.events.change();
assert.equal(output.value, "");
assert.equal(copy.disabled, true);
assert.equal(elements.get("status").dataset.state, "error");
console.log("PASS: actual page controller: file input, item checkbox, copy, clipboard fallback, and clearing invalid uploads");

console.log("PASS: save decoding, formatting, checksums, fallback, and page controls");

// Null's 84-byte box records and 104-byte party records use a 36-byte header.
// RAM addresses are deliberately absent: sector IDs reconstruct the saved data.
const SECTOR = 4096;
const PAYLOAD = 0xF80;
const SIGNATURE = 0x08012025;
const PERMUTATIONS = [
  [0,1,2,3],[0,1,3,2],[0,2,1,3],[0,3,1,2],[0,2,3,1],[0,3,2,1],
  [1,0,2,3],[1,0,3,2],[2,0,1,3],[3,0,1,2],[2,0,3,1],[3,0,2,1],
  [1,2,0,3],[1,3,0,2],[2,1,0,3],[3,1,0,2],[2,3,0,1],[3,2,0,1],
  [1,2,3,0],[1,3,2,0],[2,1,3,0],[3,1,2,0],[2,3,1,0],[3,2,1,0],
];
const STATS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
const HP_TYPES = ["Fighting","Flying","Poison","Ground","Rock","Bug","Ghost","Steel","Fire","Water","Grass","Electric","Psychic","Ice","Dragon","Dark"];
const newer = (a, b) => a !== b && ((a - b) >>> 0) < 0x80000000;
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function sectionChecksum(bytes) {
  const view = viewOf(bytes);
  let sum = 0;
  for (let at = 0; at < PAYLOAD; at += 4) sum = (sum + view.getUint32(at, true)) >>> 0;
  return ((sum & 0xFFFF) + (sum >>> 16)) & 0xFFFF;
}

export function readSave(input, data, version = "1.2.6") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!data.profiles[version]) throw new Error("Choose a supported Null version.");
  if (bytes.length < 14 * SECTOR || bytes.length > 1024 * 1024) {
    throw new Error("Choose an exported in-game .sav file, rather than an emulator save state.");
  }
  const view = viewOf(bytes);
  const groups = new Map();
  let newestCounter;
  // The first 28 sectors are two banks of 14. Do not search Hall of Fame,
  // emulator footers, or unrelated appended data for apparent save sections.
  for (let at = 0; at + SECTOR <= Math.min(bytes.length, 28 * SECTOR); at += SECTOR) {
    const id = view.getUint16(at + 0xFF4, true);
    if (id >= 14 || view.getUint32(at + 0xFF8, true) !== SIGNATURE) continue;
    const counter = view.getUint32(at + 0xFFC, true);
    if (newestCounter === undefined || newer(counter, newestCounter)) newestCounter = counter;
    const key = `${Math.floor(at / (14 * SECTOR))}:${counter}`;
    if (!groups.has(key)) groups.set(key, {counter, sections: new Map(), duplicate: false});
    const group = groups.get(key);
    if (group.sections.has(id)) group.duplicate = true;
    group.sections.set(id, bytes.subarray(at, at + SECTOR));
  }
  const valid = [...groups.values()].filter(group => !group.duplicate && group.sections.size === 14 &&
    [...group.sections.values()].every(section => sectionChecksum(section) === viewOf(section).getUint16(0xFF6, true)));
  if (!valid.length) throw new Error("No complete, valid Null save was found. Save in-game and export a fresh .sav.");
  const selected = valid.reduce((best, group) => newer(group.counter, best.counter) ? group : best);
  const warnings = [];
  if (newer(newestCounter, selected.counter)) warnings.push("The newest save copy is incomplete or damaged. Loaded the previous valid in-game save.");
  const section1 = selected.sections.get(1);
  const count = section1[0x234];
  if (count > 6) throw new Error("Invalid party count. Check the game version and save format.");
  const storage = new Uint8Array(9 * PAYLOAD);
  for (let id = 5; id <= 13; id++) storage.set(selected.sections.get(id).subarray(0, PAYLOAD), (id - 5) * PAYLOAD);
  if (viewOf(storage).getUint32(0, true) >= 14) throw new Error("Invalid PC layout. Check the game version and save format.");
  const party = [], boxes = [];
  let eggs = 0;
  const add = (record, source, target, partyRecord) => {
    const mon = decodeMon(record, data, version, partyRecord);
    if (!mon) return;
    if (mon.egg) { eggs++; return; }
    target.push({...mon, source});
  };
  for (let slot = 0; slot < count; slot++) {
    const at = 0x238 + slot * 104;
    try { add(section1.subarray(at, at + 104), `Party ${slot + 1}`, party, true); }
    catch (error) { throw new Error(`Party ${slot + 1}: ${error.message}`); }
  }
  for (let slot = 0; slot < 360; slot++) {
    const at = 4 + slot * 84;
    const source = `Box ${Math.floor(slot / 30) + 1}, slot ${slot % 30 + 1}`;
    try { add(storage.subarray(at, at + 84), source, boxes, false); }
    catch (error) { throw new Error(`${source}: ${error.message}`); }
  }
  if (eggs) warnings.push(`Skipped ${eggs} unhatched egg${eggs === 1 ? "" : "s"}.`);
  if (!party.length && !boxes.length) throw new Error("No Pokémon were found in the party or active boxes.");
  return {party, boxes, warnings, counter: selected.counter, version};
}

export function decodeMon(bytes, data, version, partyRecord = false) {
  if (bytes.every(byte => byte === 0) || bytes.every(byte => byte === 0xFF)) return null;
  if (bytes.length < (partyRecord ? 104 : 84)) throw new Error("Truncated Pokémon record.");
  const view = viewOf(bytes);
  const personality = view.getUint32(0, true);
  const key = (personality ^ view.getUint32(4, true)) >>> 0;
  const words = Array.from({length: 12}, (_, i) => (view.getUint32(36 + i * 4, true) ^ key) >>> 0);
  const checksum = words.reduce((sum, word) => sum + (word & 65535) + (word >>> 16), 0) & 65535;
  if (checksum !== view.getUint16(30, true)) throw new Error("Pokémon checksum failed. Export a fresh save.");
  const [g, a, , m] = PERMUTATIONS[personality % 24].map(index => words.slice(index * 3, index * 3 + 3));
  const species = g[0] & 65535;
  if (!species && !(bytes[0x15] & 2)) return null;
  if ((bytes[0x15] & 1) || !(bytes[0x15] & 2)) throw new Error("Invalid Pokémon header.");
  const row = data.profiles[version].species[species];
  if (!row || !data.mons[species]) throw new Error(`Unknown species ${species}. Check the game version.`);
  const natureId = (g[2] >>> 21) & 31;
  const nature = data.nature[natureId === 26 ? personality % 25 : natureId];
  const abilitySlot = (m[2] >>> 29) & 3;
  const ability = data.abilities[row[1 + abilitySlot]];
  const heldItem = g[0] >>> 16;
  const moveIds = [a[0] & 65535, a[0] >>> 16, a[1] & 65535, a[1] >>> 16];
  if (!nature || !ability || abilitySlot > 2 || (heldItem && !data.item[heldItem]) || moveIds.some(id => data.move[id] === undefined)) {
    throw new Error("Unknown nature, ability, item, or move. Check the game version.");
  }
  const ivWord = m[1];
  const ivs = [0, 5, 10, 20, 25, 15].map(shift => (ivWord >>> shift) & 31);
  const level = partyRecord ? bytes[0x58] : calculateLevel(g[1], row[0]);
  if (level < 1 || level > 100) throw new Error("Invalid Pokémon level.");
  return {species, name: data.mons[species], nature, ability, heldItem: data.item[heldItem] || "",
    ivs, level, moves: moveIds.filter(id => id !== 0).map(id => data.move[id]),
    egg: Boolean((bytes[0x15] & 4) || (ivWord & 0x40000000))};
}

export function experienceFor(level, curve) {
  const n = level, cube = n ** 3;
  switch (curve) {
    case 0: return cube;
    case 1:
      if (n <= 50) return Math.floor((100 - n) * cube / 50);
      if (n <= 68) return Math.floor((150 - n) * cube / 100);
      if (n <= 98) return Math.floor(Math.floor((1911 - 10 * n) / 3) * cube / 500);
      return Math.floor((160 - n) * cube / 100);
    case 2:
      if (n < 15) return Math.floor((Math.floor((n + 1) / 3) + 24) * cube / 50);
      if (n <= 36) return Math.floor((n + 14) * cube / 50);
      return Math.floor((Math.floor(n / 2) + 32) * cube / 50);
    case 3: return Math.floor(6 * cube / 5) - 15 * n ** 2 + 100 * n - 140;
    case 4: return Math.floor(4 * cube / 5);
    case 5: return Math.floor(5 * cube / 4);
    default: throw new Error("Unknown experience curve.");
  }
}

export function calculateLevel(experience, curve) {
  let level = 1;
  while (level < 100 && experience >= experienceFor(level + 1, curve)) level++;
  return level;
}

export function formatExport(save, data, withItems = true) {
  const blocks = [];
  for (const mon of [...save.party, ...save.boxes]) {
    const hiddenPower = HP_TYPES[Math.floor((mon.ivs[0] % 2 + 2 * (mon.ivs[1] % 2) +
      4 * (mon.ivs[2] % 2) + 8 * (mon.ivs[5] % 2) + 16 * (mon.ivs[3] % 2) + 32 * (mon.ivs[4] % 2)) * 15 / 63)];
    const block = (name, item = mon.heldItem, ability = mon.ability) => {
      blocks.push([
        name + (withItems && item ? ` @ ${item}` : ""),
        `Ability: ${ability}`, `Level: ${mon.level}`, `${mon.nature} Nature`,
        `IVs: ${mon.ivs.map((iv, i) => `${iv} ${STATS[i]}`).join(" / ")}`,
        ...mon.moves.map(move => `- ${move === "Hidden Power" ? `Hidden Power ${hiddenPower}` : move}`),
      ].join("\n"));
    };
    if (mon.name.startsWith("Rotom")) ["Rotom","Rotom-Fan","Rotom-Frost","Rotom-Heat","Rotom-Mow"].forEach(name => block(name));
    else if (mon.name.startsWith("Minior")) ["Minior","Minior-Meteor"].forEach(name => block(name));
    else block(mon.name);
    // The archived thresholds are a 1.2.6 design reference. Only enable
    // generated Mega entries for that explicitly selected version.
    if (save.version === "1.2.6") {
      for (const [level, name, item, ability] of data.mega[mon.name] || []) {
        if (mon.level >= level) block(name, item, ability);
      }
    }
  }
  return blocks.join("\n\n") + "\n";
}

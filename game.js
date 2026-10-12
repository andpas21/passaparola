// Regole, dadi e dizionario: condivisi tra gioco locale e online.

export const DICE = [
  { n: "viola",     f: "AMGEZS", c: "#7b4fa8", t: "#fff" },
  { n: "rosa",      f: "SOIGVU", c: "#f2a7c3", t: "#3a1428" },
  { n: "verde",     f: "TCRNLO", c: "#3f9a5c", t: "#fff" },
  { n: "giallo",    f: "AEEAII", c: "#f4cf3a", t: "#3a2c05" },
  { n: "blu",       f: "BLDCTR", c: "#2f63b8", t: "#fff" },
  { n: "rosso",     f: "HDBNRP", c: "#d23b33", t: "#fff" },
  { n: "arancione", f: "AEEAIO", c: "#f08a2c", t: "#3a1d05" },
  { n: "marrone",   f: "FCMLPN", c: "#7a4e2d", t: "#fff" },
  { n: "nero",      f: "AOIEUO", c: "#26262a", t: "#fff" },
];

export const points = len => Math.max(0, len - 3);
export const MIN_LEN = 4;

let list = [], set = null;
export const dict = {
  get ready() { return set !== null; },
  get size() { return set ? set.size : 0; },
  has: w => set ? set.has(w) : true,
};

export async function loadDictionary() {
  const r = await fetch("parole.txt");
  if (!r.ok) throw new Error("dizionario non trovato");
  list = (await r.text()).split("\n").filter(Boolean);
  set = new Set(list);
  return set.size;
}

// Tutte le parole del dizionario componibili con le lettere del lancio
export function wordsFor(roll) {
  if (!set) return [];
  const have = {};
  for (const ch of roll.join("").toLowerCase()) have[ch] = (have[ch] || 0) + 1;
  return list.filter(w => {
    const c = {};
    for (const ch of w) { c[ch] = (c[ch] || 0) + 1; if (!have[ch] || c[ch] > have[ch]) return false; }
    return true;
  });
}

// Lancia i 9 dadi; ritira i lanci quasi ingiocabili (meno di 10 parole possibili)
export function rollDice() {
  let roll, possible, tries = 0;
  do {
    roll = DICE.map(d => d.f[Math.floor(Math.random() * 6)]);
    possible = wordsFor(roll); tries++;
  } while (set && possible.length < 10 && tries < 20);
  return { roll, possible };
}

export const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function bestWords(possible, n = 14) {
  return [...possible].sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, n);
}

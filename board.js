// Il tavolo di gioco: dadi, composizione della parola, taccuino e clessidra.
// Usato sia dalla partita locale sia da quella online.
import { DICE, points, MIN_LEN, dict, esc } from "./game.js";

const $ = id => document.getElementById(id);
let B = null;        // stato del tavolo aperto
let tick = null;

export function openBoard(o) {
  closeBoard();
  B = {
    roll: o.roll, possible: o.possible || [], picked: [], found: (o.initial || []).map(f => ({ ...f })),
    now: o.now || (() => Date.now()), endsAt: o.endsAt ?? null,
    allowManual: o.allowManual !== false, onWord: o.onWord || (() => {}),
    onTimeUp: o.onTimeUp || (() => {}), locked: false, lastRejected: null,
  };
  $("who").textContent = o.who;
  $("round").textContent = o.sub || "";
  $("endTurn").hidden = !o.onEndClick;
  $("endTurn").textContent = o.endLabel || "Termina turno";
  $("endTurn").onclick = o.onEndClick || null;
  $("opponents").hidden = !o.opponents;
  $("possible").textContent = dict.ready && B.possible.length ? `Su questo lancio esistono ${B.possible.length} parole valide.` : "";
  drawDice(true); drawWord(); drawFound(); say("");
  drawTimer();
  tick = setInterval(drawTimer, 250);
}

export function closeBoard() { clearInterval(tick); tick = null; if (B) B.locked = true; }
export const boardWords = () => (B ? B.found.map(f => ({ ...f })) : []);
export function setOpponents(html) { $("opponents").innerHTML = html; }

function drawTimer() {
  const t = $("timer");
  if (!B) return;
  if (B.endsAt == null) { t.textContent = "∞"; t.classList.remove("low"); return; }
  const left = Math.max(0, Math.ceil((B.endsAt - B.now()) / 1000));
  t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  t.classList.toggle("low", left <= 15);
  if (left <= 0 && !B.locked) {
    B.locked = true; clearInterval(tick);
    say("Tempo scaduto!", "ko");
    B.onTimeUp();
  }
}

function drawDice(anim) {
  $("dice").innerHTML = B.roll.map((l, i) =>
    `<button class="die${B.picked.includes(i) ? " used" : ""}${anim ? " rolling" : ""}" data-i="${i}" type="button"
      aria-label="Dado ${DICE[i].n}: ${l}" style="--c:${DICE[i].c};--t:${DICE[i].t};animation-delay:${i * 40}ms">${l}</button>`).join("");
  document.querySelectorAll(".die").forEach(b => b.onclick = () => pick(+b.dataset.i));
}

function pick(i) {
  if (B.locked) return;
  if (B.picked.includes(i)) B.picked.splice(B.picked.indexOf(i)); // tocca un dado già usato: torna indietro fino a lì
  else B.picked.push(i);
  drawDice(false); drawWord(); say("");
}

function drawWord() {
  $("word").innerHTML = B.picked.length
    ? B.picked.map(i => `<div class="t" style="background:${DICE[i].c};color:${DICE[i].t}">${B.roll[i]}</div>`).join("")
    : `<span class="ph">La parola compare qui</span>`;
  $("manualBox").hidden = true;
}

function say(t, cls) { const m = $("msg"); m.textContent = t; m.className = "msg " + (cls || ""); }
const current = () => B.picked.map(i => B.roll[i]).join("").toLowerCase();

function submit() {
  if (!B || B.locked) return;
  const w = current();
  if (w.length < MIN_LEN) return say(`Servono almeno ${MIN_LEN} lettere.`, "ko");
  if (B.found.some(f => f.w === w)) return say("Questa l'hai già scritta.", "ko");
  if (dict.ready && !dict.has(w)) {
    B.lastRejected = w;
    say(`“${w.toUpperCase()}” non è nel dizionario.`, "ko");
    $("manualBox").hidden = !B.allowManual;
    return;
  }
  accept(w, !dict.ready);
}

function accept(w, manual) {
  const p = points(w.length);
  B.found.unshift({ w, p, manual });
  say(`+${p} ${p === 1 ? "punto" : "punti"} · ${w.toUpperCase()}`, "ok");
  B.picked = []; drawDice(false); drawWord(); drawFound();
  B.onWord(w, p, manual);
}

function drawFound() {
  const tot = B.found.reduce((a, f) => a + f.p, 0);
  $("score").textContent = tot + " pt";
  $("found").innerHTML = B.found.length
    ? B.found.map(f => `<li><span class="w">${esc(f.w)}${f.manual ? '<span class="man">a mano</span>' : ""}</span><span class="p">+${f.p}</span></li>`).join("")
    : `<li class="empty">Nessuna parola ancora</li>`;
}

// Comandi
$("manual").onclick = () => { if (B && !B.locked && B.lastRejected && B.lastRejected === current()) accept(B.lastRejected, true); };
$("submit").onclick = submit;
$("back").onclick = () => { if (!B || B.locked) return; B.picked.pop(); drawDice(false); drawWord(); };
$("clear").onclick = () => { if (!B || B.locked) return; B.picked = []; drawDice(false); drawWord(); say(""); };

document.addEventListener("keydown", e => {
  if (!B || B.locked || $("game").hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === "Enter") { e.preventDefault(); submit(); return; }
  if (e.key === "Backspace") { e.preventDefault(); B.picked.pop(); drawDice(false); drawWord(); return; }
  if (e.key === "Escape") { B.picked = []; drawDice(false); drawWord(); return; }
  if (/^[a-zA-Z]$/.test(e.key)) {
    const L = e.key.toUpperCase();
    const i = B.roll.findIndex((l, k) => l === L && !B.picked.includes(k));
    if (i >= 0) pick(i); else say(`Nessun dado libero con la ${L}.`, "ko");
  }
});

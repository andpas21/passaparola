// Avvio, navigazione e partita locale (da soli o a turno sullo stesso dispositivo).
import { DICE, dict, loadDictionary, rollDice, points, esc, bestWords } from "./game.js";
import { openBoard, closeBoard, boardWords } from "./board.js";

const $ = id => document.getElementById(id);
const SCREENS = ["home", "setup", "game", "turnEnd", "final", "online"];

export function show(id) {
  SCREENS.forEach(s => $(s).hidden = s !== id);
  window.scrollTo(0, 0);
}
export function setWhoami(t) { $("whoami").textContent = t || "9 dadi · parole da 4 lettere in su · solo italiano"; }

// --- avvio
$("dicelist").innerHTML = DICE.map(d => `<div style="--c:${d.c};--t:${d.t}"><small>${d.n}</small>${d.f}</div>`).join("");

export const dictReady = loadDictionary().then(n => {
  $("dictstate").textContent = `Dizionario pronto: ${n.toLocaleString("it-IT")} parole.`;
}).catch(() => {
  $("dictstate").textContent = "Dizionario non disponibile: le parole andranno approvate dal tavolo.";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

function goHome() { closeBoard(); online?.leaveView?.(); show("home"); }
$("homeLink").onclick = goHome;
document.querySelectorAll("[data-home]").forEach(b => b.onclick = goHome);
$("goLocal").onclick = () => show("setup");

let online = null;
$("goOnline").onclick = async () => {
  show("online");
  $("online").innerHTML = `<div class="panel narrow"><p>Collegamento in corso…</p></div>`;
  try {
    online = online || await import("./online.js");
    online.enter();
  } catch (e) {
    $("online").innerHTML = `<div class="panel narrow"><h2>Sfida online non disponibile</h2>
      <p>Per giocare online serve una connessione a internet. Da soli si gioca anche offline.</p>
      <div class="row"><button class="ghost" type="button" id="olBack">Indietro</button></div></div>`;
    $("olBack").onclick = goHome;
  }
};
export { goHome };

// --- partita locale
let names = ["Giocatore 1"];
try { const s = JSON.parse(localStorage.getItem("pp-names")); if (Array.isArray(s) && s.length) names = s; } catch (e) {}

function drawPlayers() {
  $("players").innerHTML = names.map((n, i) => `<div class="prow"><input id="pn${i}" value="${esc(n)}" aria-label="Nome giocatore ${i + 1}" maxlength="20">${names.length > 1 ? `<button class="ghost small" data-rm="${i}" type="button" aria-label="Rimuovi">✕</button>` : ""}</div>`).join("");
  names.forEach((_, i) => $("pn" + i).oninput = e => names[i] = e.target.value);
  document.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { names.splice(+b.dataset.rm, 1); drawPlayers(); });
  $("addPlayer").disabled = names.length >= 6;
}
$("addPlayer").onclick = () => { names.push("Giocatore " + (names.length + 1)); drawPlayers(); };
drawPlayers();

const L = { players: [], rounds: 3, time: 180, turn: 0, roll: [], possible: [] };
const cur = () => L.players[L.turn % L.players.length];

$("start").onclick = startGame;
function startGame() {
  const list = names.map((n, i) => n.trim() || "Giocatore " + (i + 1));
  try { localStorage.setItem("pp-names", JSON.stringify(list)); } catch (e) {}
  L.players = list.map(n => ({ name: n, score: 0, words: [] }));
  L.rounds = +$("rounds").value; L.time = +$("time").value; L.turn = 0;
  startTurn();
}

function startTurn() {
  const p = cur();
  const { roll, possible } = rollDice();
  Object.assign(L, { roll, possible });
  show("game");
  openBoard({
    who: p.name,
    sub: `Turno ${Math.floor(L.turn / L.players.length) + 1} di ${L.rounds}` + (L.players.length > 1 ? ` · giocatore ${L.turn % L.players.length + 1} di ${L.players.length}` : ""),
    roll, possible,
    endsAt: L.time ? Date.now() + L.time * 1000 : null,
    allowManual: true,
    onTimeUp: endTurn,
    onEndClick: endTurn,
  });
}

function endTurn() {
  const found = boardWords();
  closeBoard();
  const p = cur();
  const pts = found.reduce((a, f) => a + f.p, 0);
  p.score += pts; p.words.push(...found.map(f => f.w));
  $("teWho").textContent = `${p.name} · lancio ${L.roll.join(" ")}`;
  $("tePts").textContent = `${pts} ${pts === 1 ? "punto" : "punti"}`;
  $("teWords").innerHTML = found.length ? found.map(f => `<span class="mine">${esc(f.w)}<i>+${f.p}</i></span>`).join("") : `<span>nessuna parola</span>`;
  const mine = new Set(found.map(f => f.w));
  const best = bestWords(L.possible);
  $("teBest").innerHTML = best.length ? best.map(w => `<span class="${mine.has(w) ? "mine" : ""}">${w}<i>+${points(w.length)}</i></span>`).join("") : `<span>dizionario non disponibile</span>`;
  const got = L.possible.filter(w => mine.has(w)).length;
  $("teCount").textContent = L.possible.length ? `Trovate ${got} su ${L.possible.length} parole del dizionario` : "";
  L.turn++;
  $("next").textContent = L.turn >= L.players.length * L.rounds ? "Vedi la classifica" : `Tocca a ${cur().name}`;
  show("turnEnd");
}
$("next").onclick = () => L.turn >= L.players.length * L.rounds ? showFinal() : startTurn();

function showFinal() {
  const r = [...L.players].sort((a, b) => b.score - a.score);
  const top = r[0].score, winners = r.filter(p => p.score === top);
  $("winner").textContent = L.players.length === 1 ? `Hai totalizzato ${top} punti` : winners.length > 1 ? `Pareggio a ${top} punti` : `Vince ${winners[0].name} con ${top} punti`;
  $("ranking").innerHTML = r.map(p => {
    const longest = p.words.reduce((a, w) => w.length > a.length ? w : a, "");
    return `<tr class="${p.score === top ? "first" : ""}"><td>${esc(p.name)}</td><td class="num">${p.words.length}</td><td class="num">${longest ? longest.toUpperCase() : "–"}</td><td class="num">${p.score}</td></tr>`;
  }).join("");
  show("final");
}
$("again").onclick = startGame;
$("newGame").onclick = () => show("setup");

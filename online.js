// Sfida online con Firebase Realtime Database.
//
// Dati:
//   nicknames/{nick in minuscolo} = uid            → garantisce nickname univoci
//   users/{uid}                    = { nick }
//   rooms/{CODICE} = { host, created, status: lobby|round|review|done, rounds, time, round, endsAt,
//                      rolls/{n}: "LETTERE", players/{uid}: { nick, joined }, words/{n}/{uid}/{parola}: punti }
import { firebaseConfig } from "./firebase-config.js";
import { wordsFor, rollDice, bestWords, points, esc } from "./game.js";
import { openBoard, closeBoard, setOpponents } from "./board.js";
import { show, setWhoami, goHome, dictReady } from "./app.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const $ = id => document.getElementById(id);
const view = html => { $("online").innerHTML = html; show("online"); };

let A, D, auth, db, uid = null, nick = null, offset = 0;
let code = null, room = null, unsub = null, boardRound = null;
const now = () => Date.now() + offset;
const r = path => D.ref(db, path);

async function init() {
  if (db) return;
  const [F, Auth, Db] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-database.js"),
  ]);
  A = Auth; D = Db;
  const app = F.initializeApp(firebaseConfig);
  auth = A.getAuth(app);
  await new Promise(res => { const off = A.onAuthStateChanged(auth, () => { off(); res(); }); });
  if (!auth.currentUser) await A.signInAnonymously(auth);
  uid = auth.currentUser.uid;
  db = D.getDatabase(app);
  D.onValue(r(".info/serverTimeOffset"), s => { offset = s.val() || 0; });
  nick = (await D.get(r(`users/${uid}/nick`))).val();
}

export async function enter() {
  if (!firebaseConfig) return renderNotConfigured();
  view(`<div class="panel narrow"><p>Collegamento in corso…</p></div>`);
  try { await init(); await dictReady; }
  catch (e) { return renderError("Non riesco a collegarmi al server di gioco. Controlla la connessione e riprova."); }
  if (!nick) return renderNick();
  setWhoami(`Giochi come ${nick}`);
  let saved = null;
  try { saved = localStorage.getItem("pp-room"); } catch (e) {}
  if (saved) {
    const s = await D.get(r(`rooms/${saved}`)).catch(() => null);
    if (s && s.exists() && s.val().players?.[uid]) return watch(saved);
    forgetRoom();
  }
  renderLobby();
}

export function leaveView() {
  if (unsub) { unsub(); unsub = null; }
  boardRound = null;
}

function forgetRoom() { try { localStorage.removeItem("pp-room"); } catch (e) {} }

// --- schermate di servizio
function renderNotConfigured() {
  view(`<div class="panel narrow">
    <h2>Sfida online da configurare</h2>
    <p>Per giocare online serve collegare il gioco a un progetto Firebase gratuito. I passaggi sono nel README del repository; poi basta incollare la configurazione nel file <code>firebase-config.js</code>.</p>
    <div class="row"><button class="ghost" id="olBack" type="button">Indietro</button></div></div>`);
  $("olBack").onclick = goHome;
}
function renderError(msg) {
  view(`<div class="panel narrow"><h2>Qualcosa non va</h2><p>${esc(msg)}</p>
    <div class="row"><button id="olRetry" type="button">Riprova</button><button class="ghost" id="olBack" type="button">Indietro</button></div></div>`);
  $("olRetry").onclick = enter; $("olBack").onclick = goHome;
}

// --- nickname univoco
function renderNick() {
  view(`<div class="panel narrow">
    <h2>${nick ? "Cambia nickname" : "Scegli il tuo nickname"}</h2>
    <p class="muted">È il nome con cui ti vedono gli altri. Deve essere unico: se qualcuno l'ha già preso, prova un'altra variante.</p>
    <form id="nickForm" class="stack" novalidate>
      <label class="field"><span class="label">Nickname</span>
        <input id="nickInput" autocomplete="nickname" autocapitalize="off" spellcheck="false" maxlength="16" value="${esc(nick || "")}" placeholder="es. andrea_pd"></label>
      <div class="msg ko" id="nickMsg" role="status"></div>
      <div class="row"><button type="submit" id="nickSave">Conferma</button>${nick ? `<button class="ghost" type="button" id="nickCancel">Annulla</button>` : `<button class="ghost" type="button" id="nickCancel">Indietro</button>`}</div>
      <p class="hint-l">Da 3 a 16 caratteri: lettere, numeri o trattino basso.</p>
    </form></div>`);
  $("nickCancel").onclick = () => nick ? renderLobby() : goHome();
  $("nickForm").onsubmit = async e => {
    e.preventDefault();
    const val = $("nickInput").value.trim();
    const m = $("nickMsg");
    if (!/^[A-Za-z0-9_]{3,16}$/.test(val)) { m.textContent = "Usa da 3 a 16 caratteri: lettere, numeri o trattino basso."; return; }
    $("nickSave").disabled = true; m.textContent = "";
    try {
      await claimNick(val);
      setWhoami(`Giochi come ${nick}`);
      renderLobby();
    } catch (err) {
      m.textContent = err.message === "taken" ? `“${val}” è già usato da un altro giocatore.` : "Non riesco a salvare il nickname. Riprova.";
      $("nickSave").disabled = false;
    }
  };
  $("nickInput").focus();
}

async function claimNick(val) {
  const key = val.toLowerCase();
  const owner = (await D.get(r(`nicknames/${key}`))).val();
  if (owner && owner !== uid) throw new Error("taken");
  let res;
  try { res = await D.runTransaction(r(`nicknames/${key}`), cur => (cur === null || cur === uid) ? uid : undefined); }
  catch (e) { if (/permission/i.test(e.message || e.code || "")) throw new Error("taken"); throw e; }
  if (!res.committed || res.snapshot.val() !== uid) throw new Error("taken");
  if (nick && nick.toLowerCase() !== key) await D.remove(r(`nicknames/${nick.toLowerCase()}`)).catch(() => {});
  await D.set(r(`users/${uid}`), { nick: val });
  nick = val;
}

// --- sala d'attesa: crea o entra in una stanza
function renderLobby() {
  leaveView();
  view(`<div class="setup">
    <div class="panel">
      <h2>Crea una stanza</h2>
      <p class="muted">Ricevi un codice da dare agli altri giocatori. Sei tu a lanciare i dadi.</p>
      <div class="opts">
        <label><span class="label">Round</span>
          <select id="olRounds"><option>1</option><option>3</option><option selected>5</option><option>10</option></select></label>
        <label><span class="label">Clessidra</span>
          <select id="olTime"><option value="60">1 minuto</option><option value="120">2 minuti</option><option value="180" selected>3 minuti</option><option value="0">Senza tempo</option></select></label>
      </div>
      <button id="olCreate" type="button">Crea stanza</button>
      <div class="msg ko" id="olCreateMsg" role="status"></div>
    </div>
    <div class="panel">
      <h2>Entra in una stanza</h2>
      <p class="muted">Scrivi il codice di 4 lettere che ti hanno dato.</p>
      <form id="olJoin" class="stack" novalidate>
        <input id="olCode" class="codein" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD" aria-label="Codice stanza">
        <button type="submit">Entra</button>
        <div class="msg ko" id="olJoinMsg" role="status"></div>
      </form>
    </div>
  </div>
  <div class="row"><button class="ghost small" id="olNick" type="button">Cambia nickname (${esc(nick)})</button><button class="ghost small" id="olHome" type="button">Torna all'inizio</button></div>`);
  $("olNick").onclick = renderNick;
  $("olHome").onclick = goHome;
  $("olCreate").onclick = createRoom;
  $("olJoin").onsubmit = e => { e.preventDefault(); joinRoom($("olCode").value.trim().toUpperCase()); };
}

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
async function createRoom() {
  $("olCreate").disabled = true;
  const rounds = +$("olRounds").value, time = +$("olTime").value;
  try {
    for (let i = 0; i < 6; i++) {
      const c = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
      const room = { host: uid, created: now(), status: "lobby", rounds, time, round: 0, endsAt: 0,
        players: { [uid]: { nick, joined: now() } } };
      const res = await D.runTransaction(r(`rooms/${c}`), cur => cur === null ? room : undefined);
      if (res.committed) return watch(c);
    }
    throw new Error();
  } catch (e) {
    $("olCreateMsg").textContent = "Non riesco a creare la stanza. Riprova.";
    $("olCreate").disabled = false;
  }
}

async function joinRoom(c) {
  const m = $("olJoinMsg");
  if (!/^[A-Z]{4}$/.test(c)) { m.textContent = "Il codice è di 4 lettere."; return; }
  try {
    const s = await D.get(r(`rooms/${c}`));
    if (!s.exists()) { m.textContent = `Nessuna stanza con il codice ${c}.`; return; }
    await D.set(r(`rooms/${c}/players/${uid}`), { nick, joined: now() });
    watch(c);
  } catch (e) { m.textContent = "Non riesco a entrare nella stanza. Riprova."; }
}

function watch(c) {
  leaveView();
  code = c;
  try { localStorage.setItem("pp-room", c); } catch (e) {}
  unsub = D.onValue(r(`rooms/${c}`), s => {
    room = s.val();
    if (!room) { leaveView(); forgetRoom(); closeBoard(); renderLobby(); return; }
    render();
  }, () => renderError("Hai perso il collegamento con la stanza."));
}

async function leaveRoom() {
  const c = code;
  leaveView(); forgetRoom(); closeBoard();
  if (room && room.status === "lobby") {
    if (room.host === uid) await D.remove(r(`rooms/${c}`)).catch(() => {});
    else await D.remove(r(`rooms/${c}/players/${uid}`)).catch(() => {});
  }
  code = null; room = null;
  renderLobby();
}

// --- punteggi
const isHost = () => room.host === uid;
const players = () => Object.entries(room.players || {}).map(([id, p]) => ({ id, nick: p.nick }));
function roundWords(n, id) { return Object.entries(room.words?.[n]?.[id] || {}).map(([w, p]) => ({ w, p })); }
function roundPts(n, id) { return roundWords(n, id).reduce((a, x) => a + x.p, 0); }
function totals() {
  return players().map(p => {
    let pts = 0, words = [];
    for (let n = 1; n <= room.round; n++) { pts += roundPts(n, p.id); words.push(...roundWords(n, p.id).map(x => x.w)); }
    return { ...p, pts, words };
  }).sort((a, b) => b.pts - a.pts || a.nick.localeCompare(b.nick));
}
const youTag = id => id === uid ? ` <em class="you">tu</em>` : "";
const hostNick = () => room.players?.[room.host]?.nick || "l'host";

// --- render per stato della stanza
function render() {
  if (room.status === "round") return renderRound();
  if (boardRound !== null) { closeBoard(); boardRound = null; }
  if (room.status === "lobby") return renderRoomLobby();
  if (room.status === "review") return renderReview();
  if (room.status === "done") return renderFinal();
}

function settingsText() {
  return `${room.rounds} ${room.rounds === 1 ? "round" : "round"} · ${room.time ? (room.time / 60) + " min di clessidra" : "senza tempo"}`;
}

function renderRoomLobby() {
  const ps = players();
  view(`<div class="setup">
    <div class="panel stack">
      <div class="label">Codice della stanza</div>
      <div class="code">${code}</div>
      <p class="muted">Dallo agli altri: lo scrivono in “Entra in una stanza”. ${settingsText()}.</p>
      <div class="row">
        ${isHost() ? `<button id="olStart" type="button">Lancia i dadi</button>` : `<p class="waiting">In attesa che ${esc(hostNick())} lanci i dadi…</p>`}
        <button class="ghost" id="olLeave" type="button">${isHost() ? "Chiudi la stanza" : "Esci"}</button>
      </div>
    </div>
    <div class="panel">
      <h2>Giocatori (${ps.length})</h2>
      <ul class="plist">${ps.map(p => `<li>${esc(p.nick)}${p.id === room.host ? ` <em>host</em>` : ""}${youTag(p.id)}</li>`).join("")}</ul>
    </div>
  </div>`);
  $("olLeave").onclick = leaveRoom;
  if (isHost()) $("olStart").onclick = nextRound;
}

async function nextRound() {
  const n = (room.round || 0) + 1;
  const { roll } = rollDice();
  await D.update(r(`rooms/${code}`), {
    status: "round", round: n, [`rolls/${n}`]: roll.join(""),
    endsAt: room.time ? now() + room.time * 1000 + 2000 : 0,
  });
}

async function endRound() {
  if (!room || room.status !== "round") return;
  await D.update(r(`rooms/${code}`), { status: "review" }).catch(() => {});
}

function renderRound() {
  const n = room.round;
  const roll = (room.rolls?.[n] || "").split("");
  if (boardRound !== n) {
    boardRound = n;
    show("game");
    openBoard({
      who: nick,
      sub: `Stanza ${code} · round ${n} di ${room.rounds}`,
      roll, possible: wordsFor(roll),
      initial: roundWords(n, uid).sort((a, b) => b.p - a.p),
      now, endsAt: room.endsAt || null,
      allowManual: false, opponents: true,
      onWord: (w, p) => D.set(r(`rooms/${code}/words/${n}/${uid}/${w}`), p).catch(() => {}),
      onTimeUp: endRound,
      onEndClick: isHost() ? endRound : null,
      endLabel: "Chiudi il round",
    });
  }
  const rows = players().map(p => ({ ...p, c: roundWords(n, p.id).length, pts: roundPts(n, p.id) }))
    .sort((a, b) => b.pts - a.pts);
  setOpponents(`<div class="label">In questo round</div>
    <ul class="plist live">${rows.map(p => `<li><span>${esc(p.nick)}${youTag(p.id)}</span><span class="num">${p.c} ${p.c === 1 ? "parola" : "parole"} · ${p.pts} pt</span></li>`).join("")}</ul>`);
}

function renderReview() {
  const n = room.round;
  const roll = (room.rolls?.[n] || "").split("");
  const found = new Set();
  const rows = players().map(p => {
    const ws = roundWords(n, p.id).sort((a, b) => b.p - a.p || a.w.localeCompare(b.w));
    ws.forEach(x => found.add(x.w));
    return { ...p, ws, pts: ws.reduce((a, x) => a + x.p, 0) };
  }).sort((a, b) => b.pts - a.pts);
  const best = bestWords(wordsFor(roll), 12);
  const last = n >= room.rounds;
  view(`<div class="hud"><div><div class="who">Fine del round ${n}</div><div class="round">Stanza ${code} · lancio ${roll.join(" ")}</div></div></div>
  <div class="result">
    <div class="panel stack">
      ${rows.map(p => `<div class="prow-r"><div class="pr-head"><b>${esc(p.nick)}${youTag(p.id)}</b><span class="num">+${p.pts}</span></div>
        <div class="chips">${p.ws.length ? p.ws.map(x => `<span class="${p.id === uid ? "mine" : ""}">${esc(x.w)}<i>+${x.p}</i></span>`).join("") : "<span>nessuna parola</span>"}</div></div>`).join("")}
    </div>
    <div class="panel stack">
      <h2>Le parole più lunghe possibili</h2>
      <div class="chips">${best.map(w => `<span class="${found.has(w) ? "mine" : ""}">${w}<i>+${points(w.length)}</i></span>`).join("")}</div>
      ${rankTable()}
    </div>
  </div>
  <div class="row">${isHost()
    ? `<button id="olNext" type="button">${last ? "Classifica finale" : `Lancia il round ${n + 1}`}</button>`
    : `<p class="waiting">In attesa che ${esc(hostNick())} ${last ? "chiuda la partita" : "lanci il prossimo round"}…</p>`}
    <button class="ghost" id="olLeave" type="button">Esci dalla stanza</button></div>`);
  $("olLeave").onclick = leaveRoom;
  if (isHost()) $("olNext").onclick = () => last ? D.update(r(`rooms/${code}`), { status: "done" }) : nextRound();
}

function rankTable() {
  const t = totals(), top = t[0]?.pts ?? 0;
  return `<div class="tablewrap"><table>
    <thead><tr><th>Giocatore</th><th class="num">Parole</th><th class="num">Più lunga</th><th class="num">Punti</th></tr></thead>
    <tbody>${t.map(p => {
      const longest = p.words.reduce((a, w) => w.length > a.length ? w : a, "");
      return `<tr class="${p.pts === top && top > 0 ? "first" : ""}"><td>${esc(p.nick)}${youTag(p.id)}</td><td class="num">${p.words.length}</td><td class="num">${longest ? longest.toUpperCase() : "–"}</td><td class="num">${p.pts}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function renderFinal() {
  const t = totals(), top = t[0]?.pts ?? 0, winners = t.filter(p => p.pts === top);
  const title = t.length === 1 ? `Hai totalizzato ${top} punti` : winners.length > 1 ? `Pareggio a ${top} punti` : `Vince ${winners[0].nick} con ${top} punti`;
  view(`<div class="panel">
    <div class="label">Stanza ${code} · partita finita</div>
    <h2 class="win">${esc(title)}</h2>
    ${rankTable()}
    <div class="row">${isHost() ? `<button id="olAgain" type="button">Rivincita con gli stessi giocatori</button>` : `<p class="waiting">Se ${esc(hostNick())} vuole la rivincita, resta qui.</p>`}
      <button class="ghost" id="olLeave" type="button">Esci dalla stanza</button></div>
  </div>`);
  $("olLeave").onclick = leaveRoom;
  if (isHost()) $("olAgain").onclick = () => D.update(r(`rooms/${code}`), { status: "lobby", round: 0, endsAt: 0, rolls: null, words: null });
}

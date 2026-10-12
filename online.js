// Sfida online con Firebase (Authentication + Realtime Database).
//
// Profili: nickname + password. Il nickname diventa l'email interna "<nick>@giocatori.passaparola.app",
// così Firebase Authentication garantisce che sia unico e conserva la password solo come hash (scrypt):
// la password non passa mai dal nostro database.
//
// Dati:
//   nicknames/{nick in minuscolo} = uid
//   users/{uid} = { nick, created, stats: { games, wins, points, best }, played/{partita}: true }
//   rooms/{CODICE} = { host, created, started, status: lobby|round|review|done, rounds, time, round, endsAt,
//                      rolls/{n}: "LETTERE", players/{uid}: { nick, joined }, words/{n}/{uid}/{parola}: punti }
import { firebaseConfig } from "./firebase-config.js";
import { wordsFor, rollDice, bestWords, points, esc } from "./game.js";
import { openBoard, closeBoard, setOpponents } from "./board.js";
import { show, setWhoami, goHome, dictReady } from "./app.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const EMAIL_DOMAIN = "giocatori.passaparola.app";
const $ = id => document.getElementById(id);
const view = html => { $("online").innerHTML = html; show("online"); };

let A, D, auth, db, uid = null, nick = null, offset = 0;
let code = null, room = null, unsub = null, boardRound = null;
const now = () => Date.now() + offset;
const r = path => D.ref(db, path);
const emailFor = n => `${n.toLowerCase()}@${EMAIL_DOMAIN}`;

export const PASSWORD_RULES = [
  { t: "almeno 10 caratteri", ok: p => p.length >= 10 },
  { t: "una lettera maiuscola", ok: p => /[A-Z]/.test(p) },
  { t: "una lettera minuscola", ok: p => /[a-z]/.test(p) },
  { t: "un numero", ok: p => /[0-9]/.test(p) },
  { t: "un simbolo (es. ! ? @ # . -)", ok: p => /[^A-Za-z0-9\s]/.test(p) },
];
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

async function init() {
  if (db) return;
  const [F, Auth, Db] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-database.js"),
  ]);
  A = Auth; D = Db;
  const app = F.initializeApp(firebaseConfig);
  auth = A.getAuth(app);
  await new Promise(res => { const off = A.onAuthStateChanged(auth, () => { off(); res(); }); });
  db = D.getDatabase(app);
  D.onValue(r(".info/serverTimeOffset"), s => { offset = s.val() || 0; });
}

async function loadProfile() {
  const u = auth.currentUser;
  uid = u && !u.isAnonymous ? u.uid : null;
  nick = uid ? (await D.get(r(`users/${uid}/nick`))).val() : null;
}

export async function enter() {
  if (!firebaseConfig) return renderNotConfigured();
  view(`<div class="panel narrow"><p>Collegamento in corso…</p></div>`);
  try { await init(); await loadProfile(); await dictReady; }
  catch (e) { return renderError("Non riesco a collegarmi al server di gioco. Controlla la connessione e riprova."); }
  if (!uid || !nick) return renderAuth("login");
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

// --- accesso e creazione del profilo
function pwChecklist(id) {
  return `<ul class="pwrules" id="${id}">${PASSWORD_RULES.map((x, i) => `<li data-i="${i}">${x.t}</li>`).join("")}</ul>`;
}
function bindChecklist(inputId, listId) {
  const upd = () => {
    const p = $(inputId).value;
    document.querySelectorAll(`#${listId} li`).forEach(li => li.classList.toggle("ok", PASSWORD_RULES[+li.dataset.i].ok(p)));
  };
  $(inputId).addEventListener("input", upd); upd();
}
const passwordOk = p => PASSWORD_RULES.every(x => x.ok(p));
function eyeToggle(id) {
  return `<button class="ghost small eye" type="button" data-eye="${id}" aria-label="Mostra password">Mostra</button>`;
}
function bindEyes() {
  document.querySelectorAll("[data-eye]").forEach(b => b.onclick = () => {
    const i = $(b.dataset.eye); const vis = i.type === "password";
    i.type = vis ? "text" : "password"; b.textContent = vis ? "Nascondi" : "Mostra";
  });
}

function authError(e) {
  const c = e?.code || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return "Nickname o password sbagliati.";
  if (/email-already-in-use/.test(c)) return "Questo nickname è già usato da un altro giocatore.";
  if (/password-does-not-meet-requirements|weak-password/.test(c)) return "La password non rispetta i requisiti.";
  if (/too-many-requests/.test(c)) return "Troppi tentativi. Aspetta qualche minuto e riprova.";
  if (/network/.test(c)) return "Connessione assente. Controlla internet e riprova.";
  return "Qualcosa è andato storto. Riprova.";
}

function renderAuth(mode) {
  const signup = mode === "signup";
  view(`<div class="panel narrow">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${!signup}" class="tab${signup ? "" : " on"}" id="tabLogin">Accedi</button>
      <button type="button" role="tab" aria-selected="${signup}" class="tab${signup ? " on" : ""}" id="tabSignup">Crea profilo</button>
    </div>
    <form id="authForm" class="stack" novalidate>
      <label class="field"><span class="label">Nickname</span>
        <input id="auNick" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="16" placeholder="es. andrea_pd"></label>
      ${signup ? `<p class="hint-l tight">Da 3 a 16 caratteri: lettere, numeri o trattino basso. Deve essere unico e non si può cambiare.</p>` : ""}
      <label class="field"><span class="label">Password</span>
        <span class="pwrow"><input id="auPw" type="password" autocomplete="${signup ? "new-password" : "current-password"}">${eyeToggle("auPw")}</span></label>
      ${signup ? `${pwChecklist("auRules")}
      <label class="field"><span class="label">Ripeti la password</span>
        <input id="auPw2" type="password" autocomplete="new-password"></label>` : ""}
      <div class="msg ko" id="auMsg" role="status"></div>
      <div class="row"><button type="submit" id="auGo">${signup ? "Crea profilo" : "Accedi"}</button><button class="ghost" type="button" id="auBack">Indietro</button></div>
      ${signup ? `<p class="hint-l">La password viene conservata da Firebase solo in forma cifrata: nessuno può leggerla, nemmeno chi gestisce il gioco. Se la dimentichi non si può recuperare, quindi segnatela.</p>` : ""}
    </form></div>`);
  $("tabLogin").onclick = () => renderAuth("login");
  $("tabSignup").onclick = () => renderAuth("signup");
  $("auBack").onclick = goHome;
  bindEyes();
  if (signup) bindChecklist("auPw", "auRules");
  $("authForm").onsubmit = async e => {
    e.preventDefault();
    const n = $("auNick").value.trim(), pw = $("auPw").value, m = $("auMsg");
    m.textContent = "";
    if (!NICK_RE.test(n)) { m.textContent = "Il nickname va da 3 a 16 caratteri: lettere, numeri o trattino basso."; return; }
    if (signup) {
      if (!passwordOk(pw)) { m.textContent = "La password non rispetta ancora tutti i requisiti."; return; }
      if (pw !== $("auPw2").value) { m.textContent = "Le due password non coincidono."; return; }
    } else if (!pw) { m.textContent = "Scrivi la password."; return; }
    $("auGo").disabled = true;
    try {
      if (signup) await signUp(n, pw); else await logIn(n, pw);
      setWhoami(`Giochi come ${nick}`);
      renderLobby();
    } catch (err) {
      m.textContent = err.message === "taken" ? `“${n}” è già usato da un altro giocatore.` : authError(err);
      $("auGo").disabled = false;
    }
  };
  $("auNick").focus();
}

async function signUp(n, pw) {
  const key = n.toLowerCase();
  if ((await D.get(r(`nicknames/${key}`))).exists()) throw new Error("taken");
  const cred = await A.createUserWithEmailAndPassword(auth, emailFor(n), pw);
  uid = cred.user.uid;
  await D.set(r(`nicknames/${key}`), uid);
  await D.set(r(`users/${uid}`), { nick: n, created: now(), stats: { games: 0, wins: 0, points: 0, best: "" } });
  nick = n;
}

async function logIn(n, pw) {
  await A.signInWithEmailAndPassword(auth, emailFor(n), pw);
  await loadProfile();
  if (!nick) {
    // profilo creato a metà (es. connessione caduta durante la registrazione): lo completiamo
    await D.set(r(`nicknames/${n.toLowerCase()}`), uid).catch(() => {});
    await D.set(r(`users/${uid}`), { nick: n, created: now(), stats: { games: 0, wins: 0, points: 0, best: "" } });
    nick = n;
  }
}

async function logOut() {
  leaveView(); forgetRoom(); closeBoard();
  await A.signOut(auth).catch(() => {});
  uid = null; nick = null; code = null; room = null;
  setWhoami(null);
  renderAuth("login");
}

// --- profilo
async function renderProfile() {
  leaveView();
  view(`<div class="panel narrow"><p>Carico il profilo…</p></div>`);
  const u = (await D.get(r(`users/${uid}`)).catch(() => null))?.val() || {};
  const st = u.stats || {};
  const games = st.games || 0;
  const since = u.created ? new Date(u.created).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }) : "";
  view(`<div class="setup">
    <div class="panel stack">
      <div class="label">Profilo</div>
      <div class="code nick">${esc(nick)}</div>
      ${since ? `<p class="muted">Gioca dal ${since}</p>` : ""}
      <dl class="stats">
        <div><dt>Partite online</dt><dd>${games}</dd></div>
        <div><dt>Vittorie</dt><dd>${st.wins || 0}</dd></div>
        <div><dt>Punti totali</dt><dd>${st.points || 0}</dd></div>
        <div><dt>Media a partita</dt><dd>${games ? (st.points / games).toLocaleString("it-IT", { maximumFractionDigits: 1 }) : "–"}</dd></div>
        <div class="wide"><dt>Parola più lunga</dt><dd>${st.best ? esc(st.best.toUpperCase()) : "–"}</dd></div>
      </dl>
      <div class="row"><button id="prBack" type="button">Alla sala d'attesa</button><button class="ghost" id="prOut" type="button">Esci dal profilo</button></div>
    </div>
    <div class="panel">
      <h2>Cambia password</h2>
      <form id="pwForm" class="stack" novalidate>
        <input type="text" autocomplete="username" value="${esc(nick)}" hidden>
        <label class="field"><span class="label">Password attuale</span>
          <span class="pwrow"><input id="pwOld" type="password" autocomplete="current-password">${eyeToggle("pwOld")}</span></label>
        <label class="field"><span class="label">Nuova password</span>
          <span class="pwrow"><input id="pwNew" type="password" autocomplete="new-password">${eyeToggle("pwNew")}</span></label>
        ${pwChecklist("pwRules")}
        <label class="field"><span class="label">Ripeti la nuova password</span>
          <input id="pwNew2" type="password" autocomplete="new-password"></label>
        <div class="msg" id="pwMsg" role="status"></div>
        <div class="row"><button type="submit" id="pwGo">Salva la nuova password</button></div>
      </form>
    </div>
  </div>`);
  $("prBack").onclick = renderLobby;
  $("prOut").onclick = logOut;
  bindEyes();
  bindChecklist("pwNew", "pwRules");
  $("pwForm").onsubmit = async e => {
    e.preventDefault();
    const m = $("pwMsg"), oldPw = $("pwOld").value, pw = $("pwNew").value;
    m.className = "msg ko";
    if (!oldPw) { m.textContent = "Scrivi la password attuale."; return; }
    if (!passwordOk(pw)) { m.textContent = "La nuova password non rispetta ancora tutti i requisiti."; return; }
    if (pw !== $("pwNew2").value) { m.textContent = "Le due password nuove non coincidono."; return; }
    $("pwGo").disabled = true;
    try {
      const user = auth.currentUser;
      await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, oldPw));
      await A.updatePassword(user, pw);
      m.className = "msg ok"; m.textContent = "Password aggiornata.";
      $("pwForm").reset(); document.querySelectorAll("#pwRules li").forEach(li => li.classList.remove("ok"));
    } catch (err) {
      m.textContent = /invalid-credential|wrong-password/.test(err?.code || "") ? "La password attuale è sbagliata." : authError(err);
    }
    $("pwGo").disabled = false;
  };
}

// Aggiorna le statistiche del profilo una sola volta per partita
const recorded = new Set();
async function recordGame() {
  const gameId = `${code}-${room.started || 0}`;
  if (recorded.has(gameId) || !room.players?.[uid]) return;
  recorded.add(gameId);
  try {
    if ((await D.get(r(`users/${uid}/played/${gameId}`))).exists()) return;
    const t = totals(), me = t.find(p => p.id === uid);
    if (!me) return;
    const won = t.length > 1 && me.pts === t[0].pts && me.pts > 0;
    const longest = me.words.reduce((a, w) => w.length > a.length ? w : a, "");
    await D.runTransaction(r(`users/${uid}/stats`), s => {
      s = s || { games: 0, wins: 0, points: 0, best: "" };
      return {
        games: (s.games || 0) + 1, wins: (s.wins || 0) + (won ? 1 : 0), points: (s.points || 0) + me.pts,
        best: longest.length > (s.best || "").length ? longest : (s.best || ""),
      };
    });
    await D.set(r(`users/${uid}/played/${gameId}`), true);
  } catch (e) { recorded.delete(gameId); }
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
  <div class="row"><button class="ghost small" id="olNick" type="button">Il tuo profilo</button><button class="ghost small" id="olHome" type="button">Torna all'inizio</button></div>`);
  $("olNick").onclick = renderProfile;
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
    ...(n === 1 ? { started: now() } : {}),
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
  recordGame();
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
  if (isHost()) $("olAgain").onclick = () => D.update(r(`rooms/${code}`), { status: "lobby", round: 0, endsAt: 0, started: null, rolls: null, words: null });
}

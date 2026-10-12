# Passaparola

Il gioco dei 9 dadi in versione digitale: si lanciano i dadi e si compongono parole italiane da 4 lettere in su.
Web app (PWA) installabile su iPhone e Android, gioca anche offline.

- **Punteggio:** 4 lettere = 1 punto, 5 = 2, 6 = 3 e così via fino a 9 lettere = 6 punti
- **Valgono** i verbi in tutte le coniugazioni (anche con i pronomi attaccati: *dimmi*, *mangiarlo*)
- **Non valgono** plurali, nomi propri e parole straniere
- I 9 dadi sono quelli originali, ognuno col suo colore

## Modalità

**Da solo o sul tavolo** (anche offline): uno o più giocatori a turno sullo stesso dispositivo, con clessidra e classifica. Se il dizionario rifiuta una parola valida, il tavolo può accettarla a mano.

**Sfida online**: ognuno dal suo dispositivo, stesse lettere per tutti nello stesso momento.
1. Al primo accesso si sceglie un nickname, che deve essere unico.
2. Uno crea una stanza e riceve un codice di 4 lettere; gli altri entrano con il codice.
3. Chi ha creato la stanza lancia i dadi: tutti vedono le stesse lettere e la stessa clessidra, e durante il round si vede quante parole ha trovato ciascuno, ma non quali.
4. A fine round si vedono le parole di tutti e la classifica; alla fine la classifica finale e la rivincita.

## Pubblicarla con GitHub Pages

Settings → Pages → *Deploy from a branch* → branch `main`, cartella `/ (root)` → Save.
Dopo un minuto il gioco è su `https://andpas21.github.io/passaparola/`.

## Attivare la sfida online (Firebase, gratis)

Da fare una volta sola, circa 10 minuti.

1. Vai su <https://console.firebase.google.com>, **Crea un progetto** (es. `passaparola`). Google Analytics non serve.
2. **Build → Authentication → Inizia → Sign-in method**: attiva **Anonimo**.
   Serve a riconoscere ogni dispositivo senza chiedere email o password.
3. **Build → Realtime Database → Crea database**: posizione **Belgio (europe-west1)**, avvio in **modalità bloccata**.
4. Nella scheda **Regole** del database incolla il contenuto di [`database.rules.json`](database.rules.json) e premi **Pubblica**.
5. **Impostazioni progetto** (ingranaggio) → **Le tue app** → icona **Web `</>`** → registra l'app (es. `passaparola-web`, senza Hosting).
   Copia l'oggetto `firebaseConfig` che compare.
6. Incollalo in [`firebase-config.js`](firebase-config.js) al posto di `null` (c'è un esempio nel file), controllando che ci sia anche `databaseURL`.
7. **Authentication → Impostazioni → Domini autorizzati**: aggiungi `andpas21.github.io`.
8. In [`sw.js`](sw.js) aumenta `VERSION` (es. `passaparola-v2`) e fai commit: i dispositivi che hanno già il gioco scaricano la versione nuova.

La configurazione Firebase non è segreta: a proteggere i dati sono le regole del punto 4, che impediscono di rubare un nickname altrui, di scrivere parole a nome di altri o dopo la fine della clessidra.

## Provarla in locale

    python3 -m http.server 8000

poi apri <http://localhost:8000>. Per la sfida online da locale aggiungi `localhost` ai domini autorizzati (di solito c'è già).

## Installarla sul telefono

Apri il link in Safari (iPhone) o Chrome (Android) → Condividi / menu → **Aggiungi alla schermata Home**.

## Struttura

- `game.js` dadi, punteggio, dizionario, lancio
- `board.js` il tavolo di gioco (dadi, parola, taccuino, clessidra), usato da entrambe le modalità
- `app.js` avvio, navigazione e partita locale
- `online.js` sfida online: nickname, stanze, round, classifica
- `parole.txt` dizionario (circa 118.700 parole da 4 a 9 lettere, senza plurali né nomi propri)
- `database.rules.json` regole di sicurezza di Firebase
- `sw.js` + `manifest.webmanifest` funzionamento offline e installazione

## Il dizionario

Le parole vengono dal dizionario Hunspell italiano (progetto dict-it, licenza GPL 3) incrociato con le liste di
[napolux/paroleitaliane](https://github.com/napolux/paroleitaliane), compresa la sua lista di coniugazioni verbali.
Sono escluse le forme accentate, che i dadi non possono comporre. Una parola che è sia plurale sia voce verbale
(*parti*, *fatti*) è valida.

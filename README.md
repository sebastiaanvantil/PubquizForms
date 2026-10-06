# Pubquiz Huisweekend 2026

Realtime pubquiz-website: spelers doen mee op hun telefoon, de admin bestuurt het spel vanaf zijn telefoon en de beamer laat het scorebord zien. De vragen zelf staan in de PowerPoint.

- Hosting: GitHub Pages (geen build-step)
- Backend: Firebase (Firestore + Authentication)

> **Let op:** deze repo is publiek. Antwoorden, quotes, prijzen en aliassen staan alleen in `private/` (gitignored) en komen pas in Firestore via de import in het adminpaneel.

## Status

| Onderdeel | Status |
|---|---|
| Puntentelling en naammatching (`js/scoring.js`, `js/names.js`) | klaar, met tests |
| Security rules (`firestore.rules`) | gepubliceerd, nog niet volledig getest |
| Spelerspagina (`index.html`) | gebouwd; ronde 4 werkt met tikken, slepen volgt |
| Adminpaneel (`admin.html`) | gebouwd; schermen gecontroleerd, schrijven naar Firebase nog niet getest |
| Beamerpagina | nog niet gebouwd |

### Eerste keer het adminpaneel gebruiken

1. Start de lokale server en open <http://localhost:8080/admin.html>.
2. Log in met het adminaccount uit stap 4 van de Firebase-instructies.
3. Kies **Quiz importeren** en selecteer `private/quiz-data.json`.
4. Je staat nu in de lobby. Onderin staat steeds de volgende stap; linksonder zit het menu (☰).
5. Open in een incognitovenster <http://localhost:8080/> om als groepje mee te doen, of maak testgroepjes via **Menu → Testmodus en reset**.

Een vraag sluit vanzelf zodra alle actieve groepjes hebben ingediend; je telefoon trilt en je krijgt een melding. Loopt de timer af, dan krijg je alleen een seintje en sluit je de vraag zelf (of je geeft extra tijd).

### Voorbeeldschermen van de spelerspagina

Zonder dat er een quiz loopt kun je elk scherm bekijken met `?demo=` achter het adres, bijvoorbeeld <http://localhost:8080/?demo=mc>. Mogelijke waarden: `join`, `lobby`, `intro`, `mc`, `number`, `usd`, `km`, `year`, `name`, `sort`, `bonus`, `closed`, `reveal`, `scoreboard`, `finished`. In deze modus wordt niets naar Firebase gestuurd.

## Firebase instellen (eenmalig)

De namen van knoppen in de Firebase-console veranderen af en toe. Als iets net anders heet, zoek dan naar de dichtstbijzijnde optie.

### 1. Project aanmaken

1. Ga naar <https://console.firebase.google.com> en log in met je Google-account.
2. Klik op **Create a project** / **Project toevoegen**.
3. Geef het een naam, bijvoorbeeld `pubquiz-huisweekend`.
4. Zet **Google Analytics** uit (niet nodig) en klik op **Create project**.

### 2. Firestore aanzetten

1. Kies in het linkermenu **Build → Firestore Database**.
2. Klik op **Create database**.
3. Kies als locatie een regio in `europe-west`, bij voorkeur **`europe-west4 (Netherlands)`**. De locatie kun je later niet meer wijzigen.
4. Kies **Start in production mode** (alles dicht). De echte rules zet je erin bij stap 5.

### 3. Authentication aanzetten

1. Kies in het linkermenu **Build → Authentication** en klik op **Get started**.
2. Ga naar het tabblad **Sign-in method**.
3. Klik op **Email/Password**, zet de bovenste schakelaar aan en klik op **Save**. De optie "Email link (passwordless)" blijft uit.
4. Klik op **Add new provider → Anonymous**, zet hem aan en klik op **Save**.

### 4. Adminaccount aanmaken

1. Ga in **Authentication** naar het tabblad **Users**.
2. Klik op **Add user**, vul je e-mailadres en een sterk wachtwoord in en klik op **Add user**.
3. In de lijst staat nu je account met in de kolom **User UID** een lange code. Kopieer die.

### 5. Rules publiceren

De rules staan in het bestand `firestore.rules` **in deze repo** (open het in VS Code). De console toont alleen wat er nu gepubliceerd is; in het begin is dat een standaardtekst van negen regels die alles blokkeert.

1. Open `firestore.rules` in VS Code. De UID van het adminaccount staat er al in, in de functie `isAdmin()`.
2. Selecteer alles (Ctrl+A) en kopieer het (Ctrl+C).
3. Ga in de console naar **Firestore Database → Rules**. Als de editor niet bewerkbaar is, klik dan eerst op **Develop and Test**.
4. Klik in de editor, selecteer alles (Ctrl+A) en plak (Ctrl+V), zodat de standaardtekst helemaal vervangen is.
5. Klik op **Publish**.

De UID is niet geheim en mag in de repo staan. Elke keer dat `firestore.rules` verandert, moet je de nieuwe versie opnieuw in de console plakken en publiceren.

### 6. Webconfig ophalen

1. Klik linksboven op het tandwiel → **Project settings**.
2. Scroll naar **Your apps** en klik op het webicoon **`</>`**.
3. Geef de app een naam (bijvoorbeeld `pubquiz-web`). **Firebase Hosting** blijft uit. Klik op **Register app**.
4. Je krijgt een blok `const firebaseConfig = { ... }` te zien. Kopieer dat blok en plak de waarden in `js/firebase.js`.

Deze config is publiek en mag in de repo. De beveiliging zit in de rules.

### 7. GitHub Pages toestaan als domein

1. Ga naar **Authentication → Settings → Authorized domains**.
2. Klik op **Add domain** en vul `<gebruikersnaam>.github.io` in (jouw GitHub-gebruikersnaam, zonder `https://` en zonder pad).

`localhost` staat er standaard al in, dus lokaal testen werkt meteen.

## Lokaal draaien

De pagina's gebruiken ES modules en werken daarom niet als je een bestand direct opent (`file://`). Start een lokale webserver:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Open daarna <http://localhost:8080/>. Stoppen doe je met Ctrl+C. De server geeft `private/` niet vrij, net als GitHub Pages.

## Tests

- In de browser: start de lokale server en open <http://localhost:8080/tests/>. Bovenaan staat of alles geslaagd is.
- Met Node (als je dat hebt): `node tests/run.mjs`.

## Quizdata

`private/quiz-data.json` bevat de rondes, de antwoorden en de personen met hun aliassen. Het bestand wordt nooit gecommit. Je uploadt het straks in het adminpaneel, dat het naar Firestore schrijft (`quiz/definition` en `people`).

# Pubquiz Huisweekend 2026

Realtime pubquiz-website: spelers doen mee op hun telefoon, de admin bestuurt het spel vanaf zijn telefoon en de beamer laat het scorebord zien. De vragen zelf staan in de PowerPoint.

- Hosting: GitHub Pages (geen build-step)
- Backend: Firebase (Firestore + Authentication)

> **Let op:** deze repo is publiek. Antwoorden, quotes, prijzen en aliassen staan alleen in `private/` (gitignored) en komen pas in Firestore via de import in het adminpaneel.

## Pagina's

| Pagina | Voor wie | Adres na het aanzetten van GitHub Pages |
|---|---|---|
| Spelerspagina | de groepjes, op hun telefoon | <https://sebastiaanvantil.github.io/PubquizForms/> |
| Adminpaneel | Seb, op zijn telefoon | <https://sebastiaanvantil.github.io/PubquizForms/admin.html> |
| Beamerpagina | de laptop aan de beamer | <https://sebastiaanvantil.github.io/PubquizForms/beamer.html> |

Alles is gebouwd. Lokaal en met testgroepjes is een ronde gespeeld; de generale repetitie met echte telefoons (zie onderaan) moet nog gebeuren.
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

## GitHub Pages aanzetten (eenmalig)

1. Push de repo naar GitHub: `git push -u origin main`.
2. Ga op GitHub naar de repo **PubquizForms → Settings → Pages**.
3. Kies bij **Source** voor **Deploy from a branch**.
4. Kies bij **Branch** voor `main` en de map `/ (root)`, en klik op **Save**.
5. Wacht een minuut of twee. Bovenaan dezelfde pagina verschijnt het adres van de site.
6. Controleer dat `sebastiaanvantil.github.io` bij de authorized domains van Firebase staat (zie "Firebase instellen", stap 7). Anders werkt inloggen en aanmelden niet op de echte site.

Na elke `git push` staat de nieuwe versie er binnen een paar minuten. Herlaad daarna de pagina op elke telefoon.

## De beamer

1. Open op de laptop `beamer.html` en log in met het adminaccount.
2. Klik op **Volledig scherm** (of druk op F11).
3. Wissel met Alt+Tab tussen de PowerPoint en de beamerpagina.

Wat de beamerpagina toont, kies je op je telefoon via **Menu → Beamer**:

- **Aanmelden**: QR-code naar de spelerspagina en de groepjes die zich al hebben aangemeld.
- **Wachten**: een neutraal scherm met de ronde.
- **Scorebord**: de stand, die zich van onder naar boven opbouwt. Na elke ronde staat hiervoor ook een knop direct boven de grote knop.

De QR-code wijst altijd naar de echte site, ook als je de beamerpagina lokaal opent.

## Generale repetitie

Doe dit één keer helemaal, op de echte site (dus na het aanzetten van GitHub Pages), met minstens twee echte telefoons: een iPhone met Safari en een Android-toestel met Chrome. Vul zo nodig aan met incognitovensters en testgroepjes.

### Voorbereiding

1. Open het adminpaneel op je telefoon en log in.
2. Kies **Menu → Testmodus en reset → Reset het hele spel**, zodat je schoon begint.
3. Open de beamerpagina op de laptop, log in en zet hem op **Aanmelden**.
4. Laat elke telefoon de QR-code scannen en een groepsnaam kiezen.
5. Maak er via de testmodus een paar testgroepjes bij.

### Controlelijst

Vink af wat werkt. Elke regel beschrijft wat je doet en wat je hoort te zien.

**Aanmelden**

- [ ] Twee telefoons kiezen dezelfde groepsnaam (ook met andere hoofdletters) → de tweede krijgt "Deze naam is al bezet".
- [ ] Zet de aanmelding dicht en probeer je met een nieuwe telefoon aan te melden → "Aanmelden is gesloten".
- [ ] Herlaad de pagina op een aangemelde telefoon → het groepje is nog steeds aangemeld.

**Een vraag spelen**

- [ ] Open vraag 1 → alle telefoons tonen het formulier en dezelfde aftellende timer (hooguit een seconde verschil).
- [ ] Dien op één telefoon in → de teller in het adminpaneel gaat omhoog en de telefoon toont "Antwoord ingediend".
- [ ] Herlaad een telefoon die al heeft ingediend → hij toont weer "Antwoord ingediend", niet het formulier.
- [ ] Typ op een telefoon een antwoord zonder in te dienen en herlaad → wat je typte staat er nog.
- [ ] Laat alle groepjes indienen (testgroepjes via de testmodus) → de vraag sluit vanzelf en je telefoon trilt.
- [ ] Toon het antwoord → de punten kloppen, en met − en + kun je ze per groepje aanpassen.

**De deadline**

- [ ] Open een vraag en laat één telefoon de timer uitzitten → hij toont "Tijd is op" en het formulier is weg.
- [ ] Zet een telefoon in vliegtuigmodus terwijl een vraag openstaat, tik op indienen, wacht tot de timer voorbij is en zet de verbinding weer aan → het antwoord wordt geweigerd ("Niet ontvangen") en komt niet in het adminpaneel.
- [ ] Geef met **+30 s** extra tijd nadat de tijd op was → het formulier komt terug op de telefoons.

**Dubbel indienen en meekijken (in de browser op een laptop)**

Meld een groepje aan in een gewoon venster, open een vraag, druk op F12 en ga naar het tabblad **Console**. Plak dit, en vervang `r1q1` door het item dat openstaat:

```js
const fb = await import('/PubquizForms/js/firebase.js'); // lokaal: '/js/firebase.js'
const { getApp } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
const db = fb.getFirestore(getApp('player'));
const uid = fb.getAuth(getApp('player')).currentUser.uid;
const probeer = async (naam, actie) => {
  try { await actie(); console.log('❌ GELUKT (hoort niet):', naam); }
  catch (e) { console.log('✅ geweigerd:', naam, e.code); }
};
await probeer('antwoordsleutel lezen', () => fb.getDoc(fb.doc(db, 'quiz', 'definition')));
await probeer('scores lezen', () => fb.getDocs(fb.collection(db, 'scoreEntries')));
await probeer('alle antwoorden lezen', () => fb.getDocs(fb.collection(db, 'answers')));
await probeer('alle groepjes lezen', () => fb.getDocs(fb.collection(db, 'groups')));
await probeer('personen lezen', () => fb.getDocs(fb.collection(db, 'people')));
await probeer('meldingen lezen', () => fb.getDocs(fb.collection(db, 'events')));
await probeer('spelstatus aanpassen', () => fb.updateDoc(fb.doc(db, 'game', 'state'), { phase: 'lobby' }));
await probeer('eigen naam aanpassen', () => fb.updateDoc(fb.doc(db, 'groups', uid), { name: 'Valsspeler' }));
await probeer('zichzelf punten geven', () => fb.addDoc(fb.collection(db, 'scoreEntries'), { groupId: uid, points: 99 }));
```

- [ ] Elke regel begint met ✅. Een ❌ betekent een lek in de rules: meld het en speel de quiz niet voordat het is opgelost.
- [ ] Dien daarna gewoon een antwoord in en plak dit (zelfde venster) → ook ✅, twee keer:

```js
const ref = fb.doc(db, 'answers', 'r1q1_' + uid); // het item dat openstaat
await probeer('antwoord wijzigen', () => fb.setDoc(ref, { groupId: uid, itemId: 'r1q1', value: 'A', submittedAt: fb.serverTimestamp() }));
await probeer('antwoord verwijderen', () => fb.deleteDoc(ref));
```

**Tab-meldingen (op iPhone Safari én Android Chrome)**

Doe elk van deze dingen terwijl er een vraag openstaat en blijf telkens **langer dan 5 seconden** weg. Je telefoon met het adminpaneel hoort te trillen en een melding te tonen met de groepsnaam en de duur.

- [ ] Ververs de pagina, of ga korter dan 5 seconden weg → er komt géén melding (in **Menu → Meldingen** staat hij als "kort").
- [ ] Tik in een antwoordveld zodat het toetsenbord opent en typ een antwoord → er komt géén melding.

- [ ] Wissel naar een andere app en kom terug.
- [ ] Open een nieuw tabblad en kom terug.
- [ ] Vergrendel het scherm en ontgrendel het weer.
- [ ] Doe hetzelfde in de lobby → er komt géén melding.
- [ ] Tik op **Strafpunt** → het groepje verliest een punt (zie **Menu → Scores**), en bij **Menu → Handmatige punten** kun je het terugdraaien.
- [ ] Zet een telefoon een halve minuut uit of in vliegtuigmodus → het groepje krijgt het label "stil" in het adminpaneel.

**Ronde 4**

- [ ] Houd een naam vast en sleep hem naar een vak; sleep hem ook weer terug.
- [ ] Scroll met je duim over de namen → er wordt niets per ongeluk versleept.
- [ ] Tik een naam aan en tik daarna op een vak → de naam verhuist.
- [ ] Dien in met een paar namen niet geplaatst → je krijgt eerst een waarschuwing.

**Bonus, scorebord en afronden**

- [ ] Open een bonus → de telefoons tonen "Bonusronde!"; tik de groepjes aan in volgorde en sla op.
- [ ] Sla een andere bonus over → er komen geen punten bij.
- [ ] Zet na een ronde het scorebord op de beamer → de stand bouwt zich op en is van achter in de kamer leesbaar.
- [ ] Controleer op een telefoon van een groepje dat nergens een score of goed/fout te zien is.
- [ ] Diskwalificeer een testgroepje → het verdwijnt van het scorebord.
- [ ] Reset het spel aan het eind, zodat je op de avond zelf schoon begint. De quiz en je timers blijven staan.
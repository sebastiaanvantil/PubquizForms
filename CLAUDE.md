# Pubquiz Huisweekend 2026 — projectinstructies

Dit bestand is de vaste context voor dit project. Lees het aan het begin van elke sessie en houd je eraan. Als iets hier botst met een losse opdracht, vraag het dan na bij Seb.

## Wat we bouwen

Een realtime pubquiz-website voor een huisweekend. De vragen zelf staan in een PowerPoint die Seb op een laptop via de beamer laat zien. De website regelt alleen het spel eromheen:

- **Spelerspagina** (`index.html`): per groepje gebruikt één persoon zijn of haar telefoon. Het groepje meldt zich aan met een groepsnaam, zonder account. Daarna komt het in een lobby waar het rondenummer, het vraagnummer en een antwoordformulier verschijnen.
- **Adminpaneel** (`admin.html`): alleen Seb heeft toegang, na inloggen. Hij bestuurt het hele spel vanaf zijn **telefoon**.
- **Beamerpagina** (`beamer.html`): draait op de laptop naast de ppt. Laat het scorebord en het aanmeldscherm zien wanneer de admin dat aanzet. Ook hiervoor moet je ingelogd zijn als admin.

Hosting gaat via **GitHub Pages**, de backend is **Firebase** (Firestore + Authentication).

## Harde regels

1. **Geen antwoorden in de repo.** De repo is publiek en GitHub Pages serveert alle bestanden. De antwoordsleutel, de quotes met namen, de prijzen en de aliassen staan alleen in `private/`. Die map staat in `.gitignore`, net als `*.pptx`. Ze komen pas in Firestore via een import in het adminpaneel. Zet ook in dit bestand, in commits en in comments nooit antwoorden.
2. **Spelers zien nooit scores**, ook die van zichzelf niet. Ze zien ook niet of hun antwoord goed was. Dit moet worden afgedwongen in de Firestore security rules, niet alleen in de UI.
3. **Indienen is definitief.** Een antwoord kan maar één keer worden aangemaakt en daarna niet meer worden gewijzigd of verwijderd. Ook dit gaat via de rules.
4. **De deadline geldt op de server.** Een antwoord dat na de deadline binnenkomt, wordt door de rules geweigerd (`request.time`), met een marge van ±2 seconden. Als een groepje niet op tijd indient, krijgt het 0 punten en gaat het spel gewoon verder. Bij tijd op wordt niets automatisch ingediend.
5. **UI-taal is Nederlands.** De code en comments mogen in het Engels.
6. **Geen build-step.** Gebruik gewone HTML, CSS en JavaScript (ES modules), en de Firebase JS SDK (modular, v10+) via de gstatic CDN. Dan werkt alles direct op GitHub Pages.
7. **Mobile first.** Alle spelers- en adminschermen moeten goed werken op een telefoon van 360–430px breed, met één hand en met dronken duimen: grote tikdoelen (minimaal 48px), hoog contrast en geen hover-afhankelijkheid.

## Bestandsstructuur (richtlijn)

```
index.html            spelerspagina
admin.html            adminpaneel
beamer.html           beamerweergave (laptop)
css/                  gedeelde styles
js/firebase.js        init + config (de Firebase-webconfig is publiek, dat is ok)
js/player.js
js/admin.js
js/beamer.js
js/scoring.js         pure functies voor puntentelling, zonder Firebase (testbaar)
js/names.js           pure functies voor naammatching
js/dragsort.js        touch drag & drop voor ronde 4
firestore.rules
tests/                eenvoudige tests voor scoring.js en names.js (in de browser of met node)
private/              GITIGNORED: quiz-data.json + uitgepakte ppt-media
README.md             setup-handleiding voor Seb
```

## Datamodel (Firestore)

- `game/state`: **publiek leesbaar**, alleen de admin kan schrijven. Bevat de huidige fase, ronde-index en -titel, vraaglabel, vraagtype, `itemId`, `deadline` (timestamp of null), `registrationOpen`, `beamerView` en een `publicPayload` met **alleen** wat de telefoon nodig heeft: het aantal MC-opties, de valuta (`EUR`/`USD`), de te sorteren namen voor ronde 4 en de invoerhint. Hierin staan nooit antwoorden.
- `quiz/definition`: **alleen admin**. Bevat de volledige quiz met antwoorden, opgebouwd uit de import van `private/quiz-data.json`.
- `people/{personId}`: **alleen admin**. Bevat de weergavenaam en de toegestane schrijfwijzen.
- `groups/{uid}`: het groepje (uid via Firebase Anonymous Auth). Velden: naam, `createdAt`, `lastSeen`, `disqualified`. Een groepje mag zijn eigen document aanmaken en daarin alleen `lastSeen` bijwerken. Alleen de admin kan alle groepjes lezen.
- `groupNames/{genormaliseerdeNaam}`: wordt alleen aangemaakt om een groepsnaam te claimen, zodat namen uniek blijven.
- `answers/{itemId}_{uid}`: alleen `create`, door het groepje zelf, en alleen als `game/state` op dit `itemId` staat met fase `question_open` en de deadline nog niet voorbij is. Een groepje mag zijn eigen antwoorden lezen, zodat het na herladen weet dat het al heeft ingediend. De admin mag alles lezen en voor testgroepjes ook schrijven.
- `scoreEntries/{autoId}`: **alleen admin**. Dit is het puntenlogboek: `groupId`, `itemId`, `points`, `source` (`auto` | `override` | `bonus` | `penalty` | `manual`) en `note`. Totalen worden in de admin- en beamerclient berekend. Zo kan elke correctie worden teruggedraaid en blijft alles herberekenbaar.
- `events/{autoId}`: tab-verlaat-meldingen. Een groepje mag alleen aanmaken met zijn eigen `groupId`, alleen de admin mag lezen.

De admin wordt in de rules herkend aan zijn UID (`request.auth.uid == '<ADMIN_UID>'`). Seb maakt het account handmatig aan in Firebase en vult de UID in.

## Spelflow en fases

`lobby` → `round_intro` → per item: `question_open` → `question_closed` → `reveal` → … → `round_scoreboard` → volgende ronde → … → `finished`.

- **question_open**: de telefoon toont het formulier, met een aftellende timer als die is ingesteld. Bij een vraag zonder timer sluit de admin de vraag handmatig. De admin kan de vraag ook altijd eerder sluiten of de timer verlengen.
- **question_closed**: de telefoons tonen "Antwoord ingediend" of "Tijd is op".
- **reveal (antwoordscherm)**: alleen de admin ziet het juiste antwoord, het antwoord van elk groepje en de automatisch berekende punten. Per groepje kan hij handmatig goed of fout keuren (`override`). De telefoons tonen een neutraal wachtscherm. Daarna klikt de admin door naar het volgende item.
- **round_scoreboard**: tussen de rondes ziet de admin het scorebord. Met één tik zet hij het ook op de beamer (`beamerView = 'scoreboard'`).
- Telefoons tonen in de lobby en tussen vragen altijd een duidelijke wachtstatus met het ronde- en vraagnummer.

Timers zijn gebaseerd op een server-`deadline`. Clients corrigeren voor het verschil tussen hun eigen klok en de serverklok, zodat alle telefoons gelijk lopen.

## Vraagtypes en puntentelling

Alle puntentelling staat in `js/scoring.js` als pure functies met tests.

| type | invoer op telefoon | punten |
|---|---|---|
| `mc` | alleen knoppen A/B/C/D (geen antwoordtekst) | 1 bij goed |
| `exact_number` | getal | 1 bij exact goed |
| `margin_number` | getal (met valutasymbool als dat is ingesteld) | 1 als `abs(antwoord − juist) <= marge` (marge inclusief) |
| `closest_rank` | getal, met valuta- of eenheidsaanduiding | zie hieronder |
| `sort_two_bins` | 20 namen in 2 vakken slepen | 1 per goed geplaatste naam; niet geplaatst telt als fout |
| `name` | tekstveld | 1 als de naam overeenkomt met een van de goedgekeurde personen |
| `bonus_manual` | geen invoer (telefoon toont "Bonusronde!") | de admin vult de punten per groepje in |

**`closest_rank`**: n is het aantal actieve (niet-gediskwalificeerde) groepjes. Sorteer de groepjes die op tijd hebben ingediend op `abs(antwoord − juist)`. Gebruik *competition ranking*, waarbij een gedeelde plek dubbel telt: afstanden 0, 0, 5, 9 geven rangen 1, 1, 3, 4. De punten zijn `max(0, n − rang)`. Groepjes zonder (geldig) antwoord krijgen 0.

**`bonus_manual`**: om het invullen op de telefoon snel te maken, tikt de admin de groepjes aan in volgorde van finish. Dat geeft standaard 3, 2, 1, 0, 0…, en elke waarde blijft daarna aanpasbaar. Bonusitems moeten ook kunnen worden **overgeslagen**.

**Getallen invoeren**: gebruik `inputmode="decimal"`. Accepteer Nederlandse en Engelse notatie (`1.299,99`, `1299.99`, `1299`) en valutatekens of spaties die zijn meegetypt. Toon het valutasymbool (€ of $) vóór het veld, zoals het per vraag in de data staat.

## Naammatching (ronde 5 en 6)

Dit staat in `js/names.js` en heeft tests.

1. Normaliseer: trim, lowercase, accenten weg (NFD), alleen letters.
2. Een **exacte match** met een alias uit `people` is goed.
3. **Typfout-tolerantie**: Levenshtein-afstand 1, alleen bij invoer van 5 of meer tekens en alleen als er precies één persoon het dichtst bij ligt. Als de invoer exact of binnen tolerantie overeenkomt met een andere persoon, is het fout. Voorbeeld: Flo en Floor zijn verschillende mensen. "flo" is Flo, "floor" is Floor, en dat mag nooit door elkaar lopen.
4. Een vraag kan meerdere goede personen hebben (bij gelijkspel in ronde 6).
5. Bij twijfel (geen match, maar wel afstand 2) markeert de admin-UI het antwoord als "controleren", zodat Seb handmatig kan goed- of afkeuren.

## Tab-verlaat-detectie

- Luister op de spelerspagina naar `visibilitychange`, `pagehide`/`pageshow`, `blur`/`focus` (blur alleen met debounce) en `online`/`offline`.
- Schrijf bij verlaten direct een event. Mobiele browsers bevriezen JavaScript vaak voordat dat gelukt is. Schrijf daarom **bij terugkomst altijd** een event met de afwezigheidsduur. Daarnaast is er een heartbeat (`lastSeen` elke 10 seconden), zodat de admin ook een "stil" groepje ziet.
- Ook het vergrendelen van het scherm telt als verlaten.
- Het adminpaneel toont een melding (toast + vibratie, `navigator.vibrate`, als dat beschikbaar is) met groepsnaam, tijdstip, duur en tijdens welke vraag. Er staan knoppen "Strafpunt(en)" (instelbaar, standaard −1) en "Negeren". De admin beslist; er worden nooit automatisch punten afgetrokken.
- Er is een logboek met alle meldingen in het menu.

## Admin-UI-eisen

- Het adminpaneel is volledig met één hand op de telefoon te bedienen. Onderin staat één grote primaire knop die altijd de logische volgende stap is ("Open vraag", "Sluit vraag", "Toon antwoord", "Volgende"), met een bevestiging bij onomkeerbare stappen.
- Er is altijd een menu (vaste knop) met: scores per groepje, handmatige punten (+/− met notitie), groepjes beheren (hernoemen, diskwalificeren, verwijderen), meldingenlog, aanmelding open/dicht, beamerweergave kiezen, en naar een specifiek item springen.
- Er is een live teller: hoeveel groepjes hebben ingediend (x/n), en welke nog niet.
- Een **instellingenscherm per item**, waar je de timer aan- of uitzet met een duur, en de antwoorden en marges controleert of aanpast. Alles wordt opgeslagen in `quiz/definition`.
- **Import**: upload `private/quiz-data.json` en schrijf het naar `quiz/definition` en `people`.
- **Testmodus**: knoppen om nepgroepjes aan te maken en willekeurige antwoorden in te dienen, plus een volledige reset van het spel (met dubbele bevestiging).

## Spelers-UI-eisen

- Bij aanmelden: groepsnaam (2–24 tekens, uniek). Daarna blijft het groepje aangemeld via de anonieme Firebase-sessie, ook na herladen of als de verbinding wegvalt.
- Het scherm toont altijd ronde, vraag, timer en de status van het formulier. Laat een "Weet je het zeker?"-bevestiging zien vóór indienen, met een vinkje "Dit niet meer vragen" waarmee het groepje de bevestiging voor volgende vragen uitzet (een waarschuwing, zoals niet-geplaatste namen in ronde 4, blijft altijd verschijnen). Daarna is het formulier vergrendeld.
- Ronde 4: touch drag & drop met Pointer Events (HTML5 drag & drop werkt niet op touch). De namen zijn per groepje willekeurig gehusseld. Er zijn twee duidelijke vakken. Een naam kan worden teruggesleept. Er is een fallback met tikken: tik een naam aan en tik daarna een vak. Indienen kan ook als nog niet alles is geplaatst, met een waarschuwing. Scrollen mag niet per ongeluk een sleep starten.
- Geen scores, geen goed/fout-feedback.

## Werkwijze

- Werk in kleine, werkende stappen en commit per afgeronde stap met een duidelijke Nederlandse of Engelse commitboodschap. Controleer vóór elke commit met `git status` dat er niets uit `private/` of geen `.pptx` wordt meegenomen.
- Schrijf en draai tests voor `scoring.js` en `names.js` voordat je ze in de UI gebruikt.
- Handelingen die Seb zelf moet doen (Firebase-console, GitHub Pages-instellingen) staan stap voor stap in `README.md`. Vraag hem erom wanneer je ze nodig hebt, en ga niet uit van waarden die hij nog niet heeft gegeven.
- Als de data uit de ppt onduidelijk is (bijvoorbeeld welk MC-antwoord juist is, of een prijs die slecht leesbaar is), gok dan niet maar vraag het Seb.

# Italiensk översättningsproxy

En liten server som gör en italiensk "spegel" av din svenska hemsida. Den hämtar
käll-sidan **live vid varje anrop** (ingen sid-cache), översätter texten till
italienska via DeepL, och skickar sedan resultatet till besökaren. CSS, JS,
bilder och typsnitt skickas igenom oförändrade så designen ser exakt likadan ut.

## Hur "realtid" fungerar

- Servern cachar **inte** hela sidor. Varje request hämtar färsk HTML från din
  svenska sida. Ändrar du texten där, syns det på den italienska sidan direkt
  nästa gång någon laddar den — ingen publiceringsfördröjning.
- Det som cachas är **enskilda textsträngar** (t.ex. "Välkommen till vårt
  bröllop" → dess italienska översättning), i sju dagar. Det gör att sidan
  laddar snabbt och att du inte betalar för att DeepL översätter samma
  mening om och om igen. Ny eller ändrad text upptäcks och översätts
  automatiskt eftersom det är en ny sträng som inte finns i cachen.

## Snabbstart lokalt

```bash
npm install
cp .env.example .env
# öppna .env och fyll i:
#   SOURCE_URL=https://din-svenska-sida.se
#   DEEPL_API_KEY=din-nyckel
npm start
```

Servern startar på `http://localhost:3000` och speglar/översätter
`SOURCE_URL`.

## Skaffa en DeepL API-nyckel

1. Gå till https://www.deepl.com/pro-api
2. Skapa ett konto (Free-planen räcker gott för en bröllopssida — 500 000
   tecken/månad gratis)
3. Nyckeln du får hamnar under Account → API Keys. Gratis-nycklar slutar
   alltid på `:fx` — koden känner av det automatiskt och använder rätt
   DeepL-endpoint.

## Driftsättning (så den blir en riktig, publik hemsida)

Enklast är **Render.com** (gratis-tier funkar fint för en bröllopssida):

1. Lägg upp den här mappen i ett GitHub-repo
2. Gå till render.com → "New Web Service" → koppla repot
3. Build command: `npm install`
4. Start command: `npm start`
5. Under Environment, lägg in `SOURCE_URL` och `DEEPL_API_KEY`
6. Deploya — du får en URL typ `https://ditt-brollop-it.onrender.com`

Vill du ha en egen italiensk domän (t.ex. `it.dittbrollop.se` eller
`ilnostromatrimonio.it`) pekar du bara domänens DNS mot Render-tjänsten,
samma sätt som med vilken annan hemsida som helst.

Railway, Fly.io eller en egen liten VPS fungerar precis lika bra — det enda
kravet är Node.js 18+ och att miljövariablerna sätts.

## Begränsningar värda att känna till

- **Fungerar bäst för statisk HTML** (vilket din sida är) — sidor byggda med
  React/Lovable där innehållet ritas upp av JavaScript i webbläsaren kräver
  en annan lösning (headless-browser-rendering), eftersom servern då bara
  skulle se en tom HTML-skalett.
- Formulär som postar data (t.ex. RSVP) går igenom proxyn men skickas vidare
  till samma URL — testa det flödet specifikt så inget italienska besökare
  fyller i tappas bort.
- DeepL har viss gratis-kvot (500 000 tecken/månad på Free). För en
  bröllopssida med begränsat antal sidor och besökare räcker det med
  marginal.

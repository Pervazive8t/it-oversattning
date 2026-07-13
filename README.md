# Live-översättning SV → IT (Chrome-tillägg)

Bevakar sidan kontinuerligt och visar en italiensk översättning av ny/ändrad
text i en egen ruta längst ner på skärmen — fungerar oavsett HUR texten
hamnar på sidan (statisk HTML, JavaScript, React, websockets, vad som helst).

## Varför en egen ruta istället för att skriva in i sidan?

En tidigare version skrev den översatta texten direkt i sidans egna element.
Det funkade i några sekunder men "hoppade tillbaka" till svenska — det berodde
på att sidan är byggd med ett ramverk (troligen React) som har sin egen
interna kopia av texten. När sidan uppdaterar sig själv (ny mening från
mikrofonen) skriver ramverket tillbaka sin egen svenska version ovanpå vår
översättning, eftersom det inte vet att vi ändrat något.

Lösningen: tillägget skriver aldrig i sidans egna element. Istället visas
den italienska översättningen i en egen ruta som bara tillägget äger och
styr — den kan inte skrivas över av sidans kod, eftersom sidans kod aldrig
rör vår ruta.

Det här är backup-lösningen ifall `kolla-live-text`-verktyget visar att er
mikrofon-text läggs till med JavaScript (då fungerar inte
`it-oversattning-proxy`-servern).

## Installation (utvecklarläge, ingen publicering krävs)

1. Öppna Chrome, gå till `chrome://extensions`
2. Slå på **Utvecklarläge** (växeln uppe till höger)
3. Klicka **Läs in okomprimerat** (Load unpacked)
4. Välj den här mappen (`live-translate-extension`)
5. Tilläggets ikon dyker upp i verktygsfältet

## Konfigurera

1. Se till att er `it-oversattning-proxy`-server är uppe och körs (t.ex. på
   Render) — tillägget pratar med den, inte med DeepL direkt. Det beror på
   att DeepL:s API inte stödjer anrop direkt från en webbläsare (ingen
   CORS-preflight-hantering), oavsett vilka behörigheter tillägget har.
2. Högerklicka tilläggets ikon → **Alternativ**
3. Klistra in er server-URL, t.ex. `https://jacobannabrollop.onrender.com`
4. Klicka **Spara**

DeepL-nyckeln behöver du alltså bara ha på ett ställe — i serverns `.env` —
inte i tillägget.

## Använd

1. Gå till sidan som ska översättas (t.ex.
   `https://backend.illumitype.se/listener/annajacob`)
2. Klicka tilläggets ikon → **Aktivera**
3. Klart — all text på sidan översätts nu direkt, och ny text som dyker upp
   (t.ex. från mikrofonen) översätts inom bråkdelen av en sekund efter att
   den slutat ändras

## Hur det undviker att översätta halvfärdiga meningar

Om taligenkänning bygger upp en mening ord för ord ("Hej" → "Hej och" → "Hej
och välkomna...") väntar tillägget tills texten varit oförändrad i en liten
stund (`debounceMs`, standard 600 millisekunder) innan den skickas för
översättning. Annars skulle varje mellansteg översättas i onödan.

Vill du ha snabbare respons (på bekostnad av risk att fånga halvfärdiga
ord): sänk `debounceMs` i inställningarna, t.ex. till `300`.

## Testat

Kärnlogiken (upptäcka ny text, debounce, undvika att tilläggets egna
skrivningar triggar en oändlig översättningsloop) är testad i en simulerad
DOM-miljö med tre scenarier — initial text, egen skrivning, och simulerad
live-textuppdatering — samtliga gav rätt resultat.

## Begränsningar

- Fungerar bara i den webbläsare/dator där tillägget är installerat (till
  skillnad från proxy-servern, som ger en offentlig länk). Perfekt för ert
  projektor-scenario med en dator, men skickar ingen länk till gäster.
- Text i `<canvas>` eller video fångas inte (samma begränsning som proxyn).
- Om sidan har extremt mycket text kan initial genomgång ta någon sekund
  extra vid sidladdning — därefter är det bara nya/ändrade delar som
  bearbetas.

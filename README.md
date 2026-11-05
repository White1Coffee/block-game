# WhiteBrick — Inventory & LAN 0.6

WhiteBrick is de uitbreiding van het bestaande project. De oude IndexedDB-database en LocalStorage-sleutels heten intern nog **wildbrick**: dit bewaart bestaande werelden, skins en instellingen. Ze worden niet gewist of naar een andere origin verplaatst.

## Starten

Node.js 22.12+ en npm zijn vereist.

```sh
npm install
npm run dev
```

Open het adres dat Vite toont (standaard http://localhost:8800). Voor de oude lokale statische server:

```sh
npm run build
npm run server
```

Development draait nu standaard op **http://localhost:8800** en toont ook alle gedetecteerde LAN-IPv4-adressen. `npm run dev` biedt op dezelfde poort de multiplayer-API en WebSocketserver. `npm run server` blijft de oude lokale statische server op 4173, zonder multiplayer; gebruik voor LAN de onderstaande opdracht. Development, preview en de productieservers ondersteunen de publieke skinproxy. Alleen statische dist-hosting heeft een aanvullende proxy nodig voor username-lookup. Gebruik dezelfde host en poort om eerdere singleplayersaves te zien: localhost, 127.0.0.1, het LAN-IP en verschillende poorten hebben aparte browseropslag. Het wissen van browserdata verwijdert saves en de lokale LAN-identiteit.

## Samen spelen op LAN — poort 8800

Op de hostcomputer, vanuit deze projectmap:

```sh
npm install
npm run start:lan
```

Dit voert eerst de typecheck en productiebuild uit en start daarna de TypeScript/Node-server op **0.0.0.0:8800**. De console toont het echte lokale adres. Andere spelers openen **http://HOST-IP:8800** op dezelfde wifi of hetzelfde lokale netwerk; zij hebben alleen een desktopbrowser nodig. Op de host kan `http://localhost:8800` worden gebruikt. Als Windows Firewall dit blokkeert, sta Node.js alleen toe voor je privénetwerk. Gastwifi/clientisolatie kan onderlinge verbindingen blokkeren. Er wordt geen routermapping, tunnel, UPnP of cloudhosting gestart.

Iedereen ziet Singleplayer, Multiplayer, Character en Settings. Singleplayer gebruikt uitsluitend de eigen browseropslag; er wordt geen gameplay-WebSocket geopend. Via **Multiplayer** zie je status, spelersaantal, ping en wereldnaam. Kies een naam en klik **Join server**. Escape pauzeert je besturing, maar de gedeelde wereld blijft draaien. Via het multiplayerpauzemenu kun je ook live je skin aanpassen.

`npm run dev` is het alternatief tijdens ontwikkeling: dezelfde LAN-server draait dan naast Vite op poort 8800 en de console toont zowel het lokale als het multiplayer-LAN-adres. Start dev en start:lan niet tegelijk op dezelfde poort of dezelfde wereld. Een wereldlock voorkomt dat twee processen dezelfde save overschrijven. Wie oude singleplayersaves op 5173 gebruikt, kan `npm run dev -- --port 5173` starten en op de oorspronkelijke hostnaam verdergaan; de multiplayer-URL gebruikt dan ook 5173. Development-HMR gebruikt zijn eigen WebSocket, onafhankelijk van een gameplayverbinding.

### Serverinstellingen en rechten

Pas [server/config.json](server/config.json) aan voordat je start. Belangrijkste velden zijn `port` (8800), `host` (0.0.0.0), `maxPlayers` (1–8), `worldName`, `seed`, `defaultMode`, `viewDistance`, `simulationDistance`, `pvpEnabled`, `allowCommands`, `playerCommands`, `adminIds` en `autosaveIntervalSeconds`. De configuratie wordt gevalideerd. De seed geldt bij het aanmaken van een nieuwe serverwereld; een bestaande wereld behoudt zijn seed en generatorversie. `PORT` kan voor een afzonderlijke testserver de poort overschrijven.

Wie op **dezelfde computer als het serverproces** speelt, krijgt automatisch **Admin**: via localhost, 127.0.0.1, ::1 of een eigen netwerkadres van de host. Dit werkt bij `npm run dev` en `npm run start:lan`. De server controleert het daadwerkelijke verbindingsadres; een gekozen naam, clientrol of forwarding-header geeft geen rechten. Ook na `deop` blijft een lokale verbinding automatisch Admin. Die automatische rechten gelden voor de verbinding en worden niet als permanente `op` opgeslagen: op een andere computer is dezelfde identiteit weer Player, tenzij afzonderlijk `op` is gegeven.

Spelers op andere computers beginnen als **Player**, ongeacht hun gekozen naam. Standaard is voor hen alleen `/help` toegestaan. Geef aanvullende rechten in de **lokale console van `npm run start:lan`**:

```text
players
op <player-id-uit-de-console>
deop <player-id>
save
stop
```

Joinmeldingen in de console tonen het echte player-ID. `op`/`deop` worden opgeslagen. `adminIds` in de configuratie geeft permanente beheerrechten aan bekende IDs; `playerCommands` staat geselecteerde commands toe aan gewone spelers. Gebruik namen nooit als authenticatie. `/give Bob diamond 64` en `/gamemode survival Bob` wijzigen een andere verbonden speler uitsluitend als de aanvrager Admin is. `/gamemode`, `/give`, `/summon` en `/gamerule` worden in multiplayer op de server uitgevoerd; chat, join- en leavemeldingen worden gedeeld.

### Identiteit, opslag en afsluiten

De server maakt een willekeurig player-ID en geheim reconnecttoken. Alleen de hash van het token staat in de server-save; het token zelf staat in de browseropslag voor deze server en origin. Een bestaande naam bewijst geen identiteit. Dezelfde identiteit kan niet twee actieve sessies hebben. Wissen van browseropslag, een andere browser/ander apparaat of een andere hostnaam/origin maakt die lokale identiteit niet vanzelf beschikbaar. **Nieuwe LAN-identiteit** in het multiplayer-menu begint bewust een nieuwe speler; oude data op de server blijft bestaan.

De gedeelde save staat standaard in:

```text
server/data/worlds/MultiplayerWorld/world.json
server/data/worlds/MultiplayerWorld/world.backup.json
server/data/skins/
```

Saves bevatten versiebeheer, serveridentiteit, alle spelers en persoonlijke inventories, XP/durability/enchantments, blokwijzigingen en states, mobs, containers, ovens, gewassen, spawnpoints, gamerules, dagtijd en weer. De server schrijft geserialiseerd naar een tijdelijk bestand, synchroniseert dit en vervangt daarna atomisch de hoofdsave. De vorige geslaagde save blijft als back-up bewaard; een beschadigde hoofdsave kan uit die back-up worden hersteld. Kortdurende Windows-bestandslocks worden begrensd opnieuw geprobeerd. Een bezette poort of wereldlock wordt duidelijk gemeld en schrijft geen verouderde wereld terug.

Autosave loopt standaard iedere 60 seconden, ook zonder spelers. Join/leave en wijzigende commands slaan eveneens op. **Stop bij voorkeur met `stop` of Ctrl+C in de serverterminal.** De server blokkeert nieuwe joins, waarschuwt spelers, bewaart de staat en sluit verbindingen. Je browser sluiten stopt de server niet. Een plotselinge stroomuitval/proceskill kan de laatste nog niet opgeslagen wijzigingen verliezen. Data in `server/data/` wordt niet meegebouwd of als webbestand aangeboden. Maak voor handmatige back-ups een kopie terwijl de server gestopt is.

### Netwerkarchitectuur en controles

Het browserpad kiest via `MultiplayerSession` een netwerkadapter; de bestaande lokale Game blijft de singleplayerroute. Beide gebruiken dezelfde TypeScript-logica voor generatie, collision, beweging, items, recepten, mobs, blokinteracties, vuur en commands. De server draait op 20 ticks/s en verzendt snapshots op 10 Hz. De eigen speler gebruikt voorspelling met input-sequencenummers en servercorrectie; andere spelers gebruiken interpolatie, de bestaande Classic/Slim-modellen, naamlabels, animaties en een gedeelde skincache. PNGs worden volledig gevalideerd en alleen bij skinwijzigingen verstuurd; bewegingsupdates bevatten skinreferenties.

Chunks gebruiken dezelfde seed en generatorversie, snapshots van wijzigingen, revisies en een gedeelde checksum. Bij een revisiegat of checksumverschil kan de client een volledige actuele chunk opvragen. Streaming is begrensd en prioriteert nabije chunks. Entiteiten, drops en containers worden op bereik gefilterd. Mining, plaatsing, combat, drops/pickups, crafting en containertransacties worden server-side gevalideerd. Unieke transactie-IDs voorkomen dat een herhaald request opnieuw items verplaatst. Twee spelers kunnen dezelfde chest veilig gebruiken. De server accepteert invoer, niet een door de client opgegeven inventory, positie, damage of adminrol.

WebSockets delen dezelfde HTTP-server en poort; het browseradres wordt afgeleid van `window.location`. De implementatie volgt de [ws-documentatie voor een bestaande HTTP-server en heartbeats](https://github.com/websockets/ws#external-https-server). Skinvalidatie gebruikt de [PNG-decoder van pngjs](https://github.com/pngjs/pngjs). Er zijn packetlimieten, validatie, rate limiting, heartbeat/time-outs, backpressure, originscontrole en een beveiligde lokale beheerconsole. HTTP is bedoeld voor een vertrouwd thuis-LAN; tokens worden zonder aanvullende TLS niet versleuteld over het netwerk vervoerd.

```sh
npm run typecheck
npm run test
npm run build
npm run test:lan
npm run test:inventory
```

`test:lan` gebruikt een eigen testdatamap en poort 18800, start de echte productieserver en test twee onafhankelijke Edge-browsersessies, skins, beweging, bouwen/minen, chat/permissions, mobs, regels, scheiding van singleplayersaves, live skinwissels, reconnect, hostbrowser sluiten en een volledige serverherstart. Protocoltests gebruiken ook gesimuleerde WebSocketclients en controleren echte serverstate en inventorytransacties. Een fysieke test met twee afzonderlijke computers op wifi is **niet** uitgevoerd. Er is geen garantie voor 60 FPS of een gemeten belastingtest met acht fysieke spelers.

Er is alleen de bestaande Overworld: Nether/End, redstone, trading en transportsystemen uit de latere roadmap zijn nog niet geïmplementeerd. De inventory gebruikt nu echte slots en afzonderlijke tooldata. LAN-multiplayer voegt geen officiële Minecraft-assets of verplichte login toe.

## Besturing

| Input | Actie |
|---|---|
| WASD / muis | Bewegen / kijken |
| Spatie | Springen, zwemmen, klimmen, stijgen tijdens vliegen |
| Dubbel Spatie | Creative vliegen wisselen |
| Shift | Sluipen / dalen; plaats tegen interactieve blokken |
| Ctrl | Sprinten |
| Links ingedrukt | Minen; mobs in bereik aanvallen |
| Rechts | Plaatsen, boog schieten of blok gebruiken |
| 1–9 / scroll | Hotbar |
| E | Player inventory en 2×2 crafting |
| F | Geselecteerd voedsel eten; anders bosbessen indien aanwezig |
| F5 | First person → third person achter → voor |
| F3 | FPS, positie, kijkrichting, chunks, draw calls, biome en seed |
| R | Creative: terug boven spawn |
| Esc | Pauze / inventory sluiten |
| T / / | Lokale chat / commandinput openen |
| Enter / Escape in chat | Versturen / sluiten en muisbesturing hervatten |
| ↑ / ↓ / Tab in chat | Geschiedenis / autocomplete (Shift-Tab achteruit) |

Besturing kan in Settings worden aangepast. E typt tekst als het zoekveld actief is; gebruik dan Esc of Verder bouwen.

De staande spelerhitbox is 1 × 1 blok breed en 2 blokken hoog. Sluipen verlaagt de hoogte tot 1,5 blok; opstaan kan alleen als het plafond hoog genoeg is. Plaatsen controleert de volledige spelerhitbox, ook bij deuren van twee blokken hoog. Bouwblokken kunnen water en losse vegetatie vervangen. Survival-mining begint opnieuw wanneer je een ander blok of hotbarslot kiest of naast het blok kijkt.

Ctrl+A selecteert tijdens het spelen geen paginatekst; in tekstvelden kun je wel normaal alles selecteren. Ctrl+S opent geen browservenster om de pagina op te slaan. Escape sluit inventory of chat en hervat de muisbesturing; vanuit het pauzemenu kun je met Escape verder spelen.

## Survival

De HUD heeft tien hartjes, tien hunger-iconen, een XP-balk/level, luchtvoorraad onder water en een armorindicator voor een gedragen borstplaat. Damage heeft korte invulnerability frames en feedback. Vallen, vijanden, pijlen, verdrinken, vuur/lava en starvation kunnen schade geven. Saturation en hunger bepalen regeneratie. Sprinten verbruikt meer energie en wordt beperkt bij lage hunger.

Nieuwe werelden bieden moeilijkheid, keepInventory en een instelbare dagduur. Na overlijden verschijnt **You Died** met Respawn en opslaan/hoofdmenu. Een bed stelt het spawnpoint in en slaat 's nachts de nacht over. Zonder keepInventory vallen items op de sterfplek en verdwijnen ze na vijf minuten. Creative blijft vrij van health/hunger en heeft onbeperkte resources.

## Crafting, tools en interacties

E opent 2×2 crafting; rechtsklik op een werkbank opent 3×3. Selecteer een ingrediënt en klik een gridvak; rechtsklik leegt het vak. Het receptenboek vult een patroon in. Klik op de output om te craften; Shift-klik herhaalt zolang resources en capaciteit het toelaten. Verbruik en output zijn één gecontroleerde transactie.

De registry ondersteunt shaped, gespiegeld/verschoven shaped en shapeless recipes. Er zijn planken, stokken, werkbank, oven, kist, fakkels, vijf tooltiers (wood/stone/iron/gold/diamond), pikhouweel/bijl/schep/schoffel/zwaard, deur, ladder, bed, brood, boog, pijlen, borstplaat, hek/poort, trappen/platen en boekenkast.

Tools hebben passende mining speed, durability, tier, damage en cooldown. Ores vereisen passende tiers voor drops; obsidiaan vereist diamond en bedrock is in Survival onbreekbaar. Mining toont een crack-overlay. De hotbar toont toolslijtage.

De inventory heeft **27 rugzakvakken en 9 echte hotbarvakken**. Een item staat in één concreet vak; de hotbar verwijst niet meer naar een gezamenlijke voorraad. Slijtage en enchantments blijven bij de afzonderlijke gereedschapsstack, ook als twee exemplaren van hetzelfde gereedschap verschillende eigenschappen hebben. Lege hotbarvakken zijn echt leeg.

| Handeling | Resultaat |
|---|---|
| Linksklik op een gevuld vak | Stack oppakken aan de cursor |
| Linksklik op een bestemming | Neerleggen, samenvoegen of wisselen |
| Rechtsklik op een stack | De helft oppakken, naar boven afgerond |
| Rechtsklik met een cursorstack | Eén item neerleggen |
| Shift-klik | Snel verplaatsen tussen rugzak/hotbar of geopende kist/oven |
| Een item slepen naar een vak | De stack naar die concrete bestemming verplaatsen |
| Met een stack aan de cursor links slepen over vakken | Gelijk verdelen; de rest blijft aan de cursor |
| Met een stack aan de cursor rechts slepen over vakken | Eén item per vak plaatsen |
| 1–9 terwijl je boven een vak zweeft | Wisselen met het betreffende hotbarvak |
| Creative item kiezen | Item aan de cursor; klik daarna zelf op een bestemming |

Een Creative item kiezen verandert dus **niet** het laatst geselecteerde hotbarslot. Pickups en `/give` vullen passende bestaande stacks en vrije vakken. Crafting gebruikt echte items in het 2×2- of 3×3-grid; het resultaat komt aan je cursor zodat je zelf kiest waar het heen gaat. Shift-klik op het resultaat craft herhaaldelijk naar vrije voorraadplekken. Het receptenboek vult het grid met werkelijke ingrediënten uit je inventory en weigert tekorten zonder items te veranderen. Bij sluiten worden cursor/crafting-items teruggelegd; eventuele overloop verschijnt als echte drops. Een save of reconnect midden in een cursoractie behoudt die items en hun metadata.

Kisten en ovens gebruiken dezelfde slotbediening. De oven weigert items in het outputvak en verwerkt output-XP maar eenmaal. In multiplayer verwerkt de server slotacties en transactie-IDs; clients kunnen geen eigen stacks, aantallen, metadata of inventorydata opleggen. Oude saves met aantallen per itemtype worden gemigreerd naar vaste slots, waarbij de oude hotbarvoorkeuren zoveel mogelijk behouden blijven.

- **Kist:** 27 slots. Selecteer een item; klik leeg voor één item, rechtsklik voor een stack, klik gevuld om op te pakken. Inhoud en blokwijzigingen worden bewaard.
- **Oven:** input, brandstof, output en 8 seconden smelttijd per item. Coal en hout zijn brandstoffen. Recepten: iron/gold ingots, glas, steen, baksteen en gekookt vlees. Output levert XP. Voortgang blijft bewaard.
- **Deur/poort:** rechtsklik om te wisselen; deuren gebruiken twee blokken en botsingen volgen de vorm.
- **Ladder:** bewegen tegen de ladder/spatie klimt; Shift daalt.
- **Bed:** rechtsklik stelt respawn in; 's nachts slapen.
- **Fakkel:** vloer-/wandplaatsing en lokaal bloklicht.
- **Farming:** schoffel op gras/aarde, zaden op farmland, groei in drie stadia. Nabij water groeit het sneller. Rijpe tarwe oogsten geeft tarwe, zaden en XP.
- **Voedsel:** bessen, appel, brood, rauw/gebakken rund, varken en kip. Eten heeft een korte duur en animatie. Gebakken voedsel geeft meer hunger/saturation.

XP komt van mobs, bepaalde ores, gewassen en smelten. Met een tool of borstplaat geselecteerd zijn upgrades in de inventory beschikbaar. Efficiency versnelt mining, Sharpness verhoogt schade, Unbreaking spaart durability en Protection vermindert schade. Upgrades kosten levels en zijn data-driven.

## Mobs en combat

Originele blokmodellen voor koe, varken, schaap en kip; vijanden Hollow (melee), Bonewalker (pijlen), Burster (explosie) en Crawler. Mobs bewegen, reageren op schade, hebben health/loot/XP en een death animation. Hostiles gebruiken detectie en zichtlijnen; melee en projectielen kunnen niet door solide muren heen raken.

AI gebruikt Idle, Wander, Investigate, Chase, Attack, Flee en Dead met begrensde A* (96 bezoeken), één-blok-stappen, spawnlimieten, simulatieafstand en afstandsdespawning. Het is eenvoudige singleplayer-AI, geen volledige Minecraft-AI. Mobstates/IDs worden opgeslagen. Itemdrops en XP gebruiken gedeelde, gebatchte rendering; pijlen hebben substeps tegen tunneling.

## Wereld en omgeving

Nieuwe werelden gebruiken generator **v3**. Bestaande v1/v2-werelden blijven hun oorspronkelijke generator gebruiken: er wordt geen bestaand terrein herschreven. Dezelfde seed, hoogte en generatorversie blijven reproduceerbaar.

V3 voegt berkenbos, donker bos, taiga, moeras, jungle, savanna, badlands, bevroren oceaan en strand toe, met eigen materialen/vegetatie. Ondergronds zijn extra caves, ore veins, diepsteen, lava en water. Seed-structuren omvatten hutten, ruïnes, lootdungeons, mijntunnels en eenvoudige dorpen; iedere chunk evalueert dezelfde ankers zodat structuren grenzen kunnen oversteken.

Nieuwe blokken omvatten wood/leaf-varianten, wolkleuren, lava/obsidiaan, klei/mos, steenbaksteen, gladde steen, boekenkast, hek/poort, trappen/platen, farmland/crops, paddenstoelen, gloedsteen, ijs/pakijs en sneeuwlagen. Water en lava zijn statische voxels, zonder vloeistofsimulatie.

Chunklicht combineert dak-/zonocclusie en flood-fill van emissive blokken, met cache-invalidatie bij edits. Een begrensd aantal nabije point lights belicht entities. Dag/nacht, maanlicht, regen, onweer/flitsen en sneeuw in koude biomes zijn aanwezig. Settings bevat render- en simulatieafstand, max mobs, particles, kwaliteit, dagduur en weer.

Alle textures, blokmodellen, geluiden en muziek zijn origineel/procedureel. Master-, effects- en musicvolume zijn apart instelbaar. Er worden geen officiële gameassets gebruikt.

## Skins blijven behouden

Character → Skins ondersteunt 64×64 Classic/Slim, 64×32 legacy, transparante tweede lagen, preview, upload en publieke username-lookup zonder Microsoft-login. De lokale proxy haalt UUID/profiel/PNG bij publieke Mojang-servers op, met validatie, cache, rate limiting en time-outs. De skin wordt lokaal bewaard en gebruikt in first/third person. Upload blijft beschikbaar bij API-storingen.

## Saves en architectuur

Saveschema 5 bewaart de fysieke inventoryslots, cursorstack en crafting-items, naast alle gamerules, Adventure/Spectator, de lokale spelersnaam en vuurleeftijden. Migratie laat bestaande edits, seed, inventory en generatorversie intact. Voordat een oudere save wordt overschreven, wordt in dezelfde IndexedDB-transactie een oorspronkelijke back-up bewaard. **Mijn werelden → Exporteer / Back-up** downloadt de huidige save of oorspronkelijke migratieback-up als JSON. Een wereld verwijderen verwijdert ook die back-up. De database blijft dezelfde database op versie 1; er wordt geen andere opslag gestart. Autosave loopt iedere tien seconden tijdens spelen; succesvolle wijzigende commands slaan direct op. **Opslaan & hoofdmenu** wacht op de transactie. Een abrupte browserstop kan de laatste seconden verliezen.

World/data, generatie, lighting, items/recipes, survival, mobs, projectielen, drops, rendering en input staan in afzonderlijke modules. Entity IDs, serialiseerbare snapshots en world/inventory/combat-events bereiden latere synchronisatie voor. Multiplayer is niet geïmplementeerd.

## Controle

```sh
npm run typecheck
npm run test
npm run build
```

Start een dev-/productieserver en voer browserchecks in een tweede terminal uit:

```sh
npm run test:browser
npm run test:survival
npm run test:expansion
npm run test:skins
npm run test:settings
npm run test:commands
```

De tests gebruiken Playwright Core met geïnstalleerde Edge. TEST_URL kiest de origin; BROWSER_PATH kan naar Chrome/Chromium wijzen. De skintest heeft internet nodig voor een echte publieke lookup. Geïsoleerde savefixtures wijzigen geen eigen werelden. Screenshots staan in test-results/. Tests wachten op gameplaytoestanden in plaats van alleen vaste wachttijden.

Doelplatform: recente desktop Chrome/Edge/Firefox met WebGL2. De uitgevoerde browser-QA gebruikt headless Edge. Afzonderlijke Chrome/Firefox-tests en langdurige prestatiemetingen op fysieke hardware zijn niet uitgevoerd; er is geen algemene 60-FPS-garantie.

## Expansion 3.0 — Fase 1

De lokale chat staat linksonder, vervaagt na twaalf seconden en toont maximaal 200 berichten. Openen geeft de muis vrij en wist ingedrukte bewegingstoetsen. Tekst wordt veilig als tekst weergegeven. Commandgeschiedenis blijft lokaal bewaard (maximaal 100 regels). Chromium begrenst zeer snel herhaalde pointer-lockverzoeken; als de browser vergrendeling weigert, verschijnt het pauzemenu met een melding en kun je op Verder spelen klikken.

```text
/help
/gamemode survival|creative|adventure|spectator
/gamemode 0|1|2|3
/give diamond 64
/give minecraft:diamond 64
/give @s stone 32
/give Player iron_ingot 32
/give diamond_pickaxe 1
/summon cow
/summon minecraft:zombie
/summon skeleton ~ ~1 ~
/gamerule
/gamerule keepInventory true
/gamerule doDaylightCycle false
/gamerule randomTickSpeed 10
```

De lokale naam is standaard **Player**. Autocomplete volgt de echte item- en entityregistries. Zombie/Skeleton/Creeper/Spider zijn compatibiliteitsnamen voor de originele Hollow/Bonewalker/Burster/Crawler. Summon gebruikt hun bestaande modellen en AI, controleert hoogte en vrije ruimte en respecteert de moblimiet. Relatieve coördinaten gebruiken `~`. Peaceful blijft vijandige mobs verwijderen. Give vult maximaal 36 stacks; bij gedeeltelijke ruimte meldt het exact hoeveel is ontvangen en hoeveel niet is toegevoegd. Onbekende namen en ongeldige aantallen veranderen de inventory niet.

Adventure behoudt health, hunger, combat, crafting en toegestane blokinteracties, maar verbiedt gewoon minen, plaatsen, ploegen en planten. Spectator vliegt zonder collision, schade, combat, pickups of blokinteractie. Wisselen gebeurt direct en wordt opgeslagen. Skins, cameramodi en bestaande Creative/Survival blijven beschikbaar.

| Gamerule | Daadwerkelijk effect |
|---|---|
| keepInventory | Inventory, tooldata en XP behouden bij overlijden |
| doDaylightCycle | Automatische wereldtijd pauzeren/hervatten |
| doWeatherCycle | Automatische weerwissels pauzeren/hervatten; huidig weer blijft zichtbaar |
| doMobSpawning | Natuurlijke spawns; `/summon` blijft werken |
| doMobLoot | Mobitems en XP aan/uit |
| doTileDrops | Blokdrops, containerinhoud en mining-XP aan/uit |
| doFireTick | Vuur veroudert, verspreidt naar brandbaar hout/bladeren/wol en dooft; maximaal 64 vuurcellen en 16 edits per seconde binnen simulatieafstand |
| mobGriefing | Terreinvernietiging door Burster-explosies; explosieschade blijft actief |
| randomTickSpeed | Gewasgroei schaalt met waarde / 3; 0 stopt groei, ovens blijven werken; bereik 0–4096 |
| naturalRegeneration | Automatische regeneratie bij voldoende hunger |

Booleanregels accepteren uitsluitend `true`/`false`. Alle regels gelden per wereld. De parser en registry bieden argumentvalidatie, aliases, help, autocomplete, foutafhandeling en een permission-hook; singleplayer heeft lokaal toestemming. Er is geen netwerklaag toegevoegd.

**Nog niet geïmplementeerd uit Expansion 3.0:** het uitgebreide equipment-/potion-/enchantingsysteem, redstone, trading, rails/minecarts, Nether/End-dimensies en bossfight. Bestaande eenvoudige equipment/enchantments uit 0.3 blijven intact. Deze versie voltooit uitsluitend Fase 1.

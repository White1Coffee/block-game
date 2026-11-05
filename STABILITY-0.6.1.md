# WhiteBrick 0.6.1 — stabiliteitsonderzoek

Geen nieuwe gameplayfeatures of save-schemawijzigingen. De lokale codebase is de basis voor deze update.

| Ernst | Bevestigd probleem | Bestanden |
| --- | --- | --- |
| Hoog | Asynchrone login en skinupdates kunnen na disconnect of naast volgende berichten doorlopen; mislukte login-save laat een actieve speler achter | `server/GameServer.ts` |
| Hoog | Wereld wordt ingelezen vóór de exclusieve serverlock | `server/GameServer.ts`, `server/ServerWorld.ts` |
| Hoog | Herhaalde transactie wordt genegeerd zonder het oorspronkelijke acknowledgement terug te sturen | `server/ServerWorld.ts` |
| Hoog | Annuleren tijdens status-fetch kan alsnog verbinden; serverberichten worden alleen met een TypeScript-cast vertrouwd | `src/networking/NetworkClient.ts`, `NetworkProtocol.ts` |
| Middel | Prediction bewaart ook niet-verzonden inputs; server kan oudere inputsequence na een nieuwere verwerken | `MultiplayerSession.ts`, `server/ServerWorld.ts` |
| Middel | Elke chunk genereert/streamt na een scan van alle block changes; snapshotvervanging verwijdert changes met dezelfde globale scan | `src/world/World.ts`, `server/ServerWorld.ts`, `src/core/Game.ts` |
| Middel | Chunkmesh-cleanup wordt overgeslagen zolang workerresultaten ontbreken; dirty entries buiten geladen chunks blijven staan | `src/core/Game.ts`, `server/ServerWorld.ts` |
| Middel | Oudere chunksnapshot kan nieuwere revisie overschrijven | `src/core/Game.ts` |
| Middel | NaN/infinite wereldcoördinaten kunnen ongeldige chunks genereren; restore past reeds geladen chunks niet aan | `src/world/World.ts` |
| Middel | Legacy chesttransfers controleren alleen item-ID en kunnen verschillende metadata samenvoegen | `src/world/BlockEntities.ts` |
| Middel | Oven accepteert onbruikbare items in brandstofslot | `InventoryContext.ts`, `server/ServerWorld.ts` |
| Middel | Een late fout van een geannuleerde verbinding kan het huidige menu vervangen | `src/core/Game.ts` |
| Middel | Browseropslag houdt het aangeleverde saveobject vast tot IndexedDB opent; delete-promise mist expliciete abortafhandeling | `src/storage/WorldStorage.ts` |
| Middel | Gebroken blokken kunnen achtergebleven block states in singleplayersaves bewaren | `src/world/World.ts` |
| Middel | Verlaten van de pagina sluit de LAN-sessie niet expliciet af; terugkeren vanuit browsercache hervat een gesloten sessie | `src/core/Game.ts` |
| Laag | Publieke skinservice toont bij netwerkfouten de technische tekst `fetch failed` | `server/skin-service.mjs` |

Alle bovenstaande punten zijn gerepareerd. De schema's blijven singleplayer v5 en LAN v2; generatorversies en bestaande wereld-ID's veranderen niet.

Reparaties:

- Begrensde FIFO voor netwerkhandlers, rate limiting bij ontvangst, sessiecontrole na async werk, login rollback en wachten op handlers bij shutdown.
- Serverlock vóór het laden; permanente `world.before-lan-v1.json` / `world.before-world-vN.json` vóór bestaande migraties. Structureel onleesbare hoofdsaves vallen terug op een geldige back-up. Tijdelijke onafgemaakte writes worden niet als wereld geladen.
- Herhaalde transaction-ID's krijgen exact hetzelfde positieve of negatieve acknowledgement. De client probeert ontbrekende acknowledgements beperkt opnieuw met dezelfde ID. Na reconnect worden onzekere acties **niet** opnieuw uitgevoerd; de serverstate is leidend.
- Movement sequence gaat niet terug; niet-verzonden inputs worden niet voorspeld of opnieuw afgespeeld. Pending inputs, transacties en handlerqueues zijn begrensd.
- Index voor gewijzigde blokken per chunk bij laden, genereren, streaming en snapshotvervanging. Geen globale block-change-scan per chunk meer. Cleanup draait ook tijdens wachten op workers.
- Runtimecontroles voor serverstatus, login, players, inventories, chunks, entities, containers, acknowledgements en gamerules; ongeldige transaction-ID's worden geweigerd.
- Bescherming tegen late callbacks bij annuleren, disconnect en skincachevervanging; saveobject wordt vóór asynchroon openen van IndexedDB gekopieerd.
- Bestaande inventorytransacties behouden metadata en accepteren alleen bruikbare ovenbrandstof.
- Air block changes ruimen block states vóór notificaties op; chunks met een onjuiste wereldhoogte worden geweigerd. Pagehide sluit de sessie expliciet; browsercacheherstel toont de weg terug naar het menu.

Gerichte regressietests staan in `tests/network-client.test.ts`, `tests/persistence-stability.test.ts` en de uitgebreide multiplayer-, world-, slot-inventory- en progressiontests.

Uitgevoerde controles tijdens deze update. De laatste volledige unitreeks, productiebuild en LAN-, inventory- en skintests draaien op de definitieve code; de overige browsersuites zijn eerder in deze update uitgevoerd:

| Controle | Resultaat |
| --- | --- |
| `npm run typecheck` | Geslaagd |
| `npm run test` vóór build | 224 tests / 19 bestanden geslaagd |
| `npm run build` | Geslaagd |
| `npm run test` na build, twee keer | Beide keren 224 tests geslaagd |
| `npm run test:lan` | Definitieve productiebuild geslaagd: twee browsers, skins, beweging, bouwen/mining, chat/permissions, mobs, rules, reconnect, browseronafhankelijkheid en opgeslagen serverherstart |
| `npm run test:inventory` | Singleplayer én twee multiplayerbrowsers geslaagd, inclusief gedeelde kist, transaction replay, slepen en persistence |
| `npm run test:browser` | Beweging, vliegen, mining, plaatsing, IndexedDB, reload en opslagfouten geslaagd |
| `npm run test:survival` | Timed mining, finite inventory, pickups, eten en crafting geslaagd |
| `npm run test:expansion` | Crafting, ovenbrandstof, farming, combat, XP, weather en respawn geslaagd |
| `npm run test:commands` | Gamemodes, give/summon/gamerule, errors, history/autocomplete, overflow, reload en migratieback-up geslaagd |
| `npm run test:settings` | Controls, graphics, streaming/unloading, wereldhoogte 128 en reload geslaagd |
| `npm run test:skins` | PNG/legacy/Classic/Slim/layers, echte publieke Notch-lookup, API-foutfallback, persistence en F5 geslaagd |

De eerste LAN-runs faalden bij de disconnectcontrole. De definitieve run slaagt na expliciete pagehide-opruiming en het laten wachten van de test op actuele serverstatus. De eerste live skintest werd door de netwerksandbox geblokkeerd (`EACCES`); dezelfde test slaagde via een tijdelijke lokale preview met toegestane uitgaande HTTPS. Alle tijdelijke LAN-werelden gebruiken afzonderlijke mappen onder `.lan-test`; bestaande `server/data`-werelden zijn niet als testfixture gebruikt.

Beperkingen: geen fysieke test met twee computers, geen langdurige soaktest met acht spelers en geen gemeten FPS-garantie. De browserintegratietests gebruiken Edge/Chromium op deze computer. Het onderzoek levert geen bewijs dat de volledige game bugvrij is.

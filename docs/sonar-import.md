# Ekolodsimport och egna djupkartor

## Arkitektur

Importen är uppdelad i fyra lager:

1. Webbläsaren läser filer, mappar eller ZIP, filtrerar relevanta format,
   beräknar SHA-256 strömmande och laddar upp med återupptagbar TUS till den
   privata Supabase-bucketen `sonar-imports`.
2. API-routes autentiserar användaren, skapar ett idempotent filmanifest och
   startar ett beständigt Vercel Workflow.
3. Workflowet väljer parserplugin, läser filen med byte ranges i block om 5 000
   poster och skriver punkter via transaktionella Postgres-funktioner.
4. PostGIS skapar rörelsedata, rutnät i 10/25/50/100 meter, terrängvärden,
   spår, konturer, fångstmatchningar och Mapbox Vector Tiles.

Workflowsteg kan spelas om utan dubbla punkter eller dubbla felräknare.
Uppladdningar kan återupptas efter nätavbrott när användaren väljer samma
underlag igen. Varje användares råfiler, mätningar och tiles är privata.

## Parserplugins

`SonarImporterPlugin` är kontraktet för identifiering, headerläsning och
blockvis punktparsing. Aktiva plugins:

- `humminbird-autochart-live-acu`
- `humminbird-autochart-index-aic` (metadata)

Registerposter finns för Humminbird ACD/HT/SON/DAT/ADM, Garmin FIT, Lowrance
SL2/SL3/USR, Raymarine SDF, GPX, BIN och LOG. Ett nytt format aktiveras genom
att implementera kontraktet och registrera pluginet; pipeline, lagring och GIS
behöver inte ändras.

Den verifierade ACU v11-layouten är:

- 64 byte header
- 32 byte per mätpost
- latitud/longitud som little-endian Float64
- djup som little-endian Float32 i meter
- enhetslokal starttid plus löptid i millisekunder
- två leverantörskanaler som sparas råa

Humminbirds två råkanaler benämns inte bottenhårdhet eller vegetation förrän
deras skala har verifierats mot tillverkardokumentation eller kalibreringsdata.

## Databas och GIS

Huvudobjekten är `sonar_import_jobs`, `sonar_import_files`, `sonar_surveys`,
`sonar_survey_points`, `sonar_tracks`, `sonar_waypoints`,
`sonar_depth_cells`, `sonar_depth_contours`,
`sonar_bottom_classifications`, `catch_sonar_enrichments` och
`sonar_environment_context`.

Mätpunkter är hashpartitionerade i 16 partitioner på `user_id`. Positioner
lagras i SRID 4326 och indexeras med GiST; tid indexeras med B-tree/BRIN.
Rutnäten används som ett PostGIS-baserat raster/TIN-surrogat för snabb
interaktiv rendering. Vector tiles väljer upplösning efter zoomnivå.

Fångster matchas högst 20 meter från en punkt och inom ±30 minuter.
Resultatet lagras separat i `catch_sonar_enrichments`; befintliga fångstfält
ändras aldrig. Fiskepin-krypterade positioner kan inte servermatchas och
utelämnas.

`sonar_environment_context` är en gles framtida koppling för väder, vind,
lufttryck, vattenstånd, vattentemperatur, månfas, soluppgång och solnedgång.

## Skalning och felhantering

- Filer läses med byte ranges; en serverfunktion behöver inte hålla hela
  sonarloggen i minnet.
- 5 000 poster per beständigt steg begränsar minne och transaktionslängd.
- Unika nycklar på filhash och postindex förhindrar dubbletter.
- Advisory locks serialiserar härledningar per jobb utan tabellås.
- Korrupta filer isoleras till sin filrad; övriga filer fortsätter.
- Framsteg och fel ligger i databasen och överlever sidbyte eller deploy.
- ZIP i webbläsaren har separata gränser för komprimerad och expanderad data;
  stora SD-kort ska väljas som mapp.

För betydligt större konturprodukter eller exportbara raster kan pipeline-
kontraktet senare kompletteras med ett separat GDAL-jobb. Den interaktiva
Mapbox-vyn behöver inte ändras eftersom den redan konsumerar MVT.

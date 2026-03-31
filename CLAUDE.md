# FiskeLogg - Projektregler

## Språk
- Appen är helt på **svenska**. Alla UI-strängar MÅSTE använda korrekta svenska tecken: **Å, Ä, Ö** (och å, ä, ö).
- Skriv ALDRIG "angst" istället för "ångst", "ar" istället för "år", "Vader" istället för "Väder", etc.
- Dubbelkolla alltid att Å, Ä, Ö används korrekt i all text som visas för användaren.

## Design
- Svart/vitt tema (primary = zinc-skala, primary-700 = #27272a)
- Inga emojis — använd SVG-ikoner (Heroicons-stil)
- Mobile-first PWA

## Tech Stack
- Next.js 14 App Router + TypeScript
- Supabase (PostgreSQL + Storage + Auth)
- Tailwind CSS
- Mapbox GL JS (karta)
- OpenStreetMap Overpass API (vattendetektering)
- Vercel (deploy med `npx vercel --prod --yes`)

## Viktiga regler
- `catcher_name` (fångstperson) är **obligatorisk** vid ny fångst
- Topplista och jämförelse baseras på `catcher_name`, inte på user_id/profiler
- Filtrera alltid bort tomma strängar från catcher_name-listor

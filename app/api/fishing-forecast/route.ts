import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'

export const maxDuration = 30

function pressureBand(p: number | null): string {
  if (p == null) return 'okänt'
  if (p < 1005) return 'lågt'
  if (p < 1020) return 'normalt'
  return 'högt'
}

interface WeatherInput {
  pressure_hpa: number | null
  pressure_trend: 'stigande' | 'fallande' | 'stabilt'
  condition: string
  moon_phase: string | null
  wind_speed_ms: number | null
  temp_c: number | null
  cloud_cover_pct: number | null
  hour: number
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })

    const weather: WeatherInput = await req.json()
    const admin = createAdminClient()

    // Fetch user catches that have weather data
    const { data: catches } = await admin
      .from('catches')
      .select('species, weight_kg, pressure_hpa, weather_condition, moon_phase, wind_speed_ms, weather_temp_c, cloud_cover_pct, caught_at')
      .eq('user_id', user.id)
      .not('pressure_hpa', 'is', null)
      .order('caught_at', { ascending: false })
      .limit(500)

    const total = catches?.length ?? 0

    if (total < 3) {
      return NextResponse.json({
        rating: 'okänt',
        insight: 'Du behöver logga fler fångster med väderdata för att få en personlig fiskeprognos. Fortsätt logga dina fångster — ju fler du loggar, desto bättre blir analysen!',
        stats: [],
        total,
      })
    }

    // --- Trycktrendanalys ---
    const currentBand = pressureBand(weather.pressure_hpa)
    const catchesInSamePressureBand = catches?.filter(c => pressureBand(c.pressure_hpa) === currentBand) ?? []
    const pressureBandPct = Math.round((catchesInSamePressureBand.length / total) * 100)

    // --- Månfasanalys ---
    const moonMatches = catches?.filter(c =>
      weather.moon_phase && c.moon_phase === weather.moon_phase
    ) ?? []
    const moonPct = weather.moon_phase ? Math.round((moonMatches.length / total) * 100) : null

    // --- Väderförhållandeanalys ---
    const conditionMatches = catches?.filter(c => c.weather_condition === weather.condition) ?? []
    const conditionPct = Math.round((conditionMatches.length / total) * 100)

    // --- Bästa väderförhållande ---
    const conditionCounts: Record<string, number> = {}
    catches?.forEach(c => {
      if (c.weather_condition) {
        conditionCounts[c.weather_condition] = (conditionCounts[c.weather_condition] || 0) + 1
      }
    })
    const bestCondition = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0]

    // --- Tid på dygnet ---
    const morningCatches = catches?.filter(c => {
      const h = new Date(c.caught_at).getHours()
      return h >= 5 && h < 10
    }).length ?? 0
    const eveningCatches = catches?.filter(c => {
      const h = new Date(c.caught_at).getHours()
      return h >= 17 && h < 22
    }).length ?? 0
    const bestTimeLabel = morningCatches > eveningCatches
      ? `morgon (${morningCatches} fångster)`
      : `kväll (${eveningCatches} fångster)`

    // --- Beräkna övergripande betyg ---
    let score = 0
    if (weather.pressure_trend === 'stigande') score += 2
    else if (weather.pressure_trend === 'stabilt') score += 1
    else score -= 1

    if (conditionPct > 20) score += 2
    else if (conditionPct > 10) score += 1

    if (moonPct !== null && moonPct > 15) score += 1

    const rating = score >= 4 ? 'bra' : score >= 2 ? 'medelbra' : 'dåligt'

    // --- Statistik-pills ---
    const stats: { label: string; value: string }[] = []

    stats.push({
      label: `${pressureBandPct}% av dina fångster`,
      value: `vid ${currentBand} lufttryck`,
    })

    if (conditionPct > 0) {
      stats.push({
        label: `${conditionPct}% av dina fångster`,
        value: `vid ${weather.condition.toLowerCase()}`,
      })
    }

    if (moonPct !== null && weather.moon_phase) {
      stats.push({
        label: `${moonPct}% av dina fångster`,
        value: `vid ${weather.moon_phase.toLowerCase()}`,
      })
    }

    if (bestCondition) {
      stats.push({
        label: `Bästa väder i din logg`,
        value: `${bestCondition[0]} (${bestCondition[1]} fångster)`,
      })
    }

    stats.push({
      label: 'Din bästa tid på dygnet',
      value: bestTimeLabel,
    })

    // --- AI-genererad text ---
    const prompt = `Du är en expert på fiskebeteende och väderanalys. Analysera om det är en bra dag att fiska baserat på följande data:

DAGENS VÄDER:
- Lufttryck: ${weather.pressure_hpa ?? 'okänt'} hPa (${weather.pressure_trend})
- Väder: ${weather.condition}
- Månfas: ${weather.moon_phase ?? 'okänt'}
- Vind: ${weather.wind_speed_ms ?? 'okänt'} m/s
- Temperatur: ${weather.temp_c ?? 'okänt'}°C
- Molnighet: ${weather.cloud_cover_pct ?? 'okänt'}%

ANVÄNDARENS FÅNGSTHISTORIK (${total} fångster med väderdata):
- ${pressureBandPct}% av fångster tagna vid ${currentBand} lufttryck
- ${conditionPct}% av fångster tagna vid "${weather.condition}"
${moonPct !== null ? `- ${moonPct}% av fångster tagna vid "${weather.moon_phase}"` : ''}
- Bästa registrerade väder: ${bestCondition?.[0] ?? 'okänt'} (${bestCondition?.[1] ?? 0} fångster)
- Trycktrendbedömning: ${weather.pressure_trend} tryck = ${weather.pressure_trend === 'stigande' ? 'generellt bra för fiske' : weather.pressure_trend === 'stabilt' ? 'okej för fiske' : 'ofta sämre för fiske'}
- Övergripande betyg: ${rating}

Skriv 2–3 meningar på svenska som:
1. Bedömer om det är en bra, medelbra eller dålig dag för fiske (direkt och tydligt)
2. Hänvisar till den personliga statistiken på ett naturligt sätt
3. Ev. ger ett konkret tips baserat på vädret

Håll det kort, engagerat och personligt. Inga emojis. Inga rubriker. Bara löpande text.`

    const anthropic = createAnthropicClient()
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })

    const insight = (response.content[0] as { type: string; text: string }).text.trim()

    return NextResponse.json({ rating, insight, stats, total })
  } catch (err) {
    console.error('Fishing forecast error:', err)
    return NextResponse.json({ error: 'Kunde inte generera fiskeprognos' }, { status: 500 })
  }
}

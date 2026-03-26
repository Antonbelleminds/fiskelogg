interface MoonData {
  moon_phase: string
  moon_illumination_pct: number
}

function phaseToSwedish(phase: number): string {
  if (phase === 0 || phase === 1) return 'Nymåne'
  if (phase < 0.25) return 'Tillväxande skära'
  if (phase === 0.25) return 'Tillväxande halvmåne'
  if (phase < 0.5) return 'Tillväxande halvmåne'
  if (phase === 0.5) return 'Fullmåne'
  if (phase < 0.75) return 'Avtagande halvmåne'
  if (phase === 0.75) return 'Avtagande halvmåne'
  return 'Avtagande skära'
}

export async function fetchMoonData(date: Date): Promise<MoonData> {
  const unixTimestamp = Math.floor(date.getTime() / 1000)

  try {
    const res = await fetch(`https://api.farmsense.net/v1/moonphases/?d=${unixTimestamp}`)
    if (!res.ok) throw new Error('Moon API failed')

    const data = await res.json()
    if (!data || !data[0]) throw new Error('No moon data')

    const moon = data[0]
    const illumination = parseInt(moon.Illumination) || 0
    const phase = parseFloat(moon.Phase) || 0

    return {
      moon_phase: phaseToSwedish(phase),
      moon_illumination_pct: illumination,
    }
  } catch {
    // Fallback: calculate moon phase approximately
    const synodicMonth = 29.53058867
    const knownNewMoon = new Date('2024-01-11T11:57:00Z').getTime()
    const daysSinceNew = (date.getTime() - knownNewMoon) / (1000 * 60 * 60 * 24)
    const phase = ((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth / synodicMonth

    return {
      moon_phase: phaseToSwedish(phase),
      moon_illumination_pct: Math.round(50 - 50 * Math.cos(2 * Math.PI * phase)),
    }
  }
}

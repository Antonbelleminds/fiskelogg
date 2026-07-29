import { z } from 'zod'

export interface CatchForAnalysis {
  species: string | null
  weight_kg: number | null
  length_cm: number | null
  caught_at: string
  water_body: string | null
  fishing_method: string | null
  lure_type: string | null
  lure_color: string | null
  weather_condition: string | null
  pressure_hpa: number | null
  moon_phase: string | null
  depth_m: number | null
  water_temp_c: number | null
}

export interface DistributionItem {
  label: string
  count: number
  sharePct: number
}

export interface SonarBand {
  label: string
  samples: number
  sharePct: number
}

export interface SonarAnalysisContext {
  surveyCount: number
  pointCount: number
  firstSurveyAt: string | null
  lastSurveyAt: string | null
  minDepthM: number | null
  maxDepthM: number | null
  cellCount: number
  sampleCount: number
  avgDepthM: number | null
  depthBands: SonarBand[]
  slopeBands: SonarBand[]
  hardnessBands: SonarBand[]
  hardnessSamples: number
  vegetationBands: SonarBand[]
  vegetationSamples: number
  matchedCatches: number
  matchedCatchDepth: {
    averageM: number | null
    minM: number | null
    maxM: number | null
  }
  avgCatchSlopeDeg: number | null
  avgCatchBottomHardness: number | null
  avgCatchWaterTempC: number | null
  avgMatchDistanceM: number | null
}

export interface FishingAnalysisInput {
  catches: {
    total: number
    measuredWeights: number
    averageWeightKg: number | null
    maxWeightKg: number | null
    measuredLengths: number
    averageLengthCm: number | null
    maxLengthCm: number | null
    species: DistributionItem[]
    timeOfDay: DistributionItem[]
    months: DistributionItem[]
    methods: DistributionItem[]
    lures: DistributionItem[]
    waters: DistributionItem[]
    weather: DistributionItem[]
    moonPhases: DistributionItem[]
    pressure: DistributionItem[]
    manualDepth: {
      count: number
      averageM: number | null
      minM: number | null
      maxM: number | null
    }
  }
  sonar: SonarAnalysisContext
  dataQuality: {
    catchesAnalyzed: number
    sonarPoints: number
    matchedCatches: number
    canCompareCatchLocationsToSonar: boolean
    bottomSignalIsBeta: boolean
    vegetationSignalIsBeta: boolean
  }
}

const InsightSchema = z.object({
  title: z.string().min(1).max(80),
  insight: z.string().min(1).max(420),
  evidence: z.string().min(1).max(240),
  confidence: z.enum(['high', 'medium', 'low']),
})

const ActionSchema = z.object({
  title: z.string().min(1).max(80),
  action: z.string().min(1).max(300),
  why: z.string().min(1).max(240),
})

export const FishingAiResultSchema = z.object({
  headline: z.string().min(1).max(120),
  summary: z.string().min(1).max(700),
  findings: z.array(InsightSchema).min(1).max(4),
  nextActions: z.array(ActionSchema).min(1).max(3),
  limitations: z.array(z.string().min(1).max(260)).max(4),
})

export type FishingAiResult = z.infer<typeof FishingAiResultSchema>

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function safeCount(value: unknown): number {
  return Math.max(0, Math.round(finiteNumber(value) ?? 0))
}

function cleanLabel(value: string | null | undefined): string | null {
  const label = value?.trim().replace(/\s+/g, ' ')
  if (!label) return null
  return label.slice(0, 80)
}

function distribution(
  values: Array<string | null | undefined>,
  total: number,
  limit = 6
): DistributionItem[] {
  const counts = new Map<string, number>()
  values.forEach((value) => {
    const label = cleanLabel(value)
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  })

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sv'))
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      sharePct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number | null, decimals = 1): number | null {
  if (value === null) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function plausibleDepth(value: unknown): number | null {
  const depth = finiteNumber(value)
  return depth !== null && depth >= 0.2 && depth <= 200 ? depth : null
}

function timeBucket(date: string): string | null {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  const hourPart = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(parsed).find((part) => part.type === 'hour')
  const hour = Number(hourPart?.value)
  if (!Number.isFinite(hour)) return null
  if (hour < 6) return 'Natt 00–06'
  if (hour < 10) return 'Morgon 06–10'
  if (hour < 16) return 'Dag 10–16'
  if (hour < 21) return 'Kväll 16–21'
  return 'Sen kväll 21–24'
}

const MONTHS = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
]

function monthLabel(date: string): string | null {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  const monthPart = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    month: 'numeric',
  }).formatToParts(parsed).find((part) => part.type === 'month')
  const month = Number(monthPart?.value)
  return Number.isInteger(month) && month >= 1 && month <= 12
    ? MONTHS[month - 1]
    : null
}

function pressureLabel(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  if (value < 990) return 'Lågt (<990 hPa)'
  if (value <= 1015) return 'Normalt (990–1015 hPa)'
  return 'Högt (>1015 hPa)'
}

function normalizeBands(value: unknown, total: number): SonarBand[] {
  if (!Array.isArray(value)) return []
  return value
    .map<SonarBand | null>((item) => {
      const record = item as Record<string, unknown>
      const label = cleanLabel(typeof record.label === 'string' ? record.label : null)
      if (!label) return null
      const samples = safeCount(record.samples)
      return {
        label,
        samples,
        sharePct: total > 0 ? Math.round((samples / total) * 100) : 0,
      }
    })
    .filter((item): item is SonarBand => item !== null)
}

export function normalizeSonarContext(value: unknown): SonarAnalysisContext {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const sampleCount = safeCount(record.sampleCount)
  const hardnessSamples = safeCount(record.hardnessSamples)
  const vegetationSamples = safeCount(record.vegetationSamples)
  const matchedDepth = (
    record.matchedCatchDepth && typeof record.matchedCatchDepth === 'object'
      ? record.matchedCatchDepth
      : {}
  ) as Record<string, unknown>

  return {
    surveyCount: safeCount(record.surveyCount),
    pointCount: safeCount(record.pointCount),
    firstSurveyAt: typeof record.firstSurveyAt === 'string' ? record.firstSurveyAt : null,
    lastSurveyAt: typeof record.lastSurveyAt === 'string' ? record.lastSurveyAt : null,
    minDepthM: round(plausibleDepth(record.minDepthM)),
    maxDepthM: round(plausibleDepth(record.maxDepthM)),
    cellCount: safeCount(record.cellCount),
    sampleCount,
    avgDepthM: round(finiteNumber(record.avgDepthM)),
    depthBands: normalizeBands(record.depthBands, sampleCount),
    slopeBands: normalizeBands(record.slopeBands, sampleCount),
    hardnessBands: normalizeBands(record.hardnessBands, hardnessSamples),
    hardnessSamples,
    vegetationBands: normalizeBands(record.vegetationBands, vegetationSamples),
    vegetationSamples,
    matchedCatches: safeCount(record.matchedCatches),
    matchedCatchDepth: {
      averageM: round(finiteNumber(matchedDepth.averageM)),
      minM: round(finiteNumber(matchedDepth.minM)),
      maxM: round(finiteNumber(matchedDepth.maxM)),
    },
    avgCatchSlopeDeg: round(finiteNumber(record.avgCatchSlopeDeg)),
    avgCatchBottomHardness: round(finiteNumber(record.avgCatchBottomHardness)),
    avgCatchWaterTempC: round(finiteNumber(record.avgCatchWaterTempC)),
    avgMatchDistanceM: round(finiteNumber(record.avgMatchDistanceM)),
  }
}

export function buildFishingAnalysisInput(
  catches: CatchForAnalysis[],
  sonarValue: unknown
): FishingAnalysisInput {
  const total = catches.length
  const weights = catches
    .map((caught) => finiteNumber(caught.weight_kg))
    .filter((value): value is number => value !== null && value > 0)
  const lengths = catches
    .map((caught) => finiteNumber(caught.length_cm))
    .filter((value): value is number => value !== null && value > 0)
  const depths = catches
    .map((caught) => finiteNumber(caught.depth_m))
    .filter((value): value is number => value !== null && value >= 0)
  const sonar = normalizeSonarContext(sonarValue)

  return {
    catches: {
      total,
      measuredWeights: weights.length,
      averageWeightKg: round(average(weights)),
      maxWeightKg: weights.length ? round(Math.max(...weights)) : null,
      measuredLengths: lengths.length,
      averageLengthCm: round(average(lengths)),
      maxLengthCm: lengths.length ? round(Math.max(...lengths)) : null,
      species: distribution(catches.map((caught) => caught.species), total),
      timeOfDay: distribution(catches.map((caught) => timeBucket(caught.caught_at)), total),
      months: distribution(catches.map((caught) => monthLabel(caught.caught_at)), total),
      methods: distribution(catches.map((caught) => caught.fishing_method), total),
      lures: distribution(
        catches.map((caught) => {
          const lure = cleanLabel(caught.lure_type)
          const color = cleanLabel(caught.lure_color)
          return lure ? `${lure}${color ? ` · ${color}` : ''}` : null
        }),
        total
      ),
      waters: distribution(catches.map((caught) => caught.water_body), total),
      weather: distribution(catches.map((caught) => caught.weather_condition), total),
      moonPhases: distribution(catches.map((caught) => caught.moon_phase), total),
      pressure: distribution(catches.map((caught) => pressureLabel(caught.pressure_hpa)), total),
      manualDepth: {
        count: depths.length,
        averageM: round(average(depths)),
        minM: depths.length ? round(Math.min(...depths)) : null,
        maxM: depths.length ? round(Math.max(...depths)) : null,
      },
    },
    sonar,
    dataQuality: {
      catchesAnalyzed: total,
      sonarPoints: sonar.pointCount,
      matchedCatches: sonar.matchedCatches,
      canCompareCatchLocationsToSonar: sonar.matchedCatches >= 3,
      bottomSignalIsBeta: true,
      vegetationSignalIsBeta: true,
    },
  }
}

function strongest(items: Array<{ label: string; count?: number; samples?: number; sharePct: number }>) {
  return [...items]
    .filter((item) => (item.count ?? item.samples ?? 0) > 0)
    .sort((a, b) => b.sharePct - a.sharePct)[0] ?? null
}

export function createCalculatedAnalysis(input: FishingAnalysisInput): FishingAiResult {
  const topSpecies = strongest(input.catches.species)
  const topTime = strongest(input.catches.timeOfDay)
  const topDepth = strongest(input.sonar.depthBands)
  const topSlope = strongest(input.sonar.slopeBands)
  const findings: FishingAiResult['findings'] = []

  if (topSpecies) {
    findings.push({
      title: `${topSpecies.label} dominerar loggen`,
      insight: `${topSpecies.label} är den vanligaste arten i dina registrerade fångster. Det beskriver din logg, men behöver inte betyda att arten alltid är lättast att fånga.`,
      evidence: `${topSpecies.count ?? 0} av ${input.catches.total} fångster (${topSpecies.sharePct} %).`,
      confidence: input.catches.total >= 20 ? 'high' : input.catches.total >= 8 ? 'medium' : 'low',
    })
  }

  if (topTime) {
    findings.push({
      title: `Flest fångster under ${topTime.label.toLowerCase()}`,
      insight: 'Tidsmönstret visar när dina registrerade fångster sker oftast. Det saknas fisketimmar utan fångst, så detta mäter inte säker fångst per timme.',
      evidence: `${topTime.count ?? 0} fångster (${topTime.sharePct} %) i detta tidsfönster.`,
      confidence: input.catches.total >= 30 ? 'medium' : 'low',
    })
  }

  if (topDepth && input.sonar.pointCount > 0) {
    findings.push({
      title: `Djupkartan är tätast vid ${topDepth.label}`,
      insight: `Den importerade ekolodsdatan innehåller mest mätunderlag i intervallet ${topDepth.label}. Det är det bäst kartlagda djupområdet för framtida jämförelser.`,
      evidence: `${topDepth.sharePct} % av de aggregerade sonarmätningarna och ${input.sonar.pointCount.toLocaleString('sv-SE')} survey points totalt.`,
      confidence: input.sonar.pointCount >= 100_000 ? 'high' : 'medium',
    })
  }

  if (topSlope && input.sonar.pointCount > 0) {
    findings.push({
      title: `Mest kartlagd terräng: ${topSlope.label}`,
      insight: 'Lutningsfördelningen beskriver bottenformen i de körda spåren och kan användas för att planera mer jämförbara pass längs kanter och flackare partier.',
      evidence: `${topSlope.sharePct} % av de aggregerade sonarmätningarna ligger i denna lutningsklass.`,
      confidence: 'medium',
    })
  }

  if (findings.length === 0) {
    findings.push({
      title: 'Mer data behövs',
      insight: 'Logga några fångster eller importera ett ekolodsspår för att få en meningsfull mönsteranalys.',
      evidence: `${input.catches.total} fångster och ${input.sonar.pointCount} sonarpunkter är tillgängliga.`,
      confidence: 'low',
    })
  }

  const nextActions: FishingAiResult['nextActions'] = []
  if (topDepth) {
    nextActions.push({
      title: `Testa ${topDepth.label} systematiskt`,
      action: 'Logga både lyckade och resultatlösa pass på samma djup, med metod och tid, så kan nästa analys jämföra faktisk fångstfrekvens.',
      why: 'Nuvarande data visar var du har mätt och fångat, men inte hur många timmar du har fiskat utan fångst.',
    })
  }
  if (topTime) {
    nextActions.push({
      title: `Jämför med ett annat tidsfönster`,
      action: `Planera två liknande pass: ett under ${topTime.label.toLowerCase()} och ett vid en annan tid, på samma vatten och med samma metod.`,
      why: 'Det minskar risken att tidseffekten egentligen beror på plats, metod eller hur ofta du brukar fiska då.',
    })
  }
  if (!input.dataQuality.canCompareCatchLocationsToSonar && input.sonar.pointCount > 0) {
    nextActions.push({
      title: 'Koppla fler fångster till sjökartan',
      action: 'Se till att plats och tid finns på framtida fångster i områden med ekolodsdata.',
      why: 'Minst tre platsmatchade fångster behövs innan djup, lutning och bottensignal kan jämföras på ett rimligt sätt.',
    })
  }

  const limitations = [
    'Analysen visar samband i din egen logg och bevisar inte vad som orsakar en fångst.',
  ]
  if (!input.dataQuality.canCompareCatchLocationsToSonar) {
    limitations.push(
      `${input.sonar.matchedCatches} fångster är säkert platsmatchade mot ekolodsdata; fångst- och sonarresultat redovisas därför separat.`
    )
  }
  if (input.sonar.hardnessSamples > 0 || input.sonar.vegetationSamples > 0) {
    limitations.push('Bottenhårdhet och vegetation bygger på leverantörssignaler och visas som beta.')
  }

  return {
    headline: input.sonar.pointCount > 0
      ? 'Din fångstlogg möter din egen djupkarta'
      : 'Mönster i din fångstlogg',
    summary: `Analysen bygger på ${input.catches.total} fångster och ${input.sonar.pointCount.toLocaleString('sv-SE')} importerade sonarpunkter. De tydligaste mönstren visas med datastöd och en försiktig bedömning av säkerheten.`,
    findings: findings.slice(0, 4),
    nextActions: nextActions.slice(0, 3),
    limitations: limitations.slice(0, 4),
  }
}

export function parseAiJson(text: string): FishingAiResult | null {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    const parsed = JSON.parse(withoutFence.slice(start, end + 1))
    const validated = FishingAiResultSchema.safeParse(parsed)
    return validated.success ? validated.data : null
  } catch {
    return null
  }
}

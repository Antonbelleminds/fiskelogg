export type SonarSignalLevel = 'low' | 'medium' | 'high' | 'unknown'

export interface CatchSonarContext {
  catchId: string
  species: string | null
  weightKg: number | null
  lengthCm: number | null
  caughtAt: string
  found: boolean
  depthM: number | null
  minDepthM: number | null
  maxDepthM: number | null
  coverageConfidence: number | null
  cellDistanceM: number | null
  signalDistanceM: number | null
  hardnessClass: SonarSignalLevel
  vegetationClass: SonarSignalLevel
  vendorChannelA: number | null
  vendorChannelB: number | null
}

export interface CatchSonarItem extends CatchSonarContext {
  depthReliable: boolean
  signalReliable: boolean
}

export interface CatchSonarSummary {
  matchedCount: number
  depthCount: number
  averageDepthM: number | null
  medianDepthM: number | null
  minDepthM: number | null
  maxDepthM: number | null
  depthBands: Array<{
    label: string
    count: number
    averageWeightKg: number | null
  }>
  hardness: Record<Exclude<SonarSignalLevel, 'unknown'>, number>
  vegetation: Record<Exclude<SonarSignalLevel, 'unknown'>, number>
  items: CatchSonarItem[]
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function isPlausibleDepth(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0.2 && value <= 200
}

export function hasReliableCatchDepth(context: CatchSonarContext): boolean {
  if (!context.found || !isPlausibleDepth(context.depthM)) return false
  if (context.cellDistanceM !== null && context.cellDistanceM > 20) return false
  if (
    context.coverageConfidence === null ||
    context.coverageConfidence < 0.45
  ) {
    return false
  }

  if (context.minDepthM !== null && context.maxDepthM !== null) {
    const spread = context.maxDepthM - context.minDepthM
    if (spread > Math.max(3, context.depthM)) return false
  }

  return true
}

export function hasReliableCatchSignal(context: CatchSonarContext): boolean {
  if (!context.found) return false
  if (context.signalDistanceM === null || context.signalDistanceM > 20) {
    return false
  }
  return (
    context.hardnessClass !== 'unknown' ||
    context.vegetationClass !== 'unknown'
  )
}

export function buildCatchSonarSummary(
  contexts: CatchSonarContext[]
): CatchSonarSummary {
  const items = contexts
    .map((context) => ({
      ...context,
      depthReliable: hasReliableCatchDepth(context),
      signalReliable: hasReliableCatchSignal(context),
    }))
    .filter((context) => context.depthReliable || context.signalReliable)
    .sort(
      (a, b) =>
        new Date(b.caughtAt).getTime() - new Date(a.caughtAt).getTime()
    )

  const depthItems = items.filter(
    (item): item is CatchSonarItem & { depthM: number } =>
      item.depthReliable && item.depthM !== null
  )
  const sortedDepths = depthItems
    .map((item) => item.depthM)
    .sort((a, b) => a - b)
  const midpoint = Math.floor(sortedDepths.length / 2)
  const median =
    sortedDepths.length === 0
      ? null
      : sortedDepths.length % 2 === 0
        ? (sortedDepths[midpoint - 1] + sortedDepths[midpoint]) / 2
        : sortedDepths[midpoint]

  const depthBands = [
    { label: '0–2 m', min: 0, max: 2 },
    { label: '2–5 m', min: 2, max: 5 },
    { label: '5–10 m', min: 5, max: 10 },
    { label: '10+ m', min: 10, max: Number.POSITIVE_INFINITY },
  ].map((band) => {
    const matches = depthItems.filter(
      (item) => item.depthM >= band.min && item.depthM < band.max
    )
    const weights = matches
      .map((item) => item.weightKg)
      .filter((weight): weight is number => weight !== null && weight > 0)
    return {
      label: band.label,
      count: matches.length,
      averageWeightKg:
        weights.length > 0
          ? round(weights.reduce((sum, weight) => sum + weight, 0) / weights.length)
          : null,
    }
  })

  const hardness = { low: 0, medium: 0, high: 0 }
  const vegetation = { low: 0, medium: 0, high: 0 }
  for (const item of items) {
    if (!item.signalReliable) continue
    if (item.hardnessClass !== 'unknown') hardness[item.hardnessClass] += 1
    if (item.vegetationClass !== 'unknown') vegetation[item.vegetationClass] += 1
  }

  return {
    matchedCount: items.length,
    depthCount: depthItems.length,
    averageDepthM:
      sortedDepths.length > 0
        ? round(
            sortedDepths.reduce((sum, depth) => sum + depth, 0) /
              sortedDepths.length
          )
        : null,
    medianDepthM: median === null ? null : round(median),
    minDepthM: sortedDepths.length > 0 ? round(sortedDepths[0]) : null,
    maxDepthM:
      sortedDepths.length > 0
        ? round(sortedDepths[sortedDepths.length - 1])
        : null,
    depthBands,
    hardness,
    vegetation,
    items,
  }
}

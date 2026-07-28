const MIN_BOUNDS_SPAN_DEGREES = 0.0000002

function ensureSpan(
  minimum: number,
  maximum: number,
  lowerLimit: number,
  upperLimit: number
) {
  if (maximum - minimum >= MIN_BOUNDS_SPAN_DEGREES) {
    return [minimum, maximum] as const
  }

  const center = (minimum + maximum) / 2
  const halfSpan = MIN_BOUNDS_SPAN_DEGREES / 2
  const expandedMinimum = Math.max(lowerLimit, center - halfSpan)
  const expandedMaximum = Math.min(upperLimit, center + halfSpan)

  if (expandedMaximum - expandedMinimum >= MIN_BOUNDS_SPAN_DEGREES) {
    return [expandedMinimum, expandedMaximum] as const
  }
  if (expandedMinimum === lowerLimit) {
    return [lowerLimit, lowerLimit + MIN_BOUNDS_SPAN_DEGREES] as const
  }
  return [upperLimit - MIN_BOUNDS_SPAN_DEGREES, upperLimit] as const
}

export function boundsPolygonWkt(bounds: {
  west: number
  south: number
  east: number
  north: number
}) {
  const [west, east] = ensureSpan(bounds.west, bounds.east, -180, 180)
  const [south, north] = ensureSpan(bounds.south, bounds.north, -90, 90)

  return `SRID=4326;POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`
}

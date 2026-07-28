function getZonedParts(epochMs: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  )

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

/**
 * Humminbird ACU stores a local wall-clock value in a Unix-shaped integer.
 * The numeric value must therefore be interpreted in the device time zone,
 * not as UTC.
 */
export function deviceWallClockEpochToUtcMs(
  deviceLocalEpochSeconds: number,
  timeZone: string
) {
  const wallClock = new Date(deviceLocalEpochSeconds * 1000)
  const wantedUtcShape = Date.UTC(
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth(),
    wallClock.getUTCDate(),
    wallClock.getUTCHours(),
    wallClock.getUTCMinutes(),
    wallClock.getUTCSeconds()
  )

  let candidate = wantedUtcShape

  // Two passes handle DST offsets and the uncommon transitions where the
  // first guess falls on the other side of an offset boundary.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = getZonedParts(candidate, timeZone)
    const zonedUtcShape = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    )
    const correction = wantedUtcShape - zonedUtcShape
    candidate += correction
    if (correction === 0) break
  }

  return candidate
}

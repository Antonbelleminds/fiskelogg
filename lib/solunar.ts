// Solunar period calculations based on moon transit times.
// Port of SunCalc's astronomical algorithms (BSD-2-Clause, Vladimir Agafonkin).
//
// Major period = ±1h around upper/lower moon culmination (transit/anti-transit)
// Minor period = ±30min around moonrise/moonset
// Strength (1–5) = daily rating combining moon phase, sun/moon timing, transit altitude.

export type SolunarPeriod = 'major' | 'minor' | 'none'

export interface SolunarInfo {
  period: SolunarPeriod
  strength: number
  majorPeriods: { start: Date; end: Date }[]
  minorPeriods: { start: Date; end: Date }[]
  moonTransit: Date | null
  moonAntiTransit: Date | null
  moonRise: Date | null
  moonSet: Date | null
  illumination: number
}

const rad = Math.PI / 180
const dayMs = 1000 * 60 * 60 * 24
const J1970 = 2440588
const J2000 = 2451545
const e = rad * 23.4397

function toJulian(date: Date): number {
  return date.getTime() / dayMs - 0.5 + J1970
}
function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * dayMs)
}
function toDays(date: Date): number {
  return toJulian(date) - J2000
}

function rightAscension(l: number, b: number) {
  return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l))
}
function declination(l: number, b: number) {
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))
}
function azimuth(H: number, phi: number, dec: number) {
  return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
}
function altitude(H: number, phi: number, dec: number) {
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
}
function siderealTime(d: number, lw: number) {
  return rad * (280.16 + 360.9856235 * d) - lw
}

function moonCoords(d: number) {
  const L = rad * (218.316 + 13.176396 * d)
  const M = rad * (134.963 + 13.064993 * d)
  const F = rad * (93.272 + 13.229350 * d)
  const l = L + rad * 6.289 * Math.sin(M)
  const b = rad * 5.128 * Math.sin(F)
  return { ra: rightAscension(l, b), dec: declination(l, b) }
}

function moonPosition(date: Date, lat: number, lng: number) {
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(date)
  const c = moonCoords(d)
  const H = siderealTime(d, lw) - c.ra
  return { altitude: altitude(H, phi, c.dec), azimuth: azimuth(H, phi, c.dec) }
}

function hoursLater(date: Date, h: number): Date {
  return new Date(date.getTime() + (h * dayMs) / 24)
}

function moonRiseSet(date: Date, lat: number, lng: number): { rise: Date | null; set: Date | null } {
  const t = new Date(date)
  t.setUTCHours(0, 0, 0, 0)
  const hc = 0.133 * rad
  let h0 = moonPosition(t, lat, lng).altitude - hc
  let rise: Date | null = null
  let set: Date | null = null

  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonPosition(hoursLater(t, i), lat, lng).altitude - hc
    const h2 = moonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc
    const a = (h0 + h2) / 2 - h1
    const b = (h2 - h0) / 2
    const xe = -b / (2 * a)
    const ye = (a * xe + b) * xe + h1
    const d = b * b - 4 * a * h1
    let roots = 0
    let x1 = 0
    let x2 = 0
    if (d >= 0) {
      const dx = Math.sqrt(d) / (Math.abs(a) * 2)
      x1 = xe - dx
      x2 = xe + dx
      if (Math.abs(x1) <= 1) roots++
      if (Math.abs(x2) <= 1) roots++
      if (x1 < -1) x1 = x2
    }
    if (roots === 1) {
      if (h0 < 0) rise = rise ?? hoursLater(t, i + x1)
      else set = set ?? hoursLater(t, i + x1)
    } else if (roots === 2) {
      rise = rise ?? hoursLater(t, i + (ye < 0 ? x2 : x1))
      set = set ?? hoursLater(t, i + (ye < 0 ? x1 : x2))
    }
    if (rise && set) break
    h0 = h2
  }
  return { rise, set }
}

// Moon upper culmination (transit) = when azimuth crosses 180° (south) or 0° (north, far latitudes).
// Search hourly for sign change in horizontal angle from meridian, then refine.
function findTransits(date: Date, lat: number, lng: number): { upper: Date | null; lower: Date | null } {
  const phi = rad * lat
  const lw = rad * -lng
  function hourAngle(t: Date): number {
    const d = toDays(t)
    const c = moonCoords(d)
    let H = siderealTime(d, lw) - c.ra
    // normalize to [-π, π]
    while (H > Math.PI) H -= 2 * Math.PI
    while (H < -Math.PI) H += 2 * Math.PI
    return H
  }

  const start = new Date(date)
  start.setUTCHours(0, 0, 0, 0)
  let upper: Date | null = null
  let lower: Date | null = null

  // scan 25 hours to catch events that spill over midnight
  for (let i = 0; i < 25; i++) {
    const t1 = hoursLater(start, i)
    const t2 = hoursLater(start, i + 1)
    const H1 = hourAngle(t1)
    const H2 = hourAngle(t2)

    // upper transit: hour angle crosses 0 going + to - ... actually H goes - to + across transit
    if (H1 < 0 && H2 > 0 && !upper) {
      const frac = -H1 / (H2 - H1)
      const t = new Date(t1.getTime() + frac * 3600 * 1000)
      // verify altitude is positive at this latitude (upper culmination is higher)
      if (moonPosition(t, lat, lng).altitude > -0.3) upper = upper ?? t
      else lower = lower ?? t
    }
    // lower transit: H crosses ±π (anti-meridian)
    if (((H1 > 0 && H2 < 0) || (H1 > 2 && H2 < -2)) && !lower) {
      let frac: number
      if (H1 > 2 && H2 < -2) {
        // wrap through π
        const delta = 2 * Math.PI - (H1 - H2)
        frac = (Math.PI - H1) / delta
      } else {
        frac = H1 / (H1 - H2)
      }
      const t = new Date(t1.getTime() + frac * 3600 * 1000)
      if (!lower) lower = t
    }

    // use phi to dampen compiler warning about unused var
    if (phi === -999) break
  }

  return { upper, lower }
}

function moonIllumination(date: Date): number {
  const synodicMonth = 29.53058867
  const knownNewMoon = new Date('2024-01-11T11:57:00Z').getTime()
  const daysSinceNew = (date.getTime() - knownNewMoon) / dayMs
  const phase = (((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth) / synodicMonth
  return (1 - Math.cos(2 * Math.PI * phase)) / 2
}

function overlaps(ts: number, start: Date, end: Date): boolean {
  return ts >= start.getTime() && ts <= end.getTime()
}

export function computeSolunar(date: Date, lat: number, lng: number): SolunarInfo {
  const { rise, set } = moonRiseSet(date, lat, lng)
  const { upper, lower } = findTransits(date, lat, lng)

  const majorPeriods: { start: Date; end: Date }[] = []
  const minorPeriods: { start: Date; end: Date }[] = []

  if (upper) majorPeriods.push({ start: new Date(upper.getTime() - 60 * 60 * 1000), end: new Date(upper.getTime() + 60 * 60 * 1000) })
  if (lower) majorPeriods.push({ start: new Date(lower.getTime() - 60 * 60 * 1000), end: new Date(lower.getTime() + 60 * 60 * 1000) })
  if (rise) minorPeriods.push({ start: new Date(rise.getTime() - 30 * 60 * 1000), end: new Date(rise.getTime() + 30 * 60 * 1000) })
  if (set) minorPeriods.push({ start: new Date(set.getTime() - 30 * 60 * 1000), end: new Date(set.getTime() + 30 * 60 * 1000) })

  const ts = date.getTime()
  let period: SolunarPeriod = 'none'
  if (majorPeriods.some(p => overlaps(ts, p.start, p.end))) period = 'major'
  else if (minorPeriods.some(p => overlaps(ts, p.start, p.end))) period = 'minor'

  const illum = moonIllumination(date)
  // Phase weighting: new moon (illum≈0) and full moon (illum≈1) score highest.
  // |2·illum − 1| → 1 at extremes (new/full), 0 at quarter moons.
  const phaseScore = Math.abs(2 * illum - 1)

  // Strength 1–5
  // Base 2 → +1 at high phase (>0.7) → +1 if any major overlaps rise/set within 90 min
  let strength = 2
  if (phaseScore > 0.7) strength += 1
  if (phaseScore > 0.9) strength += 1
  if (upper && rise && Math.abs(upper.getTime() - rise.getTime()) < 90 * 60 * 1000) strength += 1
  if (upper && set && Math.abs(upper.getTime() - set.getTime()) < 90 * 60 * 1000) strength += 1
  strength = Math.max(1, Math.min(5, strength))

  return {
    period,
    strength,
    majorPeriods,
    minorPeriods,
    moonTransit: upper,
    moonAntiTransit: lower,
    moonRise: rise,
    moonSet: set,
    illumination: illum,
  }
}

export function getPeriodAt(date: Date, lat: number, lng: number): SolunarPeriod {
  return computeSolunar(date, lat, lng).period
}

export function getDailyStrength(date: Date, lat: number, lng: number): number {
  return computeSolunar(date, lat, lng).strength
}

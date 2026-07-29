import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCatchSonarSummary,
  type CatchSonarContext,
} from '../../lib/sonar/catch-context-stats'

function context(
  overrides: Partial<CatchSonarContext>
): CatchSonarContext {
  return {
    catchId: crypto.randomUUID(),
    species: 'Gädda',
    weightKg: 4,
    lengthCm: 85,
    caughtAt: '2026-05-01T10:00:00Z',
    found: true,
    depthM: 3,
    minDepthM: 2.5,
    maxDepthM: 3.5,
    coverageConfidence: 0.8,
    cellDistanceM: 4,
    signalDistanceM: 5,
    hardnessClass: 'medium',
    vegetationClass: 'low',
    vendorChannelA: 7,
    vendorChannelB: 0.3,
    ...overrides,
  }
}

test('summarizes reliable catch-linked depth and sonar signals', () => {
  const summary = buildCatchSonarSummary([
    context({ depthM: 1.5, weightKg: 3 }),
    context({
      depthM: 4,
      weightKg: 5,
      hardnessClass: 'high',
      vegetationClass: 'medium',
    }),
  ])

  assert.equal(summary.matchedCount, 2)
  assert.equal(summary.medianDepthM, 2.8)
  assert.equal(summary.depthBands[0].count, 1)
  assert.equal(summary.depthBands[1].count, 1)
  assert.equal(summary.hardness.medium, 1)
  assert.equal(summary.hardness.high, 1)
  assert.equal(summary.vegetation.low, 1)
  assert.equal(summary.vegetation.medium, 1)
})

test('excludes distant and contradictory sonar matches', () => {
  const summary = buildCatchSonarSummary([
    context({ cellDistanceM: 35, signalDistanceM: 35 }),
    context({ depthM: 3, minDepthM: 1, maxDepthM: 12, signalDistanceM: 40 }),
  ])

  assert.equal(summary.matchedCount, 0)
  assert.equal(summary.depthCount, 0)
  assert.equal(summary.averageDepthM, null)
})

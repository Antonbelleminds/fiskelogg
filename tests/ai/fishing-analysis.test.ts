import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFishingAnalysisInput,
  createCalculatedAnalysis,
  parseAiJson,
} from '../../lib/ai/fishing-analysis'

const sonar = {
  surveyCount: 2,
  pointCount: 120_000,
  firstSurveyAt: '2026-05-01T08:00:00Z',
  lastSurveyAt: '2026-05-02T12:00:00Z',
  minDepthM: 1,
  maxDepthM: 18,
  cellCount: 200,
  sampleCount: 1_000,
  avgDepthM: 5.4,
  depthBands: [
    { label: '0–2 m', samples: 100 },
    { label: '2–5 m', samples: 600 },
    { label: '5–10 m', samples: 300 },
  ],
  slopeBands: [
    { label: 'Flackt (<5°)', samples: 700 },
    { label: 'Djupkant (5–15°)', samples: 300 },
  ],
  hardnessBands: [{ label: 'Mellan', samples: 500 }],
  hardnessSamples: 500,
  vegetationBands: [{ label: 'Låg signal', samples: 400 }],
  vegetationSamples: 400,
  matchedCatches: 0,
  matchedCatchDepth: { averageM: null, minM: null, maxM: null },
}

test('builds distributions without treating missing values as observations', () => {
  const input = buildFishingAnalysisInput(
    [
      {
        species: 'Abborre',
        weight_kg: 1.2,
        length_cm: 42,
        caught_at: '2026-05-01T07:30:00+02:00',
        water_body: 'Testsjön',
        fishing_method: 'Spinnfiske',
        lure_type: 'Jigg',
        lure_color: 'Grön',
        weather_condition: 'Klart',
        pressure_hpa: 1012,
        moon_phase: null,
        depth_m: 4,
        water_temp_c: 14,
      },
      {
        species: 'Abborre',
        weight_kg: null,
        length_cm: null,
        caught_at: '2026-05-02T08:10:00+02:00',
        water_body: null,
        fishing_method: 'Spinnfiske',
        lure_type: null,
        lure_color: null,
        weather_condition: null,
        pressure_hpa: null,
        moon_phase: null,
        depth_m: null,
        water_temp_c: null,
      },
    ],
    sonar
  )

  assert.equal(input.catches.total, 2)
  assert.deepEqual(input.catches.species[0], {
    label: 'Abborre',
    count: 2,
    sharePct: 100,
  })
  assert.equal(input.catches.measuredWeights, 1)
  assert.equal(input.sonar.depthBands[1].sharePct, 60)
  assert.equal(input.dataQuality.canCompareCatchLocationsToSonar, false)
})

test('calculated analysis keeps unmatched sonar and catches separate', () => {
  const input = buildFishingAnalysisInput([], sonar)
  const result = createCalculatedAnalysis(input)

  assert.match(result.summary, /120[  ]?000/)
  assert.ok(result.limitations.some((item) => item.includes('platsmatchade')))
  assert.ok(result.nextActions.some((item) => item.title.includes('Koppla')))
})

test('parses fenced AI JSON and rejects an invalid contract', () => {
  const valid = parseAiJson(`\`\`\`json
  {
    "headline": "Test",
    "summary": "En försiktig sammanfattning.",
    "findings": [{
      "title": "Mönster",
      "insight": "Ett samband.",
      "evidence": "10 av 20 fångster.",
      "confidence": "medium"
    }],
    "nextActions": [{
      "title": "Testa",
      "action": "Gör ett jämförbart pass.",
      "why": "Det ger bättre underlag."
    }],
    "limitations": ["Ingen kausalitet."]
  }
  \`\`\``)

  assert.equal(valid?.headline, 'Test')
  assert.equal(parseAiJson('{"headline":"saknar resten"}'), null)
})

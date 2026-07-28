import assert from 'node:assert/strict'
import test from 'node:test'
import { boundsPolygonWkt } from '../../lib/sonar/geometry'

test('stationary sonar bounds are expanded into a non-degenerate polygon', () => {
  const wkt = boundsPolygonWkt({
    west: 18.123,
    east: 18.123,
    south: 59.456,
    north: 59.456,
  })

  assert.match(wkt, /^SRID=4326;POLYGON\(\(/)
  const coordinateText = wkt.match(/POLYGON\(\((.*)\)\)/)?.[1]
  assert.ok(coordinateText)
  const coordinates = coordinateText
    .split(',')
    .map((pair) => pair.split(' ').map(Number))

  assert.ok(Math.max(...coordinates.map(([lon]) => lon)) > 18.123)
  assert.ok(Math.min(...coordinates.map(([lon]) => lon)) < 18.123)
  assert.ok(Math.max(...coordinates.map(([, lat]) => lat)) > 59.456)
  assert.ok(Math.min(...coordinates.map(([, lat]) => lat)) < 59.456)
})

test('stationary bounds stay within valid coordinate limits', () => {
  const wkt = boundsPolygonWkt({
    west: 180,
    east: 180,
    south: 90,
    north: 90,
  })

  assert.doesNotMatch(wkt, /180\.000000/)
  assert.doesNotMatch(wkt, /90\.000000/)
})

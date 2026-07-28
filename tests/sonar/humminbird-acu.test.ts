import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  HUMMINBIRD_ACU_HEADER_SIZE,
  HUMMINBIRD_ACU_RECORD_SIZE,
  humminbirdAcuImporter,
} from '../../lib/sonar/importers/humminbird-acu'

function readRemovableFixture(path: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return readFileSync(path)
    } catch (error) {
      lastError = error
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ETIMEDOUT'
      ) {
        throw error
      }
    }
  }
  if (
    lastError instanceof Error &&
    'code' in lastError &&
    lastError.code === 'ETIMEDOUT'
  ) {
    return null
  }
  throw lastError
}

function syntheticAcu() {
  const bytes = new Uint8Array(
    HUMMINBIRD_ACU_HEADER_SIZE + 2 * HUMMINBIRD_ACU_RECORD_SIZE
  )
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 11, true)
  view.setUint32(4, 1_778_775_307, true)
  view.setUint32(8, 10, true)
  view.setUint32(12, 1, true)
  view.setFloat64(16, 60.28, true)
  view.setFloat64(24, 60.27, true)
  view.setFloat64(32, 16.05, true)
  view.setFloat64(40, 16.02, true)
  view.setUint32(52, 2, true)
  view.setUint32(56, 0x07000000, true)
  view.setFloat32(60, 1, true)

  for (let index = 0; index < 2; index += 1) {
    const offset = HUMMINBIRD_ACU_HEADER_SIZE + index * HUMMINBIRD_ACU_RECORD_SIZE
    view.setFloat64(offset, 60.274 + index * 0.0001, true)
    view.setFloat64(offset + 8, 16.042 + index * 0.0001, true)
    view.setFloat32(offset + 16, 3.25 + index, true)
    view.setUint32(offset + 20, 8_938_000 + index * 1_000, true)
    view.setFloat32(offset + 24, 4.2, true)
    view.setFloat32(offset + 28, -1, true)
  }

  return bytes
}

test('probes, validates and parses a Humminbird ACU v11 file', () => {
  const bytes = syntheticAcu()
  const descriptor = {
    name: '26051400.ACU',
    relativePath: 'ACDATA/26051400.ACU',
    size: bytes.byteLength,
  }
  const probe = humminbirdAcuImporter.probe(
    descriptor,
    bytes.subarray(0, HUMMINBIRD_ACU_HEADER_SIZE)
  )
  assert.equal(probe?.confidence, 1)
  assert.equal(probe?.manufacturer, 'humminbird')

  const header = humminbirdAcuImporter.parseHeader!(
    descriptor,
    bytes.subarray(0, HUMMINBIRD_ACU_HEADER_SIZE)
  )
  assert.equal(header.recordCount, 2)
  assert.equal(header.recordSize, 32)

  const parsed = humminbirdAcuImporter.parsePointChunk!(
    bytes.subarray(HUMMINBIRD_ACU_HEADER_SIZE),
    {
      header,
      firstElapsedMs: 8_938_000,
      firstRecordIndex: 0,
      deviceTimezone: 'Europe/Stockholm',
    }
  )
  assert.equal(parsed.invalidRecords, 0)
  assert.equal(parsed.points.length, 2)
  assert.equal(parsed.points[0].depth_m, 3.25)
  assert.equal(parsed.points[1].observed_at, '2026-05-14T14:15:08.000Z')
  assert.equal(parsed.points[0].bottom_hardness, null)
  assert.equal(parsed.points[0].vendor_channel_a, 4.199999809265137)
})

for (const fileName of [
  '26051400.ACU',
  '26051600.ACU',
  '26052900.ACU',
  '26053000.ACU',
]) {
  const path = `/Volumes/ACEU1/ACDATA/${fileName}`

  test(
    `parses the provided SD-card fixture ${fileName}`,
    { skip: !existsSync(path) },
    (context) => {
      const buffer = readRemovableFixture(path)
      if (!buffer) {
        context.skip('Den flyttbara SD-volymen svarade inte efter tre försök.')
        return
      }
      const bytes = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength
      )
      const descriptor = {
        name: fileName,
        relativePath: `ACDATA/${fileName}`,
        size: bytes.byteLength,
      }
      const header = humminbirdAcuImporter.parseHeader!(
        descriptor,
        bytes.subarray(0, HUMMINBIRD_ACU_HEADER_SIZE)
      )
      const firstElapsedMs = new DataView(
        bytes.buffer,
        bytes.byteOffset + HUMMINBIRD_ACU_HEADER_SIZE,
        HUMMINBIRD_ACU_RECORD_SIZE
      ).getUint32(20, true)
      const parsed = humminbirdAcuImporter.parsePointChunk!(
        bytes.subarray(HUMMINBIRD_ACU_HEADER_SIZE),
        {
          header,
          firstElapsedMs,
          firstRecordIndex: 0,
          deviceTimezone: 'Europe/Stockholm',
        }
      )

      assert.equal(parsed.points.length + parsed.invalidRecords, header.recordCount)
      assert.equal(parsed.invalidRecords, 0)
      assert.ok(parsed.points.every((point) => point.depth_m > 0))
      assert.ok(
        parsed.points.every(
          (point) =>
            point.lat >= header.bounds.south &&
            point.lat <= header.bounds.north &&
            point.lon >= header.bounds.west &&
            point.lon <= header.bounds.east
        )
      )
    }
  )
}

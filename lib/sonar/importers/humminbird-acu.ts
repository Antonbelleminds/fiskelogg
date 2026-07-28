import {
  type ParsedPointChunk,
  type PointChunkContext,
  type SonarFileDescriptor,
  type SonarImporterPlugin,
  type SonarParsedHeader,
  type SonarProbeResult,
} from '@/lib/sonar/types'
import { deviceWallClockEpochToUtcMs } from '@/lib/sonar/time'

export const HUMMINBIRD_ACU_HEADER_SIZE = 64
export const HUMMINBIRD_ACU_RECORD_SIZE = 32

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function validBounds(headerView: DataView) {
  const north = headerView.getFloat64(16, true)
  const south = headerView.getFloat64(24, true)
  const east = headerView.getFloat64(32, true)
  const west = headerView.getFloat64(40, true)

  return (
    Number.isFinite(north) &&
    Number.isFinite(south) &&
    Number.isFinite(east) &&
    Number.isFinite(west) &&
    north >= south &&
    east >= west &&
    north >= -90 &&
    north <= 90 &&
    south >= -90 &&
    south <= 90 &&
    east >= -180 &&
    east <= 180 &&
    west >= -180 &&
    west <= 180
  )
}

function probeAcu(
  descriptor: SonarFileDescriptor,
  prefix: Uint8Array
): SonarProbeResult | null {
  if (!descriptor.name.toLowerCase().endsWith('.acu')) return null

  if (prefix.byteLength < HUMMINBIRD_ACU_HEADER_SIZE) {
    return {
      confidence: 0.25,
      manufacturer: 'humminbird',
      format: 'humminbird-autochart-live-acu',
      model: null,
      capability: 'points',
      reason: 'Filen är kortare än ACU-headern och kan vara korrupt.',
    }
  }

  const header = view(prefix)
  const formatVersion = header.getUint32(0, true)
  const typeCode = header.getUint32(8, true)
  const recordCount = header.getUint32(52, true)
  const exactSize =
    descriptor.size ===
    HUMMINBIRD_ACU_HEADER_SIZE + recordCount * HUMMINBIRD_ACU_RECORD_SIZE

  const structurallyValid =
    formatVersion > 0 &&
    formatVersion < 100 &&
    typeCode === 10 &&
    recordCount > 0 &&
    validBounds(header)

  if (!structurallyValid) {
    return {
      confidence: 0.35,
      manufacturer: 'humminbird',
      format: 'humminbird-autochart-live-acu',
      model: null,
      capability: 'points',
      reason: 'Filändelsen är ACU men binärheadern matchar inte känd AutoChart Live.',
    }
  }

  return {
    confidence: exactSize ? 1 : 0.8,
    manufacturer: 'humminbird',
    format: 'humminbird-autochart-live-acu',
    model: null,
    capability: 'points',
    reason: exactSize
      ? undefined
      : 'ACU-strukturen känns igen men filstorleken avviker från postantalet.',
  }
}

function parseAcuHeader(
  descriptor: SonarFileDescriptor,
  prefix: Uint8Array
): SonarParsedHeader {
  if (prefix.byteLength < HUMMINBIRD_ACU_HEADER_SIZE) {
    throw new Error('ACU_HEADER_TRUNCATED')
  }

  const header = view(prefix)
  const recordCount = header.getUint32(52, true)
  const expectedSize =
    HUMMINBIRD_ACU_HEADER_SIZE + recordCount * HUMMINBIRD_ACU_RECORD_SIZE

  if (!validBounds(header)) throw new Error('ACU_INVALID_BOUNDS')
  if (recordCount === 0) throw new Error('ACU_NO_RECORDS')
  if (descriptor.size < expectedSize) throw new Error('ACU_TRUNCATED_RECORDS')

  return {
    format: 'humminbird-autochart-live-acu',
    formatVersion: header.getUint32(0, true),
    manufacturer: 'humminbird',
    // AutoChart Live ACU v11 does not encode a verified model identifier.
    model: null,
    recordSize: HUMMINBIRD_ACU_RECORD_SIZE,
    recordCount,
    headerSize: HUMMINBIRD_ACU_HEADER_SIZE,
    deviceLocalStartedAtEpochSeconds: header.getUint32(4, true),
    bounds: {
      north: header.getFloat64(16, true),
      south: header.getFloat64(24, true),
      east: header.getFloat64(32, true),
      west: header.getFloat64(40, true),
    },
    raw: {
      typeCode: header.getUint32(8, true),
      flags: header.getUint32(12, true),
      vendorHeaderValue: header.getUint32(48, true),
      channelMask: header.getUint32(56, true),
      scale: header.getFloat32(60, true),
      trailingBytes: descriptor.size - expectedSize,
      modelEncoded: false,
    },
  }
}

function parseAcuPointChunk(
  bytes: Uint8Array,
  context: PointChunkContext
): ParsedPointChunk {
  if (bytes.byteLength % HUMMINBIRD_ACU_RECORD_SIZE !== 0) {
    throw new Error('ACU_MISALIGNED_CHUNK')
  }

  const data = view(bytes)
  const recordCount = bytes.byteLength / HUMMINBIRD_ACU_RECORD_SIZE
  const localStartUtcMs = deviceWallClockEpochToUtcMs(
    context.header.deviceLocalStartedAtEpochSeconds,
    context.deviceTimezone
  )
  const points = []
  let invalidRecords = 0

  for (let index = 0; index < recordCount; index += 1) {
    const offset = index * HUMMINBIRD_ACU_RECORD_SIZE
    const recordIndex = context.firstRecordIndex + index
    const lat = data.getFloat64(offset, true)
    const lon = data.getFloat64(offset + 8, true)
    const depth = data.getFloat32(offset + 16, true)
    const elapsed = data.getUint32(offset + 20, true)
    const vendorA = data.getFloat32(offset + 24, true)
    const vendorB = data.getFloat32(offset + 28, true)

    const valid =
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Number.isFinite(depth) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180 &&
      depth >= 0 &&
      depth <= 2000 &&
      elapsed >= context.firstElapsedMs

    if (!valid) {
      invalidRecords += 1
      continue
    }

    points.push({
      record_index: recordIndex,
      observed_at: new Date(
        localStartUtcMs + (elapsed - context.firstElapsedMs)
      ).toISOString(),
      elapsed_ms: elapsed,
      lat,
      lon,
      depth_m: depth,
      water_temp_c: null,
      bottom_hardness: null,
      vegetation_height_m: null,
      vendor_channel_a: Number.isFinite(vendorA) ? vendorA : null,
      vendor_channel_b: Number.isFinite(vendorB) ? vendorB : null,
      sonar_source: 'humminbird-autochart-live',
      raw_attributes: {
        vendorChannelAValidated: false,
        vendorChannelBValidated: false,
      },
    })
  }

  return { points, invalidRecords }
}

export const humminbirdAcuImporter: SonarImporterPlugin = {
  id: 'humminbird-autochart-live-acu',
  version: '1.0.0',
  manufacturer: 'humminbird',
  extensions: ['.acu'],
  capability: 'points',
  probe: probeAcu,
  parseHeader: parseAcuHeader,
  parsePointChunk: parseAcuPointChunk,
}

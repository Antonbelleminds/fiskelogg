export type SonarManufacturer =
  | 'humminbird'
  | 'garmin'
  | 'lowrance'
  | 'raymarine'
  | 'generic'
  | 'unknown'

export type SonarPluginCapability = 'points' | 'metadata' | 'unsupported'

export interface SonarFileDescriptor {
  name: string
  relativePath: string
  size: number
}

export interface SonarProbeResult {
  confidence: number
  manufacturer: SonarManufacturer
  format: string
  model: string | null
  capability: SonarPluginCapability
  reason?: string
}

export interface SonarBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface SonarParsedHeader {
  format: string
  formatVersion: number
  manufacturer: SonarManufacturer
  model: string | null
  recordSize: number
  recordCount: number
  headerSize: number
  deviceLocalStartedAtEpochSeconds: number
  bounds: SonarBounds
  raw: Record<string, string | number | boolean | null>
}

export interface SonarPoint {
  record_index: number
  observed_at: string
  elapsed_ms: number
  lat: number
  lon: number
  depth_m: number
  water_temp_c: number | null
  bottom_hardness: number | null
  vegetation_height_m: number | null
  vendor_channel_a: number | null
  vendor_channel_b: number | null
  sonar_source: string
  raw_attributes: Record<string, string | number | boolean | null>
}

export interface ParsedPointChunk {
  points: SonarPoint[]
  invalidRecords: number
}

export interface PointChunkContext {
  firstElapsedMs: number
  firstRecordIndex: number
  deviceTimezone: string
  header: SonarParsedHeader
}

export interface SonarImporterPlugin {
  id: string
  version: string
  manufacturer: SonarManufacturer
  extensions: readonly string[]
  capability: SonarPluginCapability
  probe(
    descriptor: SonarFileDescriptor,
    prefix: Uint8Array
  ): SonarProbeResult | null
  parseHeader?(
    descriptor: SonarFileDescriptor,
    prefix: Uint8Array
  ): SonarParsedHeader
  parsePointChunk?(
    bytes: Uint8Array,
    context: PointChunkContext
  ): ParsedPointChunk
}

export interface RegisteredSonarFormat {
  extension: string
  manufacturer: SonarManufacturer
  format: string
  pluginId: string | null
  implemented: boolean
}

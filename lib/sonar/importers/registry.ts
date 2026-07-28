import { humminbirdAcuImporter } from '@/lib/sonar/importers/humminbird-acu'
import {
  type RegisteredSonarFormat,
  type SonarFileDescriptor,
  type SonarImporterPlugin,
  type SonarManufacturer,
  type SonarProbeResult,
} from '@/lib/sonar/types'

const metadataOnlyPlugins: SonarImporterPlugin[] = [
  {
    id: 'humminbird-autochart-index-aic',
    version: '1.0.0',
    manufacturer: 'humminbird',
    extensions: ['.aic'],
    capability: 'metadata',
    probe(descriptor): SonarProbeResult | null {
      if (!descriptor.name.toLowerCase().endsWith('.aic')) return null
      return {
        confidence: descriptor.name.toLowerCase() === 'index.aic' ? 0.95 : 0.75,
        manufacturer: 'humminbird',
        format: 'humminbird-autochart-index-aic',
        model: null,
        capability: 'metadata',
      }
    },
  },
]

export const sonarImporterPlugins: readonly SonarImporterPlugin[] = [
  humminbirdAcuImporter,
  ...metadataOnlyPlugins,
]

const plannedFormats: RegisteredSonarFormat[] = [
  { extension: '.acd', manufacturer: 'humminbird', format: 'autochart-pc', pluginId: null, implemented: false },
  { extension: '.ht', manufacturer: 'humminbird', format: 'humminbird-track', pluginId: null, implemented: false },
  { extension: '.son', manufacturer: 'humminbird', format: 'humminbird-sonar', pluginId: null, implemented: false },
  { extension: '.dat', manufacturer: 'humminbird', format: 'humminbird-recording-index', pluginId: null, implemented: false },
  { extension: '.adm', manufacturer: 'humminbird', format: 'humminbird-navigation', pluginId: null, implemented: false },
  { extension: '.gpx', manufacturer: 'generic', format: 'gps-exchange', pluginId: null, implemented: false },
  { extension: '.fit', manufacturer: 'garmin', format: 'garmin-fit', pluginId: null, implemented: false },
  { extension: '.sl2', manufacturer: 'lowrance', format: 'lowrance-sl2', pluginId: null, implemented: false },
  { extension: '.sl3', manufacturer: 'lowrance', format: 'lowrance-sl3', pluginId: null, implemented: false },
  { extension: '.usr', manufacturer: 'lowrance', format: 'lowrance-usr', pluginId: null, implemented: false },
  { extension: '.sdf', manufacturer: 'raymarine', format: 'raymarine-sdf', pluginId: null, implemented: false },
  { extension: '.bin', manufacturer: 'unknown', format: 'vendor-binary', pluginId: null, implemented: false },
  { extension: '.log', manufacturer: 'generic', format: 'nmea-log', pluginId: null, implemented: false },
]

export const registeredSonarFormats: readonly RegisteredSonarFormat[] = [
  ...sonarImporterPlugins.flatMap((plugin) =>
    plugin.extensions.map((extension) => ({
      extension,
      manufacturer: plugin.manufacturer,
      format: plugin.id,
      pluginId: plugin.id,
      implemented: true,
    }))
  ),
  ...plannedFormats,
]

export const acceptedSonarExtensions = new Set(
  registeredSonarFormats.map((format) => format.extension)
)

export function extensionOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function formatForExtension(name: string) {
  const extension = extensionOf(name)
  return registeredSonarFormats.find((format) => format.extension === extension)
}

export function detectSonarImporter(
  descriptor: SonarFileDescriptor,
  prefix: Uint8Array
) {
  const candidates = sonarImporterPlugins
    .map((plugin) => ({ plugin, probe: plugin.probe(descriptor, prefix) }))
    .filter(
      (
        candidate
      ): candidate is { plugin: SonarImporterPlugin; probe: SonarProbeResult } =>
        candidate.probe !== null
    )
    .sort((left, right) => right.probe.confidence - left.probe.confidence)

  return candidates[0] ?? null
}

export function displayManufacturer(manufacturer: SonarManufacturer) {
  const names: Record<SonarManufacturer, string> = {
    humminbird: 'Humminbird',
    garmin: 'Garmin',
    lowrance: 'Lowrance',
    raymarine: 'Raymarine',
    generic: 'Generiskt',
    unknown: 'Okänd',
  }
  return names[manufacturer]
}

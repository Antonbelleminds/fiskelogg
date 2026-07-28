'use client'

import {
  AsyncUnzipInflate,
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
} from 'fflate'
import { createSHA256 } from 'hash-wasm'
import { acceptedSonarExtensions, extensionOf } from '@/lib/sonar/importers/registry'

const ZIP_INPUT_CHUNK = 2 * 1024 * 1024
const MAX_ZIP_SIZE = 512 * 1024 * 1024
const MAX_ZIP_ENTRY_SIZE = 512 * 1024 * 1024
const MAX_ZIP_EXPANDED_SIZE = 1024 * 1024 * 1024
const HASH_CHUNK_SIZE = 6 * 1024 * 1024

export interface SelectedSonarFile {
  file: File
  relativePath: string
}

export interface PreparedSonarSelection {
  files: SelectedSonarFile[]
  sourceKind: 'files' | 'folder' | 'zip' | 'sd_card'
  ignoredFiles: number
}

/**
 * Humminbird's LkMaster directory contains AutoChart basemap assets, not
 * recordings from the sonar. They can be very large and use the otherwise
 * ambiguous .bin extension, so exclude them by path before format detection.
 */
export function isKnownSdSystemFile(path: string) {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  return (
    normalized.split('/').includes('lkmaster') &&
    extensionOf(normalized) === '.bin'
  )
}

async function extractSonarZip(zipFile: File) {
  if (zipFile.size > MAX_ZIP_SIZE) {
    throw new Error(
      'ZIP-filer över 512 MB stöds inte i webbläsaren. Välj SD-kortets mapp direkt i stället.'
    )
  }

  return new Promise<SelectedSonarFile[]>(async (resolve, reject) => {
    const extracted: SelectedSonarFile[] = []
    let expandedBytes = 0
    let pendingFiles = 0
    let inputFinished = false
    let settled = false

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error('Kunde inte läsa ZIP-filen'))
    }
    const maybeFinish = () => {
      if (!settled && inputFinished && pendingFiles === 0) {
        settled = true
        resolve(extracted)
      }
    }

    const unzipper = new Unzip((entry) => {
      if (
        entry.name.endsWith('/') ||
        isKnownSdSystemFile(entry.name) ||
        !acceptedSonarExtensions.has(extensionOf(entry.name))
      ) {
        return
      }
      if (
        entry.originalSize !== undefined &&
        entry.originalSize > MAX_ZIP_ENTRY_SIZE
      ) {
        fail(new Error(`ZIP-posten ${entry.name} är större än säkerhetsgränsen.`))
        return
      }

      pendingFiles += 1
      const chunks: Uint8Array[] = []
      let entryBytes = 0

      entry.ondata = (error, data, final) => {
        if (error) {
          fail(error)
          return
        }
        entryBytes += data.byteLength
        expandedBytes += data.byteLength
        if (
          entryBytes > MAX_ZIP_ENTRY_SIZE ||
          expandedBytes > MAX_ZIP_EXPANDED_SIZE
        ) {
          entry.terminate()
          fail(new Error('ZIP-filen expanderar över säkerhetsgränsen.'))
          return
        }
        chunks.push(data)
        if (final) {
          const name = entry.name.split('/').pop() || 'sonar-file'
          extracted.push({
            file: new File(chunks as BlobPart[], name, {
              type: 'application/octet-stream',
              lastModified: zipFile.lastModified,
            }),
            relativePath: entry.name,
          })
          pendingFiles -= 1
          maybeFinish()
        }
      }

      try {
        entry.start()
      } catch (error) {
        pendingFiles -= 1
        fail(error)
      }
    })

    unzipper.register(UnzipPassThrough)
    unzipper.register(UnzipInflate)
    unzipper.register(AsyncUnzipInflate)

    try {
      for (let offset = 0; offset < zipFile.size; offset += ZIP_INPUT_CHUNK) {
        if (settled) return
        const end = Math.min(offset + ZIP_INPUT_CHUNK, zipFile.size)
        const bytes = new Uint8Array(
          await zipFile.slice(offset, end).arrayBuffer()
        )
        unzipper.push(bytes, end === zipFile.size)
      }
      inputFinished = true
      maybeFinish()
    } catch (error) {
      fail(error)
    }
  })
}

export async function prepareSonarSelection(inputFiles: File[]) {
  const selected: SelectedSonarFile[] = []
  let ignoredFiles = 0
  let containedZip = false

  for (const file of inputFiles) {
    if (extensionOf(file.name) === '.zip') {
      containedZip = true
      selected.push(...(await extractSonarZip(file)))
      continue
    }

    const relativePath = file.webkitRelativePath || file.name
    if (isKnownSdSystemFile(relativePath)) {
      ignoredFiles += 1
      continue
    }

    if (!acceptedSonarExtensions.has(extensionOf(file.name))) {
      ignoredFiles += 1
      continue
    }

    selected.push({
      file,
      relativePath,
    })
  }

  const unique = Array.from(
    new Map(
      selected.map((entry) => [
        `${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`,
        entry,
      ])
    ).values()
  )

  const hasFolderPaths = unique.some((entry) => entry.relativePath.includes('/'))
  const pathSegments = new Set(
    unique.flatMap((entry) =>
      entry.relativePath
        .split('/')
        .map((segment) => segment.toLowerCase())
        .filter(Boolean)
    )
  )
  const looksLikeSdCard =
    pathSegments.has('acdata') ||
    pathSegments.has('record') ||
    pathSegments.has('garmin') ||
    pathSegments.has('lowrance')

  return {
    files: unique,
    sourceKind: containedZip
      ? 'zip'
      : looksLikeSdCard
        ? 'sd_card'
        : hasFolderPaths
          ? 'folder'
          : 'files',
    ignoredFiles,
  } satisfies PreparedSonarSelection
}

export async function hashSonarFile(
  file: File,
  onProgress?: (processed: number, total: number) => void
) {
  const hasher = await createSHA256()
  hasher.init()

  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_SIZE) {
    const end = Math.min(offset + HASH_CHUNK_SIZE, file.size)
    hasher.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()))
    onProgress?.(end, file.size)
  }

  return hasher.digest('hex')
}

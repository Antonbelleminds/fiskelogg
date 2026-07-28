import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import test from 'node:test'
import {
  isKnownSdSystemFile,
  prepareSonarSelection,
} from '../../lib/sonar/client-files'

function sdFile(path: string, bytes = 64) {
  const name = path.split('/').at(-1) ?? path
  const file = new File([new Uint8Array(bytes)], name, {
    type: 'application/octet-stream',
    lastModified: 1,
  })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file as unknown as globalThis.File
}

test('Humminbird LkMaster BIN files are treated as chart assets', () => {
  assert.equal(isKnownSdSystemFile('ACEU1/LkMaster/ac10240A.bin'), true)
  assert.equal(isKnownSdSystemFile('ACEU1/RECORD/session.bin'), false)
})

test('whole Humminbird SD selection keeps ACDATA and ignores LkMaster', async () => {
  const selection = await prepareSonarSelection([
    sdFile('ACEU1/ACDATA/26053000.ACU', 1_024),
    sdFile('ACEU1/ACDATA/INDEX.AIC', 128),
    sdFile('ACEU1/LkMaster/ac10240A.bin', 2_048),
    sdFile('ACEU1/PROFILE.TXT', 32),
  ])

  assert.deepEqual(
    selection.files.map((entry) => entry.relativePath),
    ['ACEU1/ACDATA/26053000.ACU', 'ACEU1/ACDATA/INDEX.AIC']
  )
  assert.equal(selection.sourceKind, 'sd_card')
  assert.equal(selection.ignoredFiles, 2)
})

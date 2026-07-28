'use client'

import * as tus from 'tus-js-client'
import { createClient } from '@/lib/supabase/client'

interface UploadSonarFileOptions {
  bucket: string
  storagePath: string
  file: File
  onProgress?: (uploaded: number, total: number) => void
}

export async function uploadSonarFile({
  bucket,
  storagePath,
  file,
  onProgress,
}: UploadSonarFileOptions) {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) throw new Error('Din inloggning har löpt ut.')

  const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
  const projectRef = projectUrl.hostname.split('.')[0]
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      fingerprint: async () =>
        [
          'fiskeloggboken-sonar-v1',
          projectRef,
          bucket,
          storagePath,
          file.size,
          file.lastModified,
        ].join(':'),
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: bucket,
        objectName: storagePath,
        contentType: file.type || 'application/octet-stream',
        cacheControl: '0',
      },
      onError(error) {
        reject(error)
      },
      onProgress(bytesUploaded, bytesTotal) {
        onProgress?.(bytesUploaded, bytesTotal)
      },
      onSuccess() {
        resolve()
      },
    })

    upload
      .findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0])
        }
        upload.start()
      })
      .catch(reject)
  })
}

import type { DevelopmentText, Reading } from './reading'
import type { fallbackAssets } from '../assets/fallbacks'
import type { CloudProvenance, ImageResponse } from '../../shared/generation'

export interface Interpretation {
  title: string
  keywords: string[]
  description: string
  displayTextOrigin: 'cloud'
  finalImagePrompt: string
  recipeSnapshot: unknown
  sceneInputSnapshot: unknown
  scenePrompt: string
  generationConfigSnapshot: unknown
  model?: string
  promptVersion?: string
  completedAt: string
  cloud?: CloudProvenance
}
export interface FallbackPresentation {
  origin: 'preset_fallback'
  resourceKey: keyof typeof fallbackAssets
}
export interface Perfume {
  id: string
  name: string
  brand?: string
  notes?: string
  coverGenerationId?: string
  initialCoverPending: boolean
  createdAt: string
  updatedAt: string
}
export interface ImageAsset {
  id: string
  storageKind: 'data'
  relativePath: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteSize: number
  sha256: string
  origin: 'cloud' | 'development_fixture'
  createdAt: string
}
export interface Generation {
  id: string
  readingId: string
  version: number
  attemptId: string
  status: 'saved'
  imageAssetId: string
  imageOrigin: ImageAsset['origin']
  textSnapshot: DevelopmentText | Interpretation
  modelRequested?: string
  modelActual?: string
  cloudImage?: Omit<ImageResponse, 'imageBase64'>
  createdAt: string
}
export interface LibraryMeta {
  id: 'library'
  schemaVersion: 2
  namespace: string
  installationId: string
  revision: number
  commitId: string
  explicitlyCleared: boolean
  retiredReadingIds: string[]
  retiredSessionIds: string[]
  retiredGenerationIds: string[]
}
export interface LibrarySnapshot {
  meta: LibraryMeta
  readings: Reading[]
  perfumes: Perfume[]
  generations: Generation[]
  assets: ImageAsset[]
}
export interface ArtworkSubmission {
  generationId: string
  assetId: string
  readingId: string
  attemptId: string
  origin: ImageAsset['origin']
  text: Generation['textSnapshot']
  modelRequested?: string
  modelActual?: string
  cloudImage?: Omit<ImageResponse, 'imageBase64'>
  // Received bytes, never a remote URL in a permanent index. Reuse on save retry.
  blob: Blob
  canCommit: () => boolean
}
export class StorageFailure extends Error {
  constructor(public readonly stage: 'file' | 'database' | 'barrier' | 'recovery', message: string) { super(message) }
}

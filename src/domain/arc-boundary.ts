/**
 * Arc / volume boundary facts. Mirrors ainovel-cli `store.ArcBoundary`
 * without any store IO — Route receives this as an already-loaded fact.
 */
export interface ArcBoundary {
  isArcEnd: boolean;
  isVolumeEnd: boolean;
  volume: number;
  arc: number;
  startChapter: number;
  endChapter: number;
  nextVolume: number;
  nextArc: number;
  needsExpansion: boolean;
  /** Volume end and layered outline has no next volume. */
  needsNewVolume: boolean;
}

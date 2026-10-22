import type { SaveMeta, SaveSlot } from '../save';

export { CampaignUi } from './campaignUi';
export type { CampaignUiOptions } from './campaignUi';
export { MapView, patchName } from './mapView';
export { FloorLayer, FootstepLayer } from './layers';

/** The most recently written slot holding a campaign, if any (`metas` newest first). */
export function latestCampaignSlot(metas: readonly SaveMeta[]): SaveSlot | null {
  return metas.find((m) => m.info.campaign)?.slot ?? null;
}

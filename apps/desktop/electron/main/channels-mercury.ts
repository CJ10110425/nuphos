import * as atlas from '../atlas'

export const mercuryChannels = {
  'atlas:listMercuryIntegrations': (_e: unknown, teamId: string) =>
    atlas.listMercuryIntegrations(teamId),
  'atlas:bindMercuryIntegration': (
    _e: unknown,
    teamId: string,
    label: string,
    apiToken: string,
    share?: atlas.BindingShare,
  ) => atlas.bindMercuryIntegration(teamId, label, apiToken, share),
  'atlas:unbindMercuryIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindMercuryIntegration(teamId, integrationId),
} as const

import type { BindingShare } from '../lib/bindingShare.ts'

export const mercuryApi = {
  atlasListMercuryIntegrations: (teamId: string) => window.api.atlasListMercuryIntegrations(teamId),
  atlasBindMercuryIntegration: (
    teamId: string,
    label: string,
    apiToken: string,
    share?: BindingShare,
  ) => window.api.atlasBindMercuryIntegration(teamId, label, apiToken, share),
  atlasUnbindMercuryIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindMercuryIntegration(teamId, integrationId),
}

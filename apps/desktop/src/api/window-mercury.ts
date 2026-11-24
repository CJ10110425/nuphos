import type { BindingShare } from '../lib/bindingShare.ts'
import type { MercuryIntegration } from '../types/mercury.ts'

export type WindowMercuryApi = {
  atlasListMercuryIntegrations(teamId: string): Promise<MercuryIntegration[]>
  atlasBindMercuryIntegration(
    teamId: string,
    label: string,
    apiToken: string,
    share?: BindingShare,
  ): Promise<MercuryIntegration>
  atlasUnbindMercuryIntegration(teamId: string, integrationId: string): Promise<void>
}

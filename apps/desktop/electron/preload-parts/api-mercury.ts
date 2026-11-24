import { ipcRenderer } from 'electron'

export const mercuryApi = {
  atlasListMercuryIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listMercuryIntegrations', teamId),
  atlasBindMercuryIntegration: (teamId: string, label: string, apiToken: string, share?: unknown) =>
    ipcRenderer.invoke('atlas:bindMercuryIntegration', teamId, label, apiToken, share),
  atlasUnbindMercuryIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindMercuryIntegration', teamId, integrationId),
}

import { api } from '../../api'
import { t } from '../../i18n/index.ts'

export async function loadMercuryInfo(teamId: string, connectorId: string) {
  const item = (await api.atlasListMercuryIntegrations(teamId)).find((i) => i.id === connectorId)

  if (!item) return null

  return {
    name: item.label,
    fields: [
      { label: t('Label'), value: item.label },
      { label: t('Access'), value: t('Read-only') },
      ...(item.createdAt
        ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
        : []),
      { label: t('Connector ID'), value: item.id, mono: true },
    ],
    externalUrl: 'https://app.mercury.com',
    externalLabel: t('Open {name}', { name: 'Mercury' }),
  }
}

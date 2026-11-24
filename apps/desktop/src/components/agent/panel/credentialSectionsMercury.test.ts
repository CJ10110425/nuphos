import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { EMPTY_CREDENTIAL_OPTIONS } from './constants.ts'
import {
  allCredentialAccess,
  credentialSelectionSignature,
  defaultCredentialAccess,
  normalizeCredentialAccess,
} from './credentialAccess.ts'
import { buildMercuryCredentialSections } from './credentialSectionsB.ts'
import { countTotalCredentials } from './credentialSelectorButtonCounts.ts'
import { CONNECT_SELECTION_KEY, parseConnectRequest } from './connectCardModel.ts'

import type { AgentCredentialOptions } from '../../../api'

const options: AgentCredentialOptions = {
  ...EMPTY_CREDENTIAL_OPTIONS,
  mercuryIntegrations: [{ integrationId: 'm1', label: 'Ops banking' }],
}

describe('Mercury credentials', () => {
  test('lists each integration as a read-only row', () => {
    const [section] = buildMercuryCredentialSections(options.mercuryIntegrations)

    assert.equal(section.provider, 'mercury')
    assert.equal(section.title, 'Mercury')
    assert.deepEqual(section.items, [{ id: 'm1', label: 'Ops banking', sublabel: 'Read-only' }])
    assert.deepEqual(buildMercuryCredentialSections([]), [])
  })

  test('Select all includes Mercury, but a new conversation starts without it', () => {
    assert.deepEqual(allCredentialAccess(options).mercuryIntegrationIds, ['m1'])
    assert.equal(countTotalCredentials(options), 1)
    assert.deepEqual(defaultCredentialAccess(options).mercuryIntegrationIds, [])
  })

  test('a stored selection from before Mercury normalizes to none', () => {
    const value = normalizeCredentialAccess({ awsRoleIds: ['role'] })

    assert.deepEqual(value.mercuryIntegrationIds, [])
    assert.notEqual(
      credentialSelectionSignature(value),
      credentialSelectionSignature({ ...value, mercuryIntegrationIds: ['m1'] }),
    )
  })

  test('an integration decision can ask for Mercury', () => {
    assert.equal(CONNECT_SELECTION_KEY.mercury, 'mercuryIntegrationIds')
    assert.deepEqual(
      parseConnectRequest({ category: 'integration', question: 'why', providers: ['mercury'] }),
      { providers: ['mercury'], reason: 'why', personal: false },
    )
  })
})

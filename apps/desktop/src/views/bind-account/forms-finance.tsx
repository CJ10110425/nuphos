import { t } from '../../i18n'

import { ConsoleLink, Field, Fill } from './shared'

import type { BindState } from './use-bind-state'

const INPUT_CLASS =
  'w-full h-9 px-2.5 rounded-md bg-surface-sunken border border-line-control focus:border-line-focus outline-none text-[12.5px] font-mono placeholder:text-tertiary text-main'

export function MercuryForm({ st }: { st: BindState }) {
  const { mercuryLabel, setMercuryLabel, mercuryApiToken, setMercuryApiToken } = st

  return (
    <>
      <div className="mb-1 rounded-md border border-line-control bg-state-selected px-3 py-2.5">
        <div className="text-[12px] font-medium text-main mb-1.5">
          {t('How to get your Mercury API token')}
        </div>
        <ol className="text-[12px] text-secondary leading-relaxed space-y-1 list-decimal list-inside marker:text-tertiary">
          <li>
            <Fill
              text={t('In Mercury, open {page}.')}
              page={<span className="text-main">Settings → API Tokens</span>}
            />
          </li>
          <li>
            <Fill
              text={t(
                'Create a {access} token. Nuphos only reads accounts, cards and transactions.',
              )}
              access={<span className="text-main">Read Only</span>}
            />
          </li>
          <li>
            <Fill
              text={t('Copy the token. It starts with {prefix}; you can paste it with or without.')}
              prefix={<span className="font-mono">secret-token:</span>}
            />
          </li>
        </ol>
        <div className="mt-2.5">
          <ConsoleLink href="https://app.mercury.com">
            {t('Open {name}', { name: 'Mercury' })}
          </ConsoleLink>
        </div>
      </div>
      <Field label={t('Label')} hint={t('A friendly name to identify this Mercury account.')}>
        <input
          type="text"
          value={mercuryLabel}
          onChange={(e) => setMercuryLabel(e.target.value)}
          placeholder="Acme Mercury"
          maxLength={100}
          className={INPUT_CLASS}
        />
      </Field>
      <Field
        label={t('API token')}
        hint={t(
          'A Read Only token. Encrypted before storage. Off in new tasks until you turn this account on for them.',
        )}
      >
        <input
          type="password"
          value={mercuryApiToken}
          onChange={(e) => setMercuryApiToken(e.target.value)}
          placeholder="secret-token:…"
          className={INPUT_CLASS}
        />
      </Field>
    </>
  )
}

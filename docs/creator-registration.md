# Creator registration before publication

When v2 native creator routes are enabled, a new fanpage must have a finalized
registry registration and a matching `fan_action_verified_creators` record before
it becomes public. Keep the fanpage in draft while preparing its content. Existing
published fanpages can still be edited or unpublished.

The existing operational CLI now accepts `--creator` as well as `--campaign`.
It checks the active binding, fixed GIWA chain/Hub/Registry, registrar, source ID
and slug. Signing uses the existing administrator keychain; no application or
worker receives new signing permissions. Creator routes 1, 6, 8 and 10 must be
enabled on the same supported binding.

1. Create the draft fanpage and finish its public identity and quiz content.
2. Prepare and inspect the exact registration manifest:

   ```sh
   node scripts/register-giwa-campaign.mjs prepare \
     --creator CREATOR_UUID --env-file ENV_FILE --db-url-file DB_URL_FILE \
     --manifest PRIVATE_MANIFEST_FILE
   ```

3. Execute the reviewed manifest with its returned hash:

   ```sh
   node scripts/register-giwa-campaign.mjs execute \
     --env-file ENV_FILE --db-url-file DB_URL_FILE \
     --manifest PRIVATE_MANIFEST_FILE --approved-hash MANIFEST_HASH
   ```

4. Once the registration transaction is finalized, run the same command with
   `finalize` instead of `execute`. This verifies the original transaction,
   exact `CreatorRegistered` event, canonical block and finalized registry state
   before recording the proof. A finality-pending response does not admit the
   fanpage yet; retain the manifest and journal and retry `finalize` later.
5. Publish through the existing admin publication action or rerun the onboarding
   script. Check a real quiz submission with an authorized QA account.

The database URL file must not contain the password; the CLI reads the password
from the explicit local environment file. Keep manifests, receipts and signed
journals private. Creator journals and the signing lock use the repository's
common Git directory. Existing campaign journals retain their original paths.

If an earlier creator registration already exists, provide its exact hash using
`--registration-transaction TRANSACTION_HASH` when preparing and finalizing the
manifest. The CLI verifies its source, event and finality; it does not create a
replacement transaction. An existing signed journal always takes precedence and
must match this hash. Do not delete a journal or repeat preparation to recover an
uncertain broadcast.

The slug is immutable once a database registration proof exists. A source change
while a chain transaction is pending stops proof admission; review the changed
source before continuing. Never insert a verification record without checking
the actual finalized chain evidence.

Validation: `node --test scripts/register-giwa-campaign.test.mjs` and
`npm run security:backend-db` (includes creator publication boundaries).

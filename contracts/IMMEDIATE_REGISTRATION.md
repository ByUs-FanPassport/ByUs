# Immediate public context registration

Registry V3 lets its registrar register a creator or LIVE campaign directly.
The registrar cannot change ownership, reactivate an existing ID, replace the
registrar, or upgrade the ActionHub. Those governance powers remain with the
existing 48-hour Timelock. Initial registration does not schedule a Timelock call.

GIWA Sepolia (chain 91342):

| Component | Address |
| --- | --- |
| Current registry V3 | `0x4e104e5dfb3d466a2aac9ed0cf7572578068529b` |
| New ActionHub | `0xbd9991a26d0a0bf744ecdb8ad4f59f60a9132956` |
| Previous ActionHub, retained for history/corrections | `0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d` |
| Registrar (Byus_Admin) | `0xeee82f960476c888950c798c444c1fd92cbbfe50` |

Both Hubs use the same Passport and Stamp contracts. A contract transition does
not mint replacement NFTs or rewrite previously submitted actions. Public KPI
reads both Hubs through the same finalized block, including later corrections
on the previous Hub.

## Register another published LIVE

`scripts/register-giwa-campaign.mjs` handles one published LIVE whose creator is
already registered and verified in the current production binding. It reads the
LIVE ID, creator ID and public slug from the production database. It never
creates a reservation, attendance, mission, survey response or fan transaction.

Run from the repository root with the existing local environment and pooler URL
files. The explicit paths prevent choosing a different deployment implicitly.

```sh
node scripts/register-giwa-campaign.mjs prepare \
  --campaign <LIVE_UUID> \
  --env-file <LOCAL_SUPABASE_ENV_FILE> \
  --db-url-file <PRODUCTION_POOLER_URL_FILE> \
  --manifest work/live-registration.json
```

Review the generated manifest and copy its public `hash`. `execute` accepts only
that hash and the unchanged published LIVE/creator/slug and current binding.

```sh
node scripts/register-giwa-campaign.mjs execute \
  --env-file <LOCAL_SUPABASE_ENV_FILE> \
  --db-url-file <PRODUCTION_POOLER_URL_FILE> \
  --manifest work/live-registration.json \
  --approved-hash <MANIFEST_HASH>
```

Signing uses the existing local macOS Keychain helper for Byus_Admin; no key is
accepted in a command argument or printed. The signed envelope is journaled in
Git metadata with owner-only permissions. Re-run the same command after an RPC
interruption: it checks the existing transaction and does not issue a second
registration. Do not delete the journal to retry.

After the chain finalizes the registration, admit its verified proof:

```sh
node scripts/register-giwa-campaign.mjs finalize \
  --env-file <LOCAL_SUPABASE_ENV_FILE> \
  --db-url-file <PRODUCTION_POOLER_URL_FILE> \
  --manifest work/live-registration.json \
  --approved-hash <MANIFEST_HASH>
```

If finality has not reached the transaction, this reports the required block and
makes no database change. This is chain confirmation, not a 48-hour governance
wait. Once finalized, the command verifies the canonical successful transaction
and campaign ownership, then inserts the internal campaign proof atomically.
Normal eligible LIVE actions can then use the native action path. Existing
service conditions, such as attendance opening times, still apply.

An unverified LIVE stays on the existing service fallback until its proof is
admitted. This CLI does not backfill actions performed before activation.
A new creator must first be registered by the registrar and receive a finalized
creator proof; this one-LIVE CLI deliberately does not grant roles or register
an unknown creator as a side effect.

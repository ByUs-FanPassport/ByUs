#!/usr/bin/env node
// Operational CLI: prepare an exact creator or published LIVE registration, sign it once,
// then separately admit its canonical finalized proof to the native producer gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, encodeFunctionData, parseAbi, parseEventLogs, keccak256, stringToHex, toHex, parseTransaction, recoverTransactionAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readEnvironmentFile } from './local-production-env.mjs';
import { confirmedKyaaReceipt } from './migrate-kyaa-giwa.mjs';

export const CAMPAIGN_DEPLOYMENT = Object.freeze({ chainId: 91342, hub: '0xbd9991a26d0a0bf744ecdb8ad4f59f60a9132956', registry: '0x4e104e5dfb3d466a2aac9ed0cf7572578068529b', binding: '5f45d72b-8d14-4cdb-906e-248ffb036206', admin: '0xeee82f960476c888950c798c444c1fd92cbbfe50', registryRuntime: '0x094b3a4a3af412568b9d3f004fd8f9e09e8dca8249398f50b9f25308a034d53b' });
const abi = parseAbi(['function registerCreator(bytes32 creatorId,string publicSlug)', 'function registerCampaign(bytes32 campaignId,bytes32 creatorId,string publicSlug)', 'function isValidContext(bytes32 creatorId,bytes32 campaignId) view returns (bool)', 'function registrar() view returns(address)', 'event CreatorRegistered(bytes32 indexed creatorId,string publicSlug)', 'event CampaignRegistered(bytes32 indexed campaignId,bytes32 indexed creatorId,string publicSlug)']);
const zero = '0x' + '00'.repeat(32);
const assert = (ok, reason) => { if (!ok) throw Error(reason); };
const uuid = (s) => { assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s), 'INVALID_UUID'); return '0x' + s.replaceAll('-', '').padStart(64, '0'); };
const json = (v) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? String(x) : x, 2);
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export const KYAA_BINDING_ID = 'f03415d0-3235-4bd7-bee5-a8a9c36c163a';
export function prepareCampaignRegistration(row, binding = CAMPAIGN_DEPLOYMENT.binding) {
  assert([CAMPAIGN_DEPLOYMENT.binding, KYAA_BINDING_ID].includes(binding), 'UNKNOWN_CAMPAIGN_BINDING');
  assert(row && row.publication_status === 'published' && row.archived_at === null, 'PUBLISHED_LIVE_REQUIRED');
  assert(typeof row.slug === 'string' && /^[a-z0-9][a-z0-9-]{0,249}$/.test(row.slug), 'INVALID_PUBLIC_SLUG');
  const source = { id: row.id, celebrity_id: row.celebrity_id, slug: row.slug };
  const manifest = { format: 'byus-campaign-registration-v1', ...CAMPAIGN_DEPLOYMENT, binding, source, gas: '150000', maxFeePerGas: '100000000', value: '0', data: encodeFunctionData({ abi, functionName: 'registerCampaign', args: [uuid(row.id), uuid(row.celebrity_id), row.slug] }) };
  return { ...manifest, hash: keccak256(stringToHex(json(manifest))) };
}
export function validateCampaignRegistration(manifest, row, approvedHash) {
  assert(manifest.hash === approvedHash && JSON.stringify(manifest) === JSON.stringify(prepareCampaignRegistration(row, manifest.binding)), 'MANIFEST_OR_PUBLISHED_SOURCE_CHANGED');
  return manifest;
}
export function prepareCreatorRegistration(row, binding = KYAA_BINDING_ID) {
  assert([CAMPAIGN_DEPLOYMENT.binding, KYAA_BINDING_ID].includes(binding), 'UNKNOWN_CREATOR_BINDING');
  assert(row && ['draft', 'published'].includes(row.status) && row.archived_at === null, 'ACTIVE_CREATOR_REQUIRED');
  assert(typeof row.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) && row.slug.length <= 80, 'INVALID_PUBLIC_SLUG');
  const source = { id: row.id, slug: row.slug };
  const manifest = { format: 'byus-creator-registration-v1', ...CAMPAIGN_DEPLOYMENT, binding, source, gas: '150000', maxFeePerGas: '100000000', value: '0', data: encodeFunctionData({ abi, functionName: 'registerCreator', args: [uuid(row.id), row.slug] }) };
  return { ...manifest, hash: keccak256(stringToHex(json(manifest))) };
}
export function validateCreatorRegistration(manifest, row, approvedHash) {
  assert(manifest.hash === approvedHash && JSON.stringify(manifest) === JSON.stringify(prepareCreatorRegistration(row, manifest.binding)), 'MANIFEST_OR_CREATOR_SOURCE_CHANGED');
  return manifest;
}
export function assertRegistrationEnvelope(tx, manifest) {
  assert(tx.type === 'eip1559' && tx.chainId === manifest.chainId && tx.to?.toLowerCase() === manifest.registry && tx.data === manifest.data && (tx.value ?? 0n) === 0n && tx.gas === BigInt(manifest.gas) && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= BigInt(manifest.maxFeePerGas) && tx.maxPriorityFeePerGas >= 0n && tx.maxPriorityFeePerGas <= tx.maxFeePerGas, 'TRANSACTION_ENVELOPE_CHANGED');
}
export function assertRegistrationReceipt(receipt, transaction, manifest, expectedHash, canonicalHash) {
  assert(receipt.transactionHash === expectedHash && transaction.hash === expectedHash && receipt.status === 'success'
    && receipt.from.toLowerCase() === manifest.admin && transaction.from.toLowerCase() === manifest.admin
    && receipt.to?.toLowerCase() === manifest.registry && receipt.blockHash === canonicalHash
    && transaction.blockHash === receipt.blockHash && transaction.blockNumber === receipt.blockNumber, 'CANONICAL_REGISTRATION_REQUIRED');
  assertRegistrationEnvelope({ ...transaction, data: transaction.input }, manifest);
  const creator = manifest.format === 'byus-creator-registration-v1';
  const events = parseEventLogs({ abi, eventName: creator ? 'CreatorRegistered' : 'CampaignRegistered',
    logs: receipt.logs.filter(log => log.address.toLowerCase() === manifest.registry), strict: true });
  assert(events.length === 1 && events[0].args.creatorId === uuid(creator ? manifest.source.id : manifest.source.celebrity_id)
    && events[0].args.publicSlug === manifest.source.slug
    && (creator || events[0].args.campaignId === uuid(manifest.source.id)), 'REGISTRATION_EVENT_MISMATCH');
}
async function main() {
  const args = process.argv.slice(2);
  const option = (key) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  const mode = args[0];
  assert(['prepare', 'execute', 'finalize'].includes(mode), 'USAGE: prepare|execute|finalize --env-file PATH --db-url-file PATH --manifest PATH [--campaign UUID|--creator UUID] [--approved-hash HASH] [--registration-transaction HASH]');
  const envFile = option('--env-file'), dbFile = option('--db-url-file'), manifestPath = option('--manifest');
  assert(envFile && dbFile && manifestPath, 'EXPLICIT_LOCAL_ENV_DB_AND_MANIFEST_REQUIRED');
  const env = await readEnvironmentFile(envFile);
  const dbUrl = fs.readFileSync(dbFile, 'utf8').trim();
  assert(env.SUPABASE_PROD_DB_PASSWORD && dbUrl.includes('gmrykvmtmuaeswpajteq'), 'PRODUCTION_DB_IDENTITY_REQUIRED');
  const sql = (query, write = false) => execFileSync('psql', [dbUrl, '-XqAt', '-v', 'ON_ERROR_STOP=1', '-c', write ? query : `begin read only;${query};commit;`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: env.SUPABASE_PROD_DB_PASSWORD, PGSSLMODE: 'require', PGOPTIONS: '-c statement_timeout=30000' } }).trim();
  const savedManifest = mode === 'prepare' ? null : JSON.parse(fs.readFileSync(manifestPath));
  const creator = mode === 'prepare' ? !!option('--creator') : savedManifest.format === 'byus-creator-registration-v1';
  assert(!(option('--creator') && option('--campaign')), 'ONE_REGISTRATION_SOURCE_REQUIRED');
  const campaign = mode === 'prepare' ? option(creator ? '--creator' : '--campaign') : savedManifest.source.id;
  uuid(campaign);
  const row = JSON.parse(sql(creator
    ? `select row_to_json(x) from(select id,slug,status,archived_at from public.celebrities where id=${quote(campaign)})x`
    : `select row_to_json(x) from(select id,celebrity_id,slug,publication_status,archived_at from public.live_events where id=${quote(campaign)})x`));
  // shortcut: creator routes share one binding; revisit this gate for a split rollout.
  const actions = creator ? '1,6,8,10' : '2,3,4,5';
  const activeBinding = mode === 'prepare' ? sql(`select min(binding_id::text) from public.fan_action_producer_routes where action_code in(${actions}) and enabled having count(*)=4 and count(distinct binding_id)=1`) : null;
  const manifest = mode === 'prepare'
    ? (creator ? prepareCreatorRegistration : prepareCampaignRegistration)(row, activeBinding)
    : (creator ? validateCreatorRegistration : validateCampaignRegistration)(savedManifest, row, option('--approved-hash'));
  const creatorId = creator ? row.id : row.celebrity_id;
  const binding = JSON.parse(sql(`select row_to_json(x) from(select b.id,b.hub_proxy,b.chain_id,exists(select 1 from public.fan_action_verified_creators v where v.binding_id=b.id and v.creator_id=${quote(creatorId)}) as creator_verified from public.fan_action_bindings b where b.id=${quote(manifest.binding)})x`));
  assert(binding?.hub_proxy === manifest.hub && binding.chain_id === manifest.chainId && (creator || binding.creator_verified), 'ACTIVE_BINDING_VERIFIED_CREATOR_REQUIRED');
  assert(sql(`select count(*) from public.fan_action_producer_routes where action_code in(${actions}) and enabled and binding_id=${quote(manifest.binding)}`) === '4', 'PRODUCER_ROUTES_CHANGED');
  const c = createPublicClient({ transport: http('https://sepolia-rpc.giwa.io', { timeout: 15000, retryCount: 1 }) });
  assert(await c.getChainId() === manifest.chainId, 'WRONG_CHAIN');
  const slot = toHex(0x9b4561162b6d58cdaee430aa4073a2ec544ff4ca21320ef4e942bd0b419f7700n + 7n, { size: 32 });
  const verifyDeployment = async blockNumber => {
    assert(keccak256(await c.getBytecode({ address: manifest.registry, blockNumber })) === manifest.registryRuntime, 'REGISTRY_RUNTIME_CHANGED');
    assert((await c.getStorageAt({ address: manifest.hub, slot, blockNumber }))?.slice(-40) === manifest.registry.slice(2), 'HUB_REGISTRY_CHANGED');
    assert((await c.readContract({ address: manifest.registry, abi, functionName: 'registrar', blockNumber })).toLowerCase() === manifest.admin, 'REGISTRAR_CHANGED');
  };
  await verifyDeployment();
  const valid = (blockNumber, campaignId = creator ? zero : uuid(campaign)) => c.readContract({ address: manifest.registry, abi, functionName: 'isValidContext', args: [uuid(creatorId), campaignId], blockNumber });
  if (!creator) assert(await valid(undefined, zero), 'CREATOR_NOT_REGISTERED');
  const registrationTransaction = option('--registration-transaction');
  if (registrationTransaction) assert(creator && /^0x[0-9a-f]{64}$/.test(registrationTransaction), 'INVALID_REGISTRATION_TRANSACTION');
  if (mode === 'prepare') {
    assert(!fs.existsSync(manifestPath), 'MANIFEST_ALREADY_EXISTS');
    if (await valid()) assert(creator && registrationTransaction, 'EXISTING_REGISTRATION_TRANSACTION_REQUIRED');
    else await c.call({ account: manifest.admin, to: manifest.registry, data: manifest.data });
    fs.writeFileSync(manifestPath, json(manifest) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(json({ prepared: true, hash: manifest.hash, campaign, data: manifest.data, requiresTimelock: false }));
    return;
  }
  // Git metadata is outside tracked files; signed envelopes never go in a commit.
  const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
  const sharedDir = path.join(common, 'byus-admin-transactions');
  fs.mkdirSync(sharedDir, { recursive: true, mode: 0o700 });
  // Existing campaign journals keep their original worktree-specific path.
  const dir = creator ? sharedDir : execFileSync('git', ['rev-parse', '--git-path', 'byus-admin-transactions'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const journalPath = path.join(dir, `${manifest.hash}.json`);
  const lockPaths = [path.join(sharedDir, 'kyaa-migration.lock'), ...(!creator ? [path.resolve('work/giwa-admin-lifecycle.lock')] : [])];
  const acquiredLocks = [];
  function checkPrivate(file) { if (fs.existsSync(file)) { const st = fs.lstatSync(file); assert(st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0, 'UNSAFE_SIGNING_JOURNAL'); } }
  function persist(value) { checkPrivate(journalPath); const fd = fs.openSync(journalPath + '.tmp', 'wx', 0o600); try { fs.writeFileSync(fd, json(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(journalPath + '.tmp', journalPath); }
  checkPrivate(journalPath);
  try {
    for (const lockPath of lockPaths) {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.closeSync(fs.openSync(lockPath, 'wx', 0o600)); acquiredLocks.push(lockPath);
    }
    let journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath)) : null;
    if (!journal && !registrationTransaction) {
      assert(mode === 'execute', 'EXECUTION_JOURNAL_REQUIRED');
      assert(!(await valid()), 'CAMPAIGN_ALREADY_REGISTERED');
      const [latest, pending, fees, gas] = await Promise.all([c.getTransactionCount({ address: manifest.admin }), c.getTransactionCount({ address: manifest.admin, blockTag: 'pending' }), c.estimateFeesPerGas(), c.estimateGas({ account: manifest.admin, to: manifest.registry, data: manifest.data })]);
      assert(latest === pending && gas <= BigInt(manifest.gas), 'PENDING_NONCE_OR_GAS_CAP');
      const tx = { chainId: manifest.chainId, type: 'eip1559', nonce: pending, to: manifest.registry, data: manifest.data, value: 0n, gas: BigInt(manifest.gas), maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
      assertRegistrationEnvelope(tx, manifest);
      let key = execFileSync('/Users/jewel/.local/share/byus-admin-keychain/keychain-helper', ['read'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      assert(/^0x[0-9a-fA-F]{64}$/.test(key), 'KEYCHAIN_FORMAT');
      const account = privateKeyToAccount(key); key = '';
      assert(account.address.toLowerCase() === manifest.admin, 'WRONG_SIGNER');
      const signed = await account.signTransaction(tx);
      journal = { manifestHash: manifest.hash, nonce: pending, signed, hash: keccak256(signed) }; persist(journal);
    }
    if (journal) {
      assert(!registrationTransaction || registrationTransaction === journal.hash, 'ORIGINAL_TRANSACTION_REQUIRED');
      assert(journal.manifestHash === manifest.hash && keccak256(journal.signed) === journal.hash && (await recoverTransactionAddress({ serializedTransaction: journal.signed })).toLowerCase() === manifest.admin, 'JOURNAL_SIGNATURE');
      const tx = parseTransaction(journal.signed); assertRegistrationEnvelope(tx, manifest); assert(tx.nonce === journal.nonce, 'JOURNAL_NONCE');
    }
    const transactionHash = journal?.hash ?? registrationTransaction;
    let receipt;
    try { receipt = await c.getTransactionReceipt({ hash: transactionHash }); } catch (e) { if (e.name !== 'TransactionReceiptNotFoundError') throw e; }
    if (!receipt) {
      assert(mode === 'execute' && journal, 'TRANSACTION_NOT_MINED');
      let pendingTx;
      try { pendingTx = await c.getTransaction({ hash: journal.hash }); } catch (e) { if (e.name !== 'TransactionNotFoundError') throw e; }
      if (!pendingTx) {
        assert(await c.getTransactionCount({ address: manifest.admin }) === journal.nonce && await c.getTransactionCount({ address: manifest.admin, blockTag: 'pending' }) === journal.nonce, 'NONCE_CHANGED');
        assert(await c.sendRawTransaction({ serializedTransaction: journal.signed }) === journal.hash, 'BROADCAST_HASH');
      }
      receipt = await confirmedKyaaReceipt(c, transactionHash);
    }
    const transaction = await c.getTransaction({ hash: transactionHash });
    assertRegistrationReceipt(receipt, transaction, manifest, transactionHash, (await c.getBlock({ blockNumber: receipt.blockNumber })).hash);
    assert(await valid(), 'REGISTERED_CONTEXT_REQUIRED');
    const receiptProof = { hash: transactionHash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash };
    if (journal) { journal.receipt = receiptProof; persist(journal); }
    if (mode === 'execute') { console.log(json({ registered: true, ...receiptProof, requiresTimelock: false, producerProofApplied: false, next: 'Run finalize after chain finality.' })); return; }
    const finalized = await c.getBlock({ blockTag: 'finalized' });
    if (finalized.number < receipt.blockNumber) { console.log(json({ registered: true, producerProofApplied: false, waitingForChainFinality: true, finalizedBlock: String(finalized.number), requiredBlock: String(receipt.blockNumber) })); return; }
    await verifyDeployment(finalized.number);
    assert(await valid(finalized.number) && (await c.getBlock({ blockNumber: finalized.number })).hash === finalized.hash
      && (await c.getBlock({ blockNumber: receipt.blockNumber })).hash === receipt.blockHash, 'FINALIZED_CONTEXT_REQUIRED');
    const proofSql = creator ? `begin;set local lock_timeout='5s';set local statement_timeout='15s';
lock table public.fan_action_producer_routes in share mode;lock table public.fan_action_bindings in share mode;lock table public.celebrities in share mode;
do $g$ begin
if (select count(*) from public.fan_action_producer_routes where action_code in(1,6,8,10) and enabled and binding_id=${quote(manifest.binding)})<>4 then raise exception 'PRODUCER_ROUTES_CHANGED';end if;
if not exists(select 1 from public.fan_action_bindings where id=${quote(manifest.binding)} and hub_proxy=${quote(manifest.hub)} and chain_id=${manifest.chainId}) then raise exception 'BINDING_CHANGED';end if;
if not exists(select 1 from public.celebrities where id=${quote(row.id)} and slug=${quote(row.slug)} and status in('draft','published') and archived_at is null) then raise exception 'CREATOR_SOURCE_CHANGED';end if;
end $g$;
insert into public.fan_action_verified_creators(binding_id,creator_id,verified_block_number,verified_block_hash,verified_at) values(${quote(manifest.binding)},${quote(row.id)},${quote(finalized.number)},${quote(finalized.hash)},clock_timestamp()) on conflict(binding_id,creator_id) do nothing;
commit;` : `begin;set local lock_timeout='5s';set local statement_timeout='15s';
lock table public.fan_action_canary_scope in share mode;lock table public.fan_action_producer_routes in share mode;lock table public.fan_action_bindings in share mode;lock table public.live_events in share mode;
do $g$ begin
if (select count(*) from public.fan_action_producer_routes where action_code in(2,3,4,5) and enabled and binding_id=${quote(manifest.binding)})<>4 then raise exception 'LIVE_ROUTES_CHANGED';end if;
if not exists(select 1 from public.live_events where id=${quote(campaign)} and celebrity_id=${quote(row.celebrity_id)} and slug=${quote(row.slug)} and publication_status='published' and archived_at is null) then raise exception 'LIVE_SOURCE_CHANGED';end if;
if exists(select 1 from public.fan_action_verified_campaigns where binding_id=${quote(manifest.binding)} and campaign_id=${quote(campaign)} and creator_id<>${quote(row.celebrity_id)}) then raise exception 'CAMPAIGN_OWNER_CHANGED';end if;
end $g$;
insert into public.fan_action_verified_campaigns(binding_id,campaign_id,creator_id,verified_block_number,verified_block_hash,verified_at) values(${quote(manifest.binding)},${quote(campaign)},${quote(row.celebrity_id)},${quote(finalized.number)},${quote(finalized.hash)},clock_timestamp()) on conflict(binding_id,campaign_id) do nothing;commit;`;
    sql(proofSql, true);
    console.log(json({ registered: true, producerProofApplied: true, sourceId: campaign, hub: manifest.hub, finalizedBlock: String(finalized.number), transaction: transactionHash }));
  } finally { for (const lockPath of acquiredLocks.reverse()) fs.unlinkSync(lockPath); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(JSON.stringify({ stopped: true, reason: (/^[A-Z][A-Z0-9_: |<>?.-]+$/.test(e.message) ? e.message : e.name) })); process.exitCode = 1; });

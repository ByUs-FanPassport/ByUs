#!/usr/bin/env node
// Operational CLI: prepare an exact published LIVE registration, sign it once,
// then separately admit its canonical finalized proof to the native producer gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, encodeFunctionData, parseAbi, keccak256, stringToHex, toHex, parseTransaction, recoverTransactionAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readEnvironmentFile } from './local-production-env.mjs';

export const CAMPAIGN_DEPLOYMENT = Object.freeze({ chainId: 91342, hub: '0xbd9991a26d0a0bf744ecdb8ad4f59f60a9132956', registry: '0x4e104e5dfb3d466a2aac9ed0cf7572578068529b', binding: '5f45d72b-8d14-4cdb-906e-248ffb036206', admin: '0xeee82f960476c888950c798c444c1fd92cbbfe50', registryRuntime: '0x094b3a4a3af412568b9d3f004fd8f9e09e8dca8249398f50b9f25308a034d53b' });
const abi = parseAbi(['function registerCampaign(bytes32 campaignId,bytes32 creatorId,string publicSlug)', 'function isValidContext(bytes32 creatorId,bytes32 campaignId) view returns (bool)', 'function registrar() view returns(address)']);
const zero = '0x' + '00'.repeat(32);
const assert = (ok, reason) => { if (!ok) throw Error(reason); };
const uuid = (s) => { assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s), 'INVALID_UUID'); return '0x' + s.replaceAll('-', '').padStart(64, '0'); };
const json = (v) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? String(x) : x, 2);
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export function prepareCampaignRegistration(row) {
  assert(row && row.publication_status === 'published' && row.archived_at === null, 'PUBLISHED_LIVE_REQUIRED');
  assert(typeof row.slug === 'string' && /^[a-z0-9][a-z0-9-]{0,249}$/.test(row.slug), 'INVALID_PUBLIC_SLUG');
  const source = { id: row.id, celebrity_id: row.celebrity_id, slug: row.slug };
  const manifest = { format: 'byus-campaign-registration-v1', ...CAMPAIGN_DEPLOYMENT, source, gas: '150000', maxFeePerGas: '100000000', value: '0', data: encodeFunctionData({ abi, functionName: 'registerCampaign', args: [uuid(row.id), uuid(row.celebrity_id), row.slug] }) };
  return { ...manifest, hash: keccak256(stringToHex(json(manifest))) };
}
export function validateCampaignRegistration(manifest, row, approvedHash) {
  assert(manifest.hash === approvedHash && JSON.stringify(manifest) === JSON.stringify(prepareCampaignRegistration(row)), 'MANIFEST_OR_PUBLISHED_SOURCE_CHANGED');
  return manifest;
}
export function assertRegistrationEnvelope(tx, manifest) {
  assert(tx.type === 'eip1559' && tx.chainId === manifest.chainId && tx.to?.toLowerCase() === manifest.registry && tx.data === manifest.data && (tx.value ?? 0n) === 0n && tx.gas === BigInt(manifest.gas) && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= BigInt(manifest.maxFeePerGas) && tx.maxPriorityFeePerGas >= 0n && tx.maxPriorityFeePerGas <= tx.maxFeePerGas, 'TRANSACTION_ENVELOPE_CHANGED');
}
async function main() {
  const args = process.argv.slice(2);
  const option = (key) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  const mode = args[0];
  assert(['prepare', 'execute', 'finalize'].includes(mode), 'USAGE: prepare|execute|finalize --env-file PATH --db-url-file PATH --manifest PATH [--campaign UUID] [--approved-hash HASH]');
  const envFile = option('--env-file'), dbFile = option('--db-url-file'), manifestPath = option('--manifest');
  assert(envFile && dbFile && manifestPath, 'EXPLICIT_LOCAL_ENV_DB_AND_MANIFEST_REQUIRED');
  const env = await readEnvironmentFile(envFile);
  const dbUrl = fs.readFileSync(dbFile, 'utf8').trim();
  assert(env.SUPABASE_PROD_DB_PASSWORD && dbUrl.includes('gmrykvmtmuaeswpajteq'), 'PRODUCTION_DB_IDENTITY_REQUIRED');
  const sql = (query, write = false) => execFileSync('psql', [dbUrl, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: env.SUPABASE_PROD_DB_PASSWORD, PGSSLMODE: 'require', PGOPTIONS: write ? '' : '-c default_transaction_read_only=on' } }).trim();
  const campaign = mode === 'prepare' ? option('--campaign') : JSON.parse(fs.readFileSync(manifestPath)).source.id;
  uuid(campaign);
  const row = JSON.parse(sql(`select row_to_json(x) from(select id,celebrity_id,slug,publication_status,archived_at from public.live_events where id=${quote(campaign)})x`));
  const manifest = mode === 'prepare' ? prepareCampaignRegistration(row) : validateCampaignRegistration(JSON.parse(fs.readFileSync(manifestPath)), row, option('--approved-hash'));
  const binding = JSON.parse(sql(`select row_to_json(x) from(select b.id,b.hub_proxy,b.chain_id,exists(select 1 from public.fan_action_verified_creators v where v.binding_id=b.id and v.creator_id=${quote(row.celebrity_id)}) as creator_verified from public.fan_action_bindings b where b.id=${quote(manifest.binding)})x`));
  assert(binding?.hub_proxy === manifest.hub && binding.chain_id === manifest.chainId && binding.creator_verified, 'ACTIVE_BINDING_VERIFIED_CREATOR_REQUIRED');
  assert(sql(`select count(*) from public.fan_action_producer_routes where action_code in(2,3,4,5) and enabled and binding_id=${quote(manifest.binding)}`) === '4', 'LIVE_ROUTES_CHANGED');
  const c = createPublicClient({ transport: http('https://sepolia-rpc.giwa.io', { timeout: 15000, retryCount: 1 }) });
  assert(await c.getChainId() === manifest.chainId, 'WRONG_CHAIN');
  assert(keccak256(await c.getBytecode({ address: manifest.registry })) === manifest.registryRuntime, 'REGISTRY_RUNTIME_CHANGED');
  const slot = toHex(0x9b4561162b6d58cdaee430aa4073a2ec544ff4ca21320ef4e942bd0b419f7700n + 7n, { size: 32 });
  assert((await c.getStorageAt({ address: manifest.hub, slot })).slice(-40) === manifest.registry.slice(2), 'HUB_REGISTRY_CHANGED');
  assert((await c.readContract({ address: manifest.registry, abi, functionName: 'registrar' })).toLowerCase() === manifest.admin, 'REGISTRAR_CHANGED');
  const valid = (blockNumber, campaignId = uuid(campaign)) => c.readContract({ address: manifest.registry, abi, functionName: 'isValidContext', args: [uuid(row.celebrity_id), campaignId], blockNumber });
  assert(await valid(undefined, zero), 'CREATOR_NOT_REGISTERED');
  if (mode === 'prepare') {
    assert(!fs.existsSync(manifestPath), 'MANIFEST_ALREADY_EXISTS');
    assert(!(await valid()), 'CAMPAIGN_ALREADY_REGISTERED');
    await c.call({ account: manifest.admin, to: manifest.registry, data: manifest.data });
    fs.writeFileSync(manifestPath, json(manifest) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(json({ prepared: true, hash: manifest.hash, campaign, data: manifest.data, requiresTimelock: false }));
    return;
  }
  // Git metadata is outside tracked files; signed envelopes never go in a commit.
  const dir = execFileSync('git', ['rev-parse', '--git-path', 'byus-admin-transactions'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const journalPath = path.join(dir, `${manifest.hash}.json`);
  const lockPath = path.resolve('work/giwa-admin-lifecycle.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  function checkPrivate(file) { if (fs.existsSync(file)) { const st = fs.lstatSync(file); assert(st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0, 'UNSAFE_SIGNING_JOURNAL'); } }
  function persist(value) { checkPrivate(journalPath); const fd = fs.openSync(journalPath + '.tmp', 'wx', 0o600); try { fs.writeFileSync(fd, json(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(journalPath + '.tmp', journalPath); }
  checkPrivate(journalPath);
  const lock = fs.openSync(lockPath, 'wx', 0o600); fs.closeSync(lock);
  try {
    let journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath)) : null;
    if (!journal) {
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
    assert(journal.manifestHash === manifest.hash && keccak256(journal.signed) === journal.hash && (await recoverTransactionAddress({ serializedTransaction: journal.signed })).toLowerCase() === manifest.admin, 'JOURNAL_SIGNATURE');
    const tx = parseTransaction(journal.signed); assertRegistrationEnvelope(tx, manifest); assert(tx.nonce === journal.nonce, 'JOURNAL_NONCE');
    let receipt;
    try { receipt = await c.getTransactionReceipt({ hash: journal.hash }); } catch (e) { if (e.name !== 'TransactionReceiptNotFoundError') throw e; }
    if (!receipt) {
      assert(mode === 'execute', 'TRANSACTION_NOT_MINED');
      let pendingTx;
      try { pendingTx = await c.getTransaction({ hash: journal.hash }); } catch (e) { if (e.name !== 'TransactionNotFoundError') throw e; }
      if (!pendingTx) {
        assert(await c.getTransactionCount({ address: manifest.admin }) === journal.nonce && await c.getTransactionCount({ address: manifest.admin, blockTag: 'pending' }) === journal.nonce, 'NONCE_CHANGED');
        assert(await c.sendRawTransaction({ serializedTransaction: journal.signed }) === journal.hash, 'BROADCAST_HASH');
      }
      receipt = await c.waitForTransactionReceipt({ hash: journal.hash, pollingInterval: 1000, timeout: 55000 });
    }
    assert(receipt.status === 'success' && receipt.from.toLowerCase() === manifest.admin && receipt.to?.toLowerCase() === manifest.registry && (await c.getBlock({ blockNumber: receipt.blockNumber })).hash === receipt.blockHash && await valid(), 'CANONICAL_REGISTRATION_REQUIRED');
    journal.receipt = { hash: journal.hash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash }; persist(journal);
    if (mode === 'execute') { console.log(json({ registered: true, ...journal.receipt, requiresTimelock: false, producerProofApplied: false, next: 'Run finalize after chain finality.' })); return; }
    const finalized = await c.getBlock({ blockTag: 'finalized' });
    if (finalized.number < receipt.blockNumber) { console.log(json({ registered: true, producerProofApplied: false, waitingForChainFinality: true, finalizedBlock: String(finalized.number), requiredBlock: String(receipt.blockNumber) })); return; }
    assert(await valid(finalized.number) && (await c.getBlock({ blockNumber: finalized.number })).hash === finalized.hash, 'FINALIZED_CONTEXT_REQUIRED');
    const proofSql = `begin;set local lock_timeout='5s';set local statement_timeout='15s';
lock table public.fan_action_canary_scope in share mode;lock table public.fan_action_producer_routes in share mode;lock table public.fan_action_bindings in share mode;lock table public.live_events in share mode;
do $g$ begin
if (select count(*) from public.fan_action_producer_routes where action_code in(2,3,4,5) and enabled and binding_id=${quote(manifest.binding)})<>4 then raise exception 'LIVE_ROUTES_CHANGED';end if;
if not exists(select 1 from public.live_events where id=${quote(campaign)} and celebrity_id=${quote(row.celebrity_id)} and slug=${quote(row.slug)} and publication_status='published' and archived_at is null) then raise exception 'LIVE_SOURCE_CHANGED';end if;
if exists(select 1 from public.fan_action_verified_campaigns where binding_id=${quote(manifest.binding)} and campaign_id=${quote(campaign)} and creator_id<>${quote(row.celebrity_id)}) then raise exception 'CAMPAIGN_OWNER_CHANGED';end if;
end $g$;
insert into public.fan_action_verified_campaigns(binding_id,campaign_id,creator_id,verified_block_number,verified_block_hash,verified_at) values(${quote(manifest.binding)},${quote(campaign)},${quote(row.celebrity_id)},${quote(finalized.number)},${quote(finalized.hash)},clock_timestamp()) on conflict(binding_id,campaign_id) do nothing;commit;`;
    sql(proofSql, true);
    console.log(json({ registered: true, producerProofApplied: true, campaign, hub: manifest.hub, finalizedBlock: String(finalized.number), transaction: journal.hash }));
  } finally { fs.unlinkSync(lockPath); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(JSON.stringify({ stopped: true, reason: (/^[A-Z][A-Z0-9_: |<>?.-]+$/.test(e.message) ? e.message : e.name) })); process.exitCode = 1; });

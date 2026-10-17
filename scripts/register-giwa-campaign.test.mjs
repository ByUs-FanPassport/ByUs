import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { prepareCampaignRegistration, validateCampaignRegistration, assertRegistrationEnvelope } from './register-giwa-campaign.mjs';
import * as registration from './register-giwa-campaign.mjs';
const row={id:'c0960f8b-f01c-4308-97f8-3d13173922e8',celebrity_id:'18ec5319-95fb-4134-95f4-97ff95ae726b',slug:'elina-banksy-instagram-20260918',publication_status:'published',archived_at:null};
test('new binding registration and saved legacy manifests remain independently verifiable',()=>{
  const legacy=prepareCampaignRegistration(row);
  const next=prepareCampaignRegistration(row,'f03415d0-3235-4bd7-bee5-a8a9c36c163a');
  assert.equal(next.binding,'f03415d0-3235-4bd7-bee5-a8a9c36c163a');
  assert.notEqual(next.hash,legacy.hash);
  assert.equal(validateCampaignRegistration(legacy,row,legacy.hash),legacy);
  assert.equal(validateCampaignRegistration(next,row,next.hash),next);
  assert.throws(()=>validateCampaignRegistration({...legacy,binding:next.binding},row,legacy.hash));
  assert.throws(()=>prepareCampaignRegistration(row,'f03415d0-3235-4bd7-bee5-a8a9c36c163b'));
});
test('published LIVE maps exact campaign and creator IDs into direct registration',()=>{const m=prepareCampaignRegistration(row);const d=decodeFunctionData({abi:parseAbi(['function registerCampaign(bytes32,bytes32,string)']),data:m.data});assert.equal(d.functionName,'registerCampaign');assert.equal(d.args[0],'0x'+row.id.replaceAll('-','').padStart(64,'0'));assert.equal(d.args[1],'0x'+row.celebrity_id.replaceAll('-','').padStart(64,'0'));assert.equal(d.args[2],row.slug);assert.equal(validateCampaignRegistration(m,row,m.hash),m);});
test('draft, archived, malformed IDs and changed ownership fail before signing',()=>{for(const bad of [{...row,publication_status:'draft'},{...row,archived_at:'2026-09-14'},{...row,id:'bad'}])assert.throws(()=>prepareCampaignRegistration(bad));const m=prepareCampaignRegistration(row);assert.throws(()=>validateCampaignRegistration(m,{...row,celebrity_id:'6cfe1fac-5c48-44ed-a865-f4c0dc86e916'},m.hash));assert.throws(()=>validateCampaignRegistration({...m,registry:'0x'+'11'.repeat(20)},row,m.hash));});
test('signed envelope rejects wrong chain, recipient, value and fee escalation',()=>{const m=prepareCampaignRegistration(row),tx={type:'eip1559',chainId:m.chainId,to:m.registry,data:m.data,value:0n,gas:150000n,maxFeePerGas:100n,maxPriorityFeePerGas:1n};assert.doesNotThrow(()=>assertRegistrationEnvelope(tx,m));for(const change of[{chainId:1},{to:m.hub},{value:1n},{data:'0x'},{gas:150001n},{maxFeePerGas:100000001n},{maxPriorityFeePerGas:101n}])assert.throws(()=>assertRegistrationEnvelope({...tx,...change},m));});

const creator = { id: 'ae823360-ff59-4b9d-b336-1f013fe0fbb1', slug: 'hyunji', status: 'draft', archived_at: null };
test('creator can register before publication with the exact public identity and current binding', () => {
  assert.equal(typeof registration.prepareCreatorRegistration, 'function');
  const manifest = registration.prepareCreatorRegistration(creator, registration.KYAA_BINDING_ID);
  const decoded = decodeFunctionData({ abi: parseAbi(['function registerCreator(bytes32,string)']), data: manifest.data });
  assert.deepEqual(decoded.args, ['0x' + creator.id.replaceAll('-', '').padStart(64, '0'), 'hyunji']);
  assert.equal(manifest.format, 'byus-creator-registration-v1');
  assert.equal(manifest.binding, registration.KYAA_BINDING_ID);
  assert.equal(registration.validateCreatorRegistration(manifest, { ...creator, status: 'published' }, manifest.hash), manifest);
});

test('creator registration rejects changed identity, archived source, unknown binding and altered manifest', () => {
  assert.equal(typeof registration.prepareCreatorRegistration, 'function');
  const manifest = registration.prepareCreatorRegistration(creator, registration.KYAA_BINDING_ID);
  for (const bad of [{ ...creator, status: 'deleted' }, { ...creator, archived_at: '2026-10-17' }, { ...creator, slug: '../hyunji' }, { ...creator, id: 'bad' }]) {
    assert.throws(() => registration.prepareCreatorRegistration(bad, registration.KYAA_BINDING_ID));
  }
  assert.throws(() => registration.prepareCreatorRegistration(creator, 'f03415d0-3235-4bd7-bee5-a8a9c36c163b'));
  assert.throws(() => registration.validateCreatorRegistration(manifest, { ...creator, slug: 'someone-else' }, manifest.hash));
  assert.throws(() => registration.validateCreatorRegistration({ ...manifest, data: '0x' }, creator, manifest.hash));
  assert.throws(() => registration.validateCreatorRegistration(manifest, creator, '0x' + '00'.repeat(32)));
});

test('registration proof is bound to the original transaction, canonical block and exact registry event', () => {
  const hash = '0x' + '11'.repeat(32), blockHash = '0x' + '22'.repeat(32);
  for (const manifest of [registration.prepareCreatorRegistration(creator), prepareCampaignRegistration(row)]) {
    const isCreator = manifest.format === 'byus-creator-registration-v1';
    const id = value => '0x' + value.replaceAll('-', '').padStart(64, '0');
    const eventAbi = parseAbi([isCreator ? 'event CreatorRegistered(bytes32 indexed creatorId,string publicSlug)' : 'event CampaignRegistered(bytes32 indexed campaignId,bytes32 indexed creatorId,string publicSlug)']);
    const log = { address: manifest.registry,
      topics: encodeEventTopics({ abi: eventAbi, eventName: isCreator ? 'CreatorRegistered' : 'CampaignRegistered',
        args: isCreator ? { creatorId: id(creator.id) } : { creatorId: id(row.celebrity_id), campaignId: id(row.id) } }),
      data: encodeAbiParameters([{ type: 'string' }], [manifest.source.slug]) };
    const transaction = { type: 'eip1559', chainId: manifest.chainId, hash, from: manifest.admin,
      to: manifest.registry, input: manifest.data, value: 0n, gas: 150000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 1n,
      blockHash, blockNumber: 10n };
    const receipt = { transactionHash: hash, from: manifest.admin, to: manifest.registry, status: 'success',
      blockHash, blockNumber: 10n, logs: [log] };
    const verify = (r = receipt, tx = transaction, canonical = blockHash) => registration.assertRegistrationReceipt(r, tx, manifest, hash, canonical);
    assert.doesNotThrow(() => verify());
    assert.throws(() => verify({ ...receipt, transactionHash: blockHash }));
    assert.throws(() => verify(receipt, { ...transaction, hash: blockHash }));
    assert.throws(() => verify(receipt, { ...transaction, input: '0x' }));
    assert.throws(() => verify(receipt, { ...transaction, blockNumber: 11n }));
    assert.throws(() => verify(receipt, transaction, hash));
    assert.throws(() => verify({ ...receipt, status: 'reverted' }));
    assert.throws(() => verify({ ...receipt, logs: [{ ...log, address: manifest.hub }] }));
    assert.throws(() => verify({ ...receipt, logs: [{ ...log, data: encodeAbiParameters([{ type: 'string' }], ['wrong-slug']) }] }));
    assert.throws(() => verify({ ...receipt, logs: [] }));
    assert.throws(() => verify({ ...receipt, logs: [log, log] }));
  }
});

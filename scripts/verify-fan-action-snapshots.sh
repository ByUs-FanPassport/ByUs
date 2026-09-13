#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${PGHOST:?}" "${PGPORT:?}" "${PGDATABASE:?}"
if [[ "$PGDATABASE" != "byus_clean" || "$PGHOST" != /*/byus-clean-db.*/socket || ! -S "$PGHOST/.s.PGSQL.$PGPORT" ]]; then
  echo "Refusing non-disposable database" >&2; exit 1
fi
cd "$root_dir"
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {actionSourceSnapshotV1Schema, legacyMetadataInput} from './apps/worker/dist/action-domain.js';
import {renderMetadata} from './apps/worker/dist/metadata.js';
const fixture = readFileSync('supabase/tests/fan_action_producers.sql','utf8');
if (!/rollback;\s*$/i.test(fixture)) throw new Error('Fixture must end in rollback');
const query = fixture.replace(/rollback;\s*$/i, `select 'ACTION_SNAPSHOT:'||source_snapshot::text from public.fan_action_outbox where source_snapshot->>'sourceNamespace' <> 'producer_test' and operation_kind <> 'import_historical' order by id; rollback;`);
const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-Atq'],{input:query,encoding:'utf8'});
if(result.status!==0) throw new Error(result.stderr);
const rows=result.stdout.split('\n').filter(x=>x.startsWith('ACTION_SNAPSHOT:'));
if(rows.length<11) throw new Error('Expected all supported producer snapshots');
for(const line of rows){
  const snapshot=actionSourceSnapshotV1Schema.parse(JSON.parse(line.slice('ACTION_SNAPSHOT:'.length)));
  for(const c of snapshot.credentials){
    const input=legacyMetadataInput(c.metadata);
    const document=renderMetadata({id:'fixture',entityType:input.entityType,entityId:'fixture',operationKey:input.operationKey,
      payloadVersion:1,payload:input.payload,attempts:0,maxAttempts:10,txHash:null,leaseOwner:'fixture',leaseExpiresAt:'2099-01-01'},input.payload,snapshot.assetBaseUri);
    if(JSON.stringify(document).toLowerCase().includes(snapshot.recipient.toLowerCase())) throw new Error('Wallet leaked into metadata');
  }
}
console.log(`PASS: ${rows.length} actual SQL snapshots parse and render in the worker without wallet disclosure`);
JS

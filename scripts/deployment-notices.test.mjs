import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BOOTSTRAP, CHECK_NAME, REPOSITORY, formatNotice, readNotes, checkNotes, validateNote, notifyDeployment } from './deployment-notices.mjs';

const note = { changes: ['알림 목록의 점을 굵은 제목과 같은 높이에 맞췄어요.'], path: '/notifications' };
const sha = 'c'.repeat(40), priorSha = 'b'.repeat(40);
const deployment = { id: BOOTSTRAP.id + 3, sha, environment: 'Production', creator: { login: 'vercel[bot]' } };
const status = { state: 'success', environment: 'Production', creator: { login: 'vercel[bot]' }, created_at: '2026-09-28T14:40:00Z' };
const receipt = (candidate, conclusion = 'success') => ({ id: candidate.id + 100, head_sha: candidate.sha, external_id: String(candidate.id), name: CHECK_NAME, app: { slug: 'github-actions' }, status: 'completed', conclusion });
function harness({ existing, prior, sendError, saveError } = {}) {
  const receipts = new Map();
  if (existing) receipts.set(sha, [existing]);
  if (prior) receipts.set(prior.sha, [prior.receipt]);
  const records = { sent: [], notes: [], writes: [] };
  const options = { event: { repository: { full_name: REPOSITORY }, deployment, deployment_status: status }, assertOnMain: () => {}, runUrl: 'https://github.com/ByUs-FanPassport/ByUs/actions/runs/1',
    notes: (base, head) => { records.notes.push({ base, head }); return [note]; },
    send: async body => { records.sent.push(body); if (sendError) throw sendError; return { messageId: 77, chatId: -5187701508 }; },
    github: async (path, init) => {
      if (init) {
        records.writes.push(init.body);
        if (saveError && init.body.conclusion === 'success') throw new Error('lost receipt write');
        return { id: 99 };
      }
      if (path === `/deployments/${deployment.id}`) return deployment;
      if (path.includes('/statuses?')) return [status];
      if (path.startsWith('/commits/')) return { check_runs: receipts.get(path.split('/')[2]) ?? [] };
      if (path.startsWith('/deployments?')) return [deployment, ...(prior ? [prior] : []), BOOTSTRAP].sort((a, b) => b.id - a.id);
      throw new Error(`unexpected path ${path}`);
    } };
  return { options, records };
}

test('plain Korean message includes exact change, approved link and Korean completion time', () => {
  const message = formatNotice([note, note], status.created_at);
  assert.match(message, /9월 28일 23:40/);
  assert.equal(message.split(note.changes[0]).length - 1, 1);
  assert.match(message, /https:\/\/byus.kr\/notifications/);
  for (const invalid of [{ ...note, path: '//evil.test' }, { ...note, changes: ['Use CSS subgrid'] }, { ...note, changes: ['안내 https://evil.test'] }, { ...note, path: '/\\evil.test' }]) assert.throws(() => validateNote(invalid));
  assert.throws(() => formatNotice([], status.created_at), /RELEASE_NOTE_REQUIRED/);
});

test('real git range requires newly added immutable note files', () => {
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'byus-notice-check-'));
  const git = (...args) => execFileSync(process.env.GIT_EXECUTABLE || 'git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    git('commit', '--allow-empty', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    git('branch', 'feature'); writeFileSync(join(dir, 'README.md'), 'doc'); git('add', '.'); git('commit', '-qm', 'main advance'); const main = git('rev-parse', 'HEAD');
    process.chdir(dir); assert.deepEqual(readNotes(base, main), []);
    git('checkout', '-q', 'feature');
    mkdirSync(join(dir, 'release-notes')); writeFileSync(join(dir, 'release-notes/fix.json'), JSON.stringify(note));
    git('add', '.'); git('commit', '-qm', 'note'); const head = git('rev-parse', 'HEAD'); process.chdir(dir);
    assert.deepEqual(readNotes(base, head), [note]);
    assert.deepEqual(checkNotes(main, head, true), [note]);
    assert.throws(() => checkNotes(main, head, false));
    writeFileSync(join(dir, 'release-notes/fix.json'), JSON.stringify({ ...note, path: '/' })); git('add', '.'); git('commit', '-qm', 'edit');
    assert.throws(() => readNotes(head, git('rev-parse', 'HEAD')), /IMMUTABLE/);
    const beforeCode = git('rev-parse', 'HEAD'); mkdirSync(join(dir, 'apps/web'), { recursive: true }); writeFileSync(join(dir, 'apps/web/change.ts'), 'export const changed = true;'); git('add', '.'); git('commit', '-qm', 'code without note');
    assert.throws(() => readNotes(beforeCode, git('rev-parse', 'HEAD')), /RELEASE_NOTE_REQUIRED/);
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
});

test('reserves before sending and records returned message id', async () => {
  const { options, records } = harness();
  assert.equal((await notifyDeployment(options)).messageId, 77);
  assert.equal(records.writes[0].status, 'in_progress');
  assert.equal(records.writes.at(-1).conclusion, 'success');
  assert.equal(records.sent.length, 1);
  assert.equal(records.notes[0].base, BOOTSTRAP.sha);
});

test('ignores preview, failure and other repositories without API or send', async () => {
  for (const event of [
    { deployment: { ...deployment, environment: 'Preview' }, deployment_status: status },
    { deployment, deployment_status: { ...status, state: 'failure' } },
    { deployment, deployment_status: status, repository: { full_name: 'other/repo' } },
  ]) {
    const { options, records } = harness(); options.event = { repository: { full_name: REPOSITORY }, ...event };
    options.github = () => { throw new Error('must not call'); };
    assert.ok((await notifyDeployment(options)).skipped); assert.equal(records.sent.length, 0);
  }
});

test('success receipt prevents repeated deployment events from sending again', async () => {
  const { options, records } = harness({ existing: receipt(deployment) });
  assert.equal((await notifyDeployment(options)).skipped, 'already_sent'); assert.equal(records.sent.length, 0);
});

test('current and prior uncertain receipts block automatic attempts', async () => {
  for (const config of [{ existing: receipt(deployment, 'action_required') }, { prior: { id: deployment.id - 1, sha: priorSha, creator: deployment.creator, receipt: receipt({ id: deployment.id - 1, sha: priorSha }, 'action_required') } }]) {
    const { options, records } = harness(config);
    await assert.rejects(notifyDeployment(options), /UNCERTAIN/); assert.equal(records.sent.length, 0);
  }
});

test('last sent notice is baseline; rejected prior notice stays in accumulated changes', async () => {
  for (const conclusion of ['success', 'failure']) {
    const prior = { id: deployment.id - 1, sha: priorSha, creator: deployment.creator }; prior.receipt = receipt(prior, conclusion);
    const { options, records } = harness({ prior }); await notifyDeployment(options);
    assert.equal(records.notes[0].base, conclusion === 'success' ? priorSha : BOOTSTRAP.sha);
  }
});

test('late event after a newer sent notice is skipped', async () => {
  const prior = { id: deployment.id + 1, sha: priorSha, creator: deployment.creator }; prior.receipt = receipt(prior);
  const { options, records } = harness({ prior });
  assert.equal((await notifyDeployment(options)).skipped, 'superseded_by_newer_notice'); assert.equal(records.sent.length, 0);
});

test('send timeout and receipt-write failure are uncertain; definitive rejection is retryable', async () => {
  for (const config of [{ sendError: new Error('timeout') }, { saveError: true }, { sendError: Object.assign(new Error('rejected'), { definitelyNotSent: true }) }]) {
    const { options, records } = harness(config);
    await assert.rejects(notifyDeployment(options));
    assert.equal(records.sent.length, 1);
    assert.equal(records.writes.at(-1).conclusion, config.sendError?.definitelyNotSent ? 'failure' : 'action_required');
  }
});


test('a definitive rejection can reuse its receipt without creation-only PATCH fields', async () => {
  const { options, records } = harness({ existing: receipt(deployment, 'failure') });
  await notifyDeployment(options);
  assert.deepEqual(Object.keys(records.writes[0]).sort(), ['details_url', 'output', 'status']);
  assert.equal(records.sent.length, 1);
});

test('redeploying an already announced revision makes no new claim or message', async () => {
  const { options, records } = harness(); options.notes = () => [];
  assert.equal((await notifyDeployment(options)).skipped, 'no_new_changes_to_announce');
  assert.equal(records.sent.length, 0); assert.equal(records.writes.length, 0);
});


test('receipt lookup reads later pages instead of sending a duplicate', async () => {
  const { options, records } = harness(); const original = options.github;
  options.github = async (path, init) => {
    if (path.startsWith(`/commits/${sha}/`)) return { check_runs: path.endsWith('page=1') ? Array.from({length:100}, (_, id) => ({id, name: CHECK_NAME, external_id: String(id), app: {slug:'github-actions'}})) : [receipt(deployment)] };
    return original(path, init);
  };
  assert.equal((await notifyDeployment(options)).skipped, 'already_sent');
  assert.equal(records.sent.length, 0);
});

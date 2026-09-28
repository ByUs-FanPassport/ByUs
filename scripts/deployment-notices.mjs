import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'ByUs-FanPassport/ByUs';
export const CHECK_NAME = 'Telegram deployment notice';
// The last deployment before automatic notices were introduced; never advance this bootstrap.
export const BOOTSTRAP = { id: 6712694578, sha: '401f25159028791b0d680df3c56c1b7e6a354714' };
const SHA = /^[0-9a-f]{40}$/;
const git = (...args) => execFileSync(process.env.GIT_EXECUTABLE || 'git', args, { encoding: 'utf8' }).trim();

export function validateNote(note) {
  if (!note || Object.keys(note).some(key => !['changes', 'path'].includes(key)) ||
      !Array.isArray(note.changes) || note.changes.length < 1 || note.changes.length > 5 ||
      note.changes.some(line => typeof line !== 'string' || line.length < 6 || line.length > 240 ||
        !/[가-힣]/.test(line) || /[\r\n\x00-\x1f\x7f]|https?:\/\//.test(line)) ||
      typeof note.path !== 'string' || !/^\/[a-zA-Z0-9/_-]*$/.test(note.path) || note.path.startsWith('//')) {
    throw new Error('INVALID_RELEASE_NOTE: use 1–5 short Korean changes and a ByUs site path');
  }
  return note;
}

export function readNotes(base, head) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('INVALID_COMMIT');
  git('merge-base', '--is-ancestor', base, head);
  const entries = git('diff', '--name-status', '--no-renames', base, head, '--', 'release-notes/*.json').split('\n').filter(Boolean);
  if (entries.some(line => !line.startsWith('A\t'))) throw new Error('RELEASE_NOTES_ARE_IMMUTABLE');
  const notes = entries.map(line => {
    const file = line.slice(2);
    if (!/^release-notes\/[a-z0-9-]+\.json$/.test(file)) throw new Error('INVALID_NOTE_FILENAME');
    return validateNote(JSON.parse(git('show', `${head}:${file}`)));
  });
  const changedFiles = git('diff', '--name-only', base, head).split('\n');
  const runtimeChanged = changedFiles.some(file =>
    /^(apps\/|scripts\/|supabase\/migrations\/|contracts\/src\/|\.github\/workflows\/|package(?:-lock)?\.json$|vercel\.json$)/.test(file) &&
    !/(?:\.(?:test|spec)\.|\.md$|(?:^|\/)(?:tests?|e2e|__tests__)\/)/.test(file));
  if (!notes.length && runtimeChanged) throw new Error('RELEASE_NOTE_REQUIRED');
  return notes;
}

export function checkNotes(base, head, pullRequest = false) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('INVALID_COMMIT');
  return readNotes(pullRequest ? git('merge-base', base, head) : base, head);
}

export function formatNotice(notes, completedAt) {
  if (!notes.length) throw new Error('RELEASE_NOTE_REQUIRED');
  notes.forEach(validateNote);
  const time = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(completedAt));
  const changes = [...new Set(notes.flatMap(note => note.changes))];
  const links = [...new Set(notes.map(note => `https://byus.kr${note.path}`))];
  const text = `✅ ByUs 수정사항이 반영됐어요\n\n${changes.map(line => `• ${line}`).join('\n')}\n\n확인하기\n${links.join('\n')}\n\n반영 시각: ${time} (한국 시간)`;
  if (text.length > 3900) throw new Error('RELEASE_NOTICE_TOO_LONG');
  return text;
}

export function eligibleDeployment(deployment, status) {
  return Number.isSafeInteger(deployment?.id) && deployment.id > BOOTSTRAP.id && SHA.test(deployment.sha ?? '') &&
    deployment.environment === 'Production' && deployment.creator?.login === 'vercel[bot]' &&
    status?.state === 'success' && status.environment === 'Production' && status.creator?.login === 'vercel[bot]';
}

export function receiptState(receipt) {
  if (!receipt) return 'new';
  if (receipt.status === 'completed' && receipt.conclusion === 'success') return 'sent';
  if (receipt.status === 'completed' && receipt.conclusion === 'failure') return 'rejected';
  return 'uncertain';
}

export async function notifyDeployment({ event, github, send, notes = readNotes, assertOnMain = sha => git('merge-base', '--is-ancestor', sha, 'origin/main'), runUrl }) {
  if (event.repository?.full_name !== REPOSITORY || !eligibleDeployment(event.deployment, event.deployment_status)) return { skipped: 'not_production_success' };
  const deployment = await github(`/deployments/${event.deployment.id}`);
  const [status] = await github(`/deployments/${deployment.id}/statuses?per_page=100`);
  if (!eligibleDeployment(deployment, status) || deployment.sha !== event.deployment.sha) return { skipped: 'deployment_no_longer_successful' };
  assertOnMain(deployment.sha);

  async function receiptFor(candidate) {
    const matches = [];
    for (let page = 1; ; page++) {
      const result = await github(`/commits/${candidate.sha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&filter=all&per_page=100&page=${page}`);
      matches.push(...result.check_runs.filter(check => check.app?.slug === 'github-actions' && check.external_id === String(candidate.id) && check.name === CHECK_NAME));
      if (result.check_runs.length < 100) break;
    }
    if (matches.length > 1) throw new Error('MULTIPLE_NOTICE_RECEIPTS_REQUIRE_REVIEW');
    return matches[0];
  }
  const existing = await receiptFor(deployment);
  if (receiptState(existing) === 'sent') return { skipped: 'already_sent' };
  if (receiptState(existing) === 'uncertain') throw new Error('NOTICE_DELIVERY_UNCERTAIN: inspect the Telegram room before retrying');

  let base;
  for (let page = 1; !base; page++) {
    const deployments = await github(`/deployments?environment=Production&per_page=100&page=${page}`);
    if (!deployments.length) throw new Error('NOTICE_BASELINE_NOT_FOUND');
    for (const candidate of deployments) {
      if (candidate.id <= BOOTSTRAP.id) { base = BOOTSTRAP.sha; break; }
      if (candidate.id === deployment.id || candidate.creator?.login !== 'vercel[bot]') continue;
      const receipt = await receiptFor(candidate);
      const state = receiptState(receipt);
      if (state === 'uncertain') throw new Error('PRIOR_NOTICE_DELIVERY_UNCERTAIN');
      if (candidate.id > deployment.id && state === 'sent') return { skipped: 'superseded_by_newer_notice' };
      if (candidate.id < deployment.id && state === 'sent') { base = candidate.sha; break; }
    }
  }
  const pendingNotes = notes(base, deployment.sha);
  if (!pendingNotes.length) return { skipped: 'no_new_changes_to_announce' };
  const text = formatNotice(pendingNotes, status.created_at);
  const claim = { name: CHECK_NAME, head_sha: deployment.sha, external_id: String(deployment.id), status: 'in_progress', details_url: runUrl,
    output: { title: 'Telegram delivery reserved', summary: 'Automatic retry is blocked until this receipt has a definitive outcome.' } };
  const receipt = existing
    ? await github(`/check-runs/${existing.id}`, { method: 'PATCH', body: { status: claim.status, details_url: claim.details_url, output: claim.output } })
    : await github('/check-runs', { method: 'POST', body: claim });
  try {
    const result = await send({ deploymentId: deployment.id, receiptId: receipt.id, text });
    await github(`/check-runs/${receipt.id}`, { method: 'PATCH', body: { status: 'completed', conclusion: 'success',
      output: { title: 'Telegram notice delivered', summary: JSON.stringify({ messageId: result.messageId, chatId: result.chatId, deploymentId: deployment.id, base, text }) } } });
    return { sent: true, deploymentId: deployment.id, messageId: result.messageId };
  } catch (error) {
    // ponytail: reserve before the one send attempt; ambiguous delivery needs room inspection, never blind retries.
    await github(`/check-runs/${receipt.id}`, { method: 'PATCH', body: { status: 'completed', conclusion: error.definitelyNotSent ? 'failure' : 'action_required',
      output: { title: error.definitelyNotSent ? 'Telegram rejected the notice' : 'Telegram delivery needs manual inspection', summary: error.definitelyNotSent ? 'No message was accepted; rerunning is safe.' : 'A message may already exist. Check the room before changing this receipt or retrying.' } } }).catch(() => {});
    throw new Error(error.definitelyNotSent ? 'NOTICE_REJECTED' : 'NOTICE_DELIVERY_UNCERTAIN');
  }
}

async function main() {
  if (process.argv[2] === 'check') {
    const notes = checkNotes(process.argv[3], process.argv[4], process.env.GITHUB_EVENT_NAME === 'pull_request');
    console.log(notes.length ? formatNotice(notes, new Date().toISOString()) : 'No runtime changes requiring a notice');
    return;
  }
  if (process.argv[2] !== 'send') throw new Error('Usage: deployment-notices.mjs check <base-sha> <head-sha> | send');
  if (!process.env.GITHUB_TOKEN || !process.env.TELEGRAM_BUG_REPORT_OPERATOR_SECRET) throw new Error('NOTICE_CREDENTIALS_MISSING');
  const github = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, { method, headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
    return response.json();
  };
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = await notifyDeployment({ event, github, runUrl: `https://github.com/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    send: async body => {
      const response = await fetch('https://byus.kr/api/internal/telegram/deployment-notices', { method: 'POST', headers: { authorization: `Bearer ${process.env.TELEGRAM_BUG_REPORT_OPERATOR_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45_000) });
      const result = await response.json();
      if (!response.ok || !result.ok || !Number.isSafeInteger(result.messageId) || result.chatId !== -5187701508) {
        const error = new Error('NOTICE_ENDPOINT_FAILED');
        error.definitelyNotSent = ['UNAUTHORIZED', 'INVALID_REQUEST', 'DEPLOYMENT_NOT_READY', 'DEPLOYMENT_VERIFICATION_UNAVAILABLE', 'TELEGRAM_OPERATOR_UNAVAILABLE', 'RECEIPT_NOT_RESERVED', 'TELEGRAM_NOTICE_REJECTED'].includes(result.error?.code);
        throw error;
      }
      return result;
    } });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

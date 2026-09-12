// Node 24: node --conditions=react-server --env-file=<private-env-file> scripts/verify-youtube-live-source.mjs --live <channel-url> --offline <channel-url>
// Makes real read-only YouTube API requests. Never prints the API key or raw upstream responses.
import { parseYouTubeChannelUrl } from "../apps/web/features/live/domain/youtube-channel.ts";
import { fetchYouTubeLiveObservation } from "../apps/web/server/youtube/youtube-live-source.ts";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--live" || args[2] !== "--offline") {
  console.error("Usage: --live <canonical-channel-url> --offline <canonical-channel-url>");
  process.exit(2);
}
if (!process.env.YOUTUBE_DATA_API_KEY?.trim()) {
  console.error("YOUTUBE_DATA_API_KEY is required in the private server environment.");
  process.exit(2);
}
const checks = [["live", args[1]], ["offline", args[3]]].map(([expected, url]) => ({
  expected,
  target: parseYouTubeChannelUrl(url),
}));
if (checks.some(({ target }) => target === null)) {
  console.error("Use a bare https://www.youtube.com/@handle or /channel/UC... URL.");
  process.exit(2);
}
let passed = true;
for (const { expected, target } of checks) {
  const observation = await fetchYouTubeLiveObservation(target);
  const matches = observation.state === expected;
  passed &&= matches;
  console.log(JSON.stringify({ expected, target, matches, observation }));
}
process.exitCode = passed ? 0 : 1;

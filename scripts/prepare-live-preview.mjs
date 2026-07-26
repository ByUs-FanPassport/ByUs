#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

import { createClient } from "@supabase/supabase-js";

const exec = promisify(execFile);

function fail(message) {
  throw new Error(message);
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail(`Unexpected argument: ${key}`);
    if (key === "--upload") {
      values.set("upload", true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    values.set(key.slice(2), value);
    index += 1;
  }
  const required = [
    "live-id",
    "input",
    "output",
    "start",
    "duration",
    "focal-x",
    "focal-y",
    "rights-holder",
    "rights-basis",
    "source-reference",
  ];
  for (const key of required) {
    if (!values.get(key)) fail(`--${key} is required`);
  }
  const durationSeconds = Number(values.get("duration"));
  const focalX = Number(values.get("focal-x"));
  const focalY = Number(values.get("focal-y"));
  const liveEventId = values.get("live-id");
  const kind = values.get("kind") ?? "artist_teaser";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(liveEventId)) {
    fail("--live-id must be a UUID");
  }
  if (!["artist_teaser", "event_highlight"].includes(kind)) {
    fail("--kind must be artist_teaser or event_highlight");
  }
  if (durationSeconds < 3 || durationSeconds > 5) {
    fail("--duration must be between 3 and 5 seconds");
  }
  if (![focalX, focalY].every((value) => value >= 0 && value <= 1)) {
    fail("--focal-x and --focal-y must be between 0 and 1");
  }
  return {
    liveEventId,
    input: resolve(values.get("input")),
    output: resolve(values.get("output")),
    start: values.get("start"),
    durationSeconds,
    focalX,
    focalY,
    kind,
    rightsHolder: values.get("rights-holder"),
    rightsBasis: values.get("rights-basis"),
    sourceReference: values.get("source-reference"),
    upload: values.get("upload") === true,
  };
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function command(binary, args) {
  try {
    return await exec(binary, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    fail(`${binary} failed: ${error.stderr || error.message}`);
  }
}

async function probe(path) {
  const { stdout } = await command("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,codec_name,r_frame_rate,duration:format=duration",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0];
  if (!stream) fail(`No video stream in ${path}`);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    codec: stream.codec_name,
    durationSeconds: Number(stream.duration ?? parsed.format?.duration),
  };
}

async function imageProbe(path) {
  const { stdout } = await command("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,codec_name",
    "-of",
    "json",
    path,
  ]);
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream) fail(`No image stream in ${path}`);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    codec: stream.codec_name,
  };
}

function cropFilter(ratio, width, height, focalX, focalY) {
  const crop = [
    `w='min(iw,ih*${ratio})'`,
    `h='min(ih,iw/${ratio})'`,
    `x='(iw-ow)*${focalX}'`,
    `y='(ih-oh)*${focalY}'`,
  ].join(":");
  return `crop=${crop},scale=${width}:${height}:flags=lanczos`;
}

async function renderDerivative(options, ratio, dimensions) {
  const videoPath = resolve(options.output, `${ratio}.mp4`);
  const posterPath = resolve(options.output, `${ratio}-poster.webp`);
  const posterFramePath = resolve(options.output, `${ratio}-poster.png`);
  const filter = cropFilter(
    dimensions.width / dimensions.height,
    dimensions.width,
    dimensions.height,
    options.focalX,
    options.focalY,
  );
  const targetBitrate = ratio === "square" ? "850k" : "1400k";
  const common = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    options.start,
    "-i",
    options.input,
    "-t",
    String(options.durationSeconds),
    "-vf",
    filter,
  ];
  await command("ffmpeg", [
    "-y",
    ...common,
    "-an",
    "-r",
    "24",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "25",
    "-maxrate",
    targetBitrate,
    "-bufsize",
    targetBitrate,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    videoPath,
  ]);
  await command("ffmpeg", [
    "-y",
    ...common,
    "-frames:v",
    "1",
    posterFramePath,
  ]);
  await command("cwebp", [
    "-quiet",
    "-q",
    "82",
    posterFramePath,
    "-o",
    posterPath,
  ]);
  await rm(posterFramePath);
  const [video, poster, videoStats, posterStats] = await Promise.all([
    probe(videoPath),
    imageProbe(posterPath),
    stat(videoPath),
    stat(posterPath),
  ]);
  if (
    video.width !== dimensions.width ||
    video.height !== dimensions.height ||
    video.codec !== "h264"
  ) {
    fail(`${ratio} video does not match the required H.264 dimensions`);
  }
  if (
    poster.width !== dimensions.width ||
    poster.height !== dimensions.height ||
    poster.codec !== "webp"
  ) {
    fail(`${ratio} poster does not match the required WebP dimensions`);
  }
  if (Math.abs(video.durationSeconds - options.durationSeconds) > 0.15) {
    fail(`${ratio} duration does not match the requested interval`);
  }
  const videoLimit = ratio === "square" ? 1_000_000 : 1_800_000;
  if (videoStats.size > videoLimit) fail(`${ratio} MP4 exceeds ${videoLimit} bytes`);
  if (posterStats.size > 150_000) fail(`${ratio} poster exceeds 150000 bytes`);
  return {
    video: {
      localPath: videoPath,
      path: basename(videoPath),
      width: video.width,
      height: video.height,
      bytes: videoStats.size,
      mime: "video/mp4",
      sha256: await sha256(videoPath),
    },
    poster: {
      localPath: posterPath,
      path: basename(posterPath),
      width: poster.width,
      height: poster.height,
      bytes: posterStats.size,
      mime: "image/webp",
      sha256: await sha256(posterPath),
    },
  };
}

async function uploadAndRegister(options, sourceSha, manifest, ffmpegVersion) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --upload");
  const database = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const prefix = `live-previews/${options.liveEventId}/${sourceSha}`;
  const publicUrls = {};
  for (const ratio of ["square", "landscape"]) {
    publicUrls[ratio] = {};
    for (const kind of ["video", "poster"]) {
      const item = manifest.derivatives[ratio][kind];
      const storagePath = `${prefix}/${item.path}`;
      const body = await readFile(item.localPath);
      const { error } = await database.storage
        .from("cms-assets")
        .upload(storagePath, body, {
          contentType: item.mime,
          upsert: false,
          cacheControl: "31536000",
          metadata: {
            sha256: item.sha256,
            width: item.width,
            height: item.height,
          },
        });
      if (error && !/already exists/i.test(error.message)) fail(error.message);
      const { data } = database.storage.from("cms-assets").getPublicUrl(storagePath);
      item.storagePath = storagePath;
      publicUrls[ratio][kind] = data.publicUrl;
    }
  }
  const { data, error } = await database.rpc("register_live_preview_draft", {
    p_live_event_id: options.liveEventId,
    p_kind: options.kind,
    p_duration_ms: Math.round(options.durationSeconds * 1000),
    p_source_sha256: sourceSha,
    p_focal: { x: options.focalX, y: options.focalY },
    p_square_video_path: manifest.derivatives.square.video.storagePath,
    p_square_video_url: publicUrls.square.video,
    p_square_poster_path: manifest.derivatives.square.poster.storagePath,
    p_square_poster_url: publicUrls.square.poster,
    p_landscape_video_path: manifest.derivatives.landscape.video.storagePath,
    p_landscape_video_url: publicUrls.landscape.video,
    p_landscape_poster_path: manifest.derivatives.landscape.poster.storagePath,
    p_landscape_poster_url: publicUrls.landscape.poster,
    p_derivative_manifest: manifest.derivatives,
    p_ffmpeg_version: ffmpegVersion,
    p_rights_holder: options.rightsHolder,
    p_rights_basis: options.rightsBasis,
    p_source_reference: options.sourceReference,
    p_processed_at: manifest.processedAt,
    p_correlation_id: randomUUID(),
  });
  if (error) fail(error.message);
  return String(data);
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const inputStats = await stat(options.input);
  if (!inputStats.isFile()) fail("--input must be a file");
  await mkdir(options.output, { recursive: true });
  const sourceSha = await sha256(options.input);
  const { stdout: ffmpegVersionOutput } = await command("ffmpeg", ["-version"]);
  const ffmpegVersion = ffmpegVersionOutput.split("\n")[0].trim();
  const [square, landscape] = await Promise.all([
    renderDerivative(options, "square", { width: 720, height: 720 }),
    renderDerivative(options, "landscape", { width: 1280, height: 640 }),
  ]);
  const manifest = {
    version: 1,
    liveEventId: options.liveEventId,
    kind: options.kind,
    durationMs: Math.round(options.durationSeconds * 1000),
    sourceSha256: sourceSha,
    focal: { x: options.focalX, y: options.focalY },
    ffmpegVersion,
    rights: {
      holder: options.rightsHolder,
      basis: options.rightsBasis,
      sourceReference: options.sourceReference,
    },
    processedAt: new Date().toISOString(),
    derivatives: { square, landscape },
  };
  const serializable = JSON.parse(
    JSON.stringify(manifest, (key, value) =>
      key === "localPath" ? undefined : value,
    ),
  );
  await writeFile(
    resolve(options.output, "manifest.json"),
    `${JSON.stringify(serializable, null, 2)}\n`,
    { flag: "wx" },
  );
  const previewId = options.upload
    ? await uploadAndRegister(options, sourceSha, manifest, ffmpegVersion)
    : null;
  process.stdout.write(
    `${JSON.stringify({ output: options.output, sourceSha256: sourceSha, previewId }, null, 2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

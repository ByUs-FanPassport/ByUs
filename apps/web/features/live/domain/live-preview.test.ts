import { describe, expect, it } from "vitest";

import {
  buildLivePreviewStoragePrefix,
  livePreviewDraftSchema,
} from "./live-preview";

const draft = {
  liveEventId: "819b52d9-62c3-450c-b3dc-78d84d2238c6",
  kind: "artist_teaser",
  durationMs: 4_000,
  sourceSha256: "a".repeat(64),
  focal: { x: 0.5, y: 0.42 },
  rights: {
    holder: "Sallylab Inc.",
    basis: "Owned production footage",
    sourceReference: "asset-library://katseye/short-01",
  },
  derivatives: {
    square: {
      video: { path: "square.mp4", width: 720, height: 720, bytes: 900_000, mime: "video/mp4" },
      poster: { path: "square-poster.webp", width: 720, height: 720, bytes: 120_000, mime: "image/webp" },
    },
    landscape: {
      video: { path: "landscape.mp4", width: 1280, height: 640, bytes: 1_600_000, mime: "video/mp4" },
      poster: { path: "landscape-poster.webp", width: 1280, height: 640, bytes: 140_000, mime: "image/webp" },
    },
  },
};

describe("live preview draft contract", () => {
  it("accepts the exact derivative and rights manifest", () => {
    expect(livePreviewDraftSchema.parse(draft).kind).toBe("artist_teaser");
  });

  it("rejects invalid aspect ratios, missing rights, and source hashes", () => {
    expect(() =>
      livePreviewDraftSchema.parse({
        ...draft,
        sourceSha256: "abc",
      }),
    ).toThrow();
    expect(() =>
      livePreviewDraftSchema.parse({
        ...draft,
        rights: { ...draft.rights, basis: "" },
      }),
    ).toThrow();
    expect(() =>
      livePreviewDraftSchema.parse({
        ...draft,
        derivatives: {
          ...draft.derivatives,
          landscape: {
            ...draft.derivatives.landscape,
            video: {
              ...draft.derivatives.landscape.video,
              height: 720,
            },
          },
        },
      }),
    ).toThrow();
  });

  it("uses a content-addressed Storage prefix", () => {
    expect(
      buildLivePreviewStoragePrefix(
        draft.liveEventId,
        draft.sourceSha256,
      ),
    ).toBe(
      `live-previews/${draft.liveEventId}/${draft.sourceSha256}`,
    );
  });
});

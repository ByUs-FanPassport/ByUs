import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { File as UndiciFile } from "node:buffer";
import { FormData as UndiciFormData, Headers as UndiciHeaders, Request as UndiciRequest, Response as UndiciResponse } from "undici";
vi.mock("server-only", () => ({}));
import type { CertificationDependencies } from "./certification-dependencies";
import { certificationRoutes } from "./certification-routes";
import sharp from "sharp";
import { MAX_CERTIFICATION_MULTIPART_BYTES } from "./certification-image";

const owner = "11111111-1111-4111-8111-111111111111";
const mission = "22222222-2222-4222-8222-222222222222";
const idem = "33333333-3333-4333-8333-333333333333";
const browserFile=globalThis.File;
const browserFormData=globalThis.FormData;
const browserHeaders=globalThis.Headers;
const browserRequest=globalThis.Request;
const browserResponse=globalThis.Response;
beforeAll(()=>{Object.assign(globalThis,{File:UndiciFile,FormData:UndiciFormData,Headers:UndiciHeaders,Request:UndiciRequest,Response:UndiciResponse});});
afterAll(()=>{Object.assign(globalThis,{File:browserFile,FormData:browserFormData,Headers:browserHeaders,Request:browserRequest,Response:browserResponse});});
function deps(
  overrides: Record<string, unknown> = {},
): CertificationDependencies {
  return {
    authorizeFan: vi.fn(async () => ({ appUserId: owner })),
    authorizeAdmin: vi.fn(async () => ({
      appUserId: owner,
      allowlistId: idem,
      email: "admin@example.com",
      role: "admin",
    })),
    repository: {
      listPublic: vi.fn(async () => []),
      submit: vi.fn(async () => ({
        id: mission,
        status: "pending",
        revision: 1,
      })),
      ...overrides,
    },
  } as unknown as CertificationDependencies;
}

describe("certification routes", () => {
  it("returns only the public certification projection with cacheable headers", async () => {
    const dependencies = deps();
    const response = await certificationRoutes.publicList(dependencies)(
      new Request(
        "https://byus.kr/api/celebrities/kara/certifications?locale=ko",
      ),
      { slug: "kara" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ certifications: [] });
    expect(response.headers.get("cache-control")).toContain("public");
  });
  it("requires the existing fan authorization boundary before submission", async () => {
    const dependencies = deps();
    const response = await certificationRoutes.submit(dependencies)(
      new Request("https://byus.kr/api/certification-submissions", {
        method: "POST",
        headers: {
          authorization: "Bearer fan",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          missionId: mission,
          idem,
          uploadIds: ["44444444-4444-4444-8444-444444444444"],
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(dependencies.authorizeFan).toHaveBeenCalledWith("Bearer fan");
    expect(dependencies.repository.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        appUserId: owner,
        missionId: mission,
        idempotencyKey: idem,
      }),
    );
  });
  it("rejects duplicate upload IDs before repository mutation", async () => {
    const dependencies = deps();
    const upload = "44444444-4444-4444-8444-444444444444";
    const response = await certificationRoutes.submit(dependencies)(
      new Request("https://byus.kr/api/certification-submissions", {
        method: "POST",
        headers: {
          authorization: "Bearer fan",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          missionId: mission,
          idem,
          uploadIds: [upload, upload],
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(dependencies.repository.submit).not.toHaveBeenCalled();
  });
  it("rejects a submission without proof uploads before repository mutation", async () => {
    const dependencies = deps();
    const response = await certificationRoutes.submit(dependencies)(
      new Request("https://byus.kr/api/certification-submissions", {
        method: "POST",
        headers: {
          authorization: "Bearer fan",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          missionId: mission,
          idem,
          uploadIds: [],
          note: "설명만으로는 제출할 수 없습니다.",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(dependencies.repository.submit).not.toHaveBeenCalled();
  });
  it("bounds JSON from streamed bytes before parsing", async () => {
    const dependencies = deps();
    const response = await certificationRoutes.submit(dependencies)(
      new Request("https://byus.kr/api/certification-submissions", {
        method: "POST",
        headers: { authorization: "Bearer fan", "content-type": "application/json" },
        body: new Uint8Array(16_385),
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: "BODY_TOO_LARGE" } });
    expect(dependencies.repository.submit).not.toHaveBeenCalled();
  });
  it("requires a rejection reason and an admin session", async () => {
    const dependencies = deps();
    const response = await certificationRoutes.adminReview(dependencies)(
      new Request(
        `https://byus.kr/api/admin/certification-submissions/${mission}/review`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer admin",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            idem,
            expectedRevision: 1,
            decision: "reject",
          }),
        },
      ),
      { id: mission },
    );
    expect(response.status).toBe(400);
    expect(dependencies.authorizeAdmin).toHaveBeenCalled();
  });
  it("authorizes the owner and normalizes one proof file before storage", async () => {
    const upload = vi.fn(async () => ({
      uploadId: idem,
      expiresAt: "2026-09-09T00:00:00.000Z",
    }));
    const dependencies = deps({ upload });
    const png = await sharp({
      create: { width: 8, height: 6, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const file = new File([png], "proof.png", { type: "image/png" });
    const form = new FormData();
    form.set("file", file);
    const request = new Request(`https://byus.kr/api/certifications/${mission}/uploads`, {
      method: "POST", headers: { authorization: "Bearer fan" }, body: form,
    });
    const response = await certificationRoutes.upload(dependencies)(request, {
      id: mission,
    });
    expect(response.status).toBe(201);
    expect(dependencies.authorizeFan).toHaveBeenCalledWith("Bearer fan");
    expect(upload).toHaveBeenCalledWith(
      owner,
      mission,
      expect.objectContaining({ width: 8, height: 6 }),
    );
  });
  it("rejects an oversized multipart stream before formData parsing", async () => {
    const dependencies = deps({ upload: vi.fn() });
    const chunk = new Uint8Array(Math.floor(MAX_CERTIFICATION_MULTIPART_BYTES / 2) + 1);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); controller.close(); } });
    const request = new Request(`https://byus.kr/api/certifications/${mission}/uploads`, {
      method: "POST", headers: { authorization: "Bearer fan", "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half",
    } as RequestInit);
    const formData = vi.spyOn(request, "formData");
    const response = await certificationRoutes.upload(dependencies)(request, { id: mission });
    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(dependencies.repository.upload).not.toHaveBeenCalled();
  });
  it("accepts only one file field in multipart uploads", async () => {
    const dependencies = deps({ upload: vi.fn() });
    for (const extra of ["field", "file"] as const) {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1])], "proof.png", { type: "image/png" }));
      if (extra === "field") form.set("unexpected", "value");
      else form.append("file", new File([new Uint8Array([2])], "second.png", { type: "image/png" }));
      const response = await certificationRoutes.upload(dependencies)(
        new Request(`https://byus.kr/api/certifications/${mission}/uploads`, { method: "POST", headers: { authorization: "Bearer fan" }, body: form }),
        { id: mission },
      );
      expect(response.status).toBe(400);
    }
    expect(dependencies.repository.upload).not.toHaveBeenCalled();
  });
  it("requires draft update id and expectedRevision together", async () => {
    const saveAdmin = vi.fn();
    const dependencies = deps({ saveAdmin });
    const base = { command:"save",celebrityId:mission,immutableKey:"contract-mission",category:"기타",titleKo:"제목",titleEn:"Title",descriptionKo:"설명",descriptionEn:"Description",instructionsKo:"지침",instructionsEn:"Instructions",opensAt:"2026-09-08T00:00:00+09:00",closesAt:"2026-09-09T00:00:00+09:00",scorePoints:0,ticketAmount:0 };
    for (const partial of [{ ...base, id: mission }, { ...base, expectedRevision: 1 }]) {
      const response = await certificationRoutes.adminMissions(dependencies)(new Request("https://byus.kr/api/admin/certification-missions", { method:"POST",headers:{authorization:"Bearer admin","content-type":"application/json"},body:JSON.stringify(partial) }));
      expect(response.status).toBe(400);
    }
    expect(saveAdmin).not.toHaveBeenCalled();
  });
  it("streams an owner-bound proof with private no-store headers", async () => {
    const proofForOwner = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      contentType: "image/webp",
    }));
    const dependencies = deps({ proofForOwner });
    const response = await certificationRoutes.ownerProof(dependencies)(
      new Request(
        `https://byus.kr/api/certification-submissions/${mission}/proofs/${idem}`,
        { headers: { authorization: "Bearer fan" } },
      ),
      { id: mission, uploadId: idem },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(proofForOwner).toHaveBeenCalledWith(owner, mission, idem);
  });
  it("passes the expected revision and audit actor into an approval", async () => {
    const reviewAdmin = vi.fn(async () => ({
      id: mission,
      status: "approved",
      revision: 2,
    }));
    const dependencies = deps({ reviewAdmin });
    const response = await certificationRoutes.adminReview(dependencies)(
      new Request(
        `https://byus.kr/api/admin/certification-submissions/${mission}/review`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer admin",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            idem,
            expectedRevision: 1,
            decision: "approve",
          }),
        },
      ),
      { id: mission },
    );
    expect(response.status).toBe(200);
    expect(reviewAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ appUserId: owner, allowlistId: idem }),
      expect.any(String),
      mission,
      { idem, expectedRevision: 1, decision: "approve" },
    );
  });
});

const membershipMission = {
  command: "save",
  celebrityId: owner,
  immutableKey: "membership-instagram",
  membershipPlatform: "instagram",
  category: "멤버십 인증",
  titleKo: "Instagram 멤버십 인증",
  titleEn: "Instagram membership verification",
  descriptionKo: "유료 멤버십을 인증해 주세요.",
  descriptionEn: "Verify your paid creator membership.",
  instructionsKo: "크리에이터와 본인 계정, 멤버십 상태와 유효기간이 보이게 캡처해 주세요.",
  instructionsEn: "Show the creator, your account, current membership status and validity.",
  opensAt: "2026-09-11T00:00:00.000Z",
  closesAt: "2027-09-11T00:00:00.000Z",
  scorePoints: 1,
  ticketAmount: 0,
};

describe("membership certification boundary", () => {
  it.each(["instagram", "tiktok", "youtube"])("accepts configured %s membership rewards after admin authorization", async (membershipPlatform) => {
    const saveAdmin = vi.fn(async () => ({ id: mission, revision: 1, status: "draft" }));
    const dependencies = deps({ saveAdmin });
    const response = await certificationRoutes.adminMissions(dependencies)(new Request("https://byus.kr/api/admin/certification-missions", {
      method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ ...membershipMission, membershipPlatform }),
    }));
    expect(response.status).toBe(200);
    expect(dependencies.authorizeAdmin).toHaveBeenCalled();
    expect(saveAdmin).toHaveBeenCalledWith(expect.objectContaining({ appUserId: owner }), expect.any(String), expect.objectContaining({ membershipPlatform, scorePoints: 1, ticketAmount: 0 }));
  });

  it.each([{ scorePoints: 0 }, { ticketAmount: 1 }, { membershipPlatform: "chzzk" }, { membershipPlatform: "unsupported" }])("rejects invalid membership configuration %j before mutation", async (override) => {
    const saveAdmin = vi.fn();
    const response = await certificationRoutes.adminMissions(deps({ saveAdmin }))(new Request("https://byus.kr/api/admin/certification-missions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...membershipMission, ...override }),
    }));
    expect(response.status).toBe(400);
    expect(saveAdmin).not.toHaveBeenCalled();
  });

  it.each([{ membershipPlatform: "instagram" }, { scorePoints: 100 }, { stampCount: 1 }, { status: "approved" }])("does not allow fans to supply reward or review facts %j", async (override) => {
    const dependencies = deps();
    const response = await certificationRoutes.submit(dependencies)(new Request("https://byus.kr/api/certification-submissions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId: mission, idem, uploadIds: ["44444444-4444-4444-8444-444444444444"], ...override }),
    }));
    expect(response.status).toBe(400);
    expect(dependencies.repository.submit).not.toHaveBeenCalled();
  });
});

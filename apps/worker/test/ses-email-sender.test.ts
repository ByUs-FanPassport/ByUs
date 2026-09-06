import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";
import {
  ExternalNotificationError,
  type ExternalNotificationJob,
} from "../src/external-notification-domain.js";
import {
  SesEmailSender,
  type SesV2SendClient,
} from "../src/adapters/ses-email-sender.js";

const job: ExternalNotificationJob = {
  id: "delivery",
  notificationId: "notification",
  planId: "plan",
  channel: "email",
  sequence: 1,
  templateKey: "live_reserved",
  locale: "ko",
  destination: "fan@example.com",
  payload: { title: "라이브 알림", detail: "곧 라이브가 시작됩니다.", deepLink: "/my" },
  attemptCount: 1,
  leaseOwner: "worker",
  leaseExpiresAt: "2099-01-01T00:00:00Z",
};

function mockSend() {
  return vi.fn<SesV2SendClient["send"]>();
}

function sender(send: SesV2SendClient["send"], trustedOrigin?: string) {
  return new SesEmailSender({
    region: "ap-northeast-2",
    fromEmail: "notifications@byus.kr",
    ...(trustedOrigin ? { trustedOrigin } : {}),
    client: { send },
    fetcher: vi.fn().mockResolvedValue(new Response(new Uint8Array([255,216,255,224]), {headers:{"content-type":"image/jpeg"}})),
  });
}

describe("SES email sender", () => {
  it("renders published context and resolves a local poster against ByUs", async () => {
    const send=mockSend().mockResolvedValue({MessageId:"html-mail"});
    await sender(send).send({...job,payload:{...job.payload,context:{title:"Artist <LIVE>",imageUrl:"/images/live/poster.jpg",startsAt:"2026-09-20T10:00:00Z"}}});
    const html=send.mock.calls[0]![0].input.Content!.Simple!.Body!.Html!.Data!;
    expect(html).toContain('src="cid:byus-poster"');
    expect(html).toContain("Artist &lt;LIVE&gt;");
    expect(html).not.toContain("Artist <LIVE>");
    expect(html).toContain("2026");
  });
  it("keeps delivering without an unsafe image URL", async () => {
    const send=mockSend().mockResolvedValue({MessageId:"fallback"});
    await sender(send).send({...job,payload:{...job.payload,context:{imageUrl:"javascript:alert(1)"}}});
    const html=send.mock.calls[0]![0].input.Content!.Simple!.Body!.Html!.Data!;
    expect(html).toContain('src="cid:byus-logo"');
    expect(html).not.toContain('src="cid:byus-poster"');
    expect(html).not.toContain("javascript:");
  });
  it("sends a UTF-8 HTML email with a plain text fallback and returns the SES message id", async () => {
    const send = mockSend().mockResolvedValue({ MessageId: "ses-message-id" });

    await expect(sender(send).send(job)).resolves.toEqual({
      providerMessageId: "ses-message-id",
    });
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]![0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: "notifications@byus.kr",
      Destination: { ToAddresses: ["fan@example.com"] },
      Content: {
        Simple: {
          Attachments: [expect.objectContaining({ContentId:"byus-logo",ContentDisposition:"INLINE",ContentType:"image/png"}),expect.objectContaining({ContentId:"byus-star",ContentDisposition:"INLINE"})],
          Subject: { Data: expect.stringContaining("LIVE"), Charset: "UTF-8" },
          Body: {
            Html: { Data: expect.stringContaining("LIVE"), Charset: "UTF-8" },
            Text: {
              Data: expect.stringContaining("https://byus.kr/my"),
              Charset: "UTF-8",
            },
          },
        },
      },
    });
  });

  it("accepts an absolute deep link on a configured trusted origin", async () => {
    const send = mockSend().mockResolvedValue({ MessageId: "message" });
    const configuredJob = {
      ...job,
      payload: { ...job.payload, deepLink: "https://preview.byus.kr/my?tab=live" },
    };

    await sender(send, "https://preview.byus.kr").send(configuredJob);

    expect(send.mock.calls[0]![0].input).toMatchObject({
      Content: {
        Simple: {
          Body: {
            Text: { Data: expect.stringContaining("https://preview.byus.kr/my?tab=live") },
          },
        },
      },
    });
  });

  it.each(["not-an-email", "fan@example.com\r\nBcc: attacker@example.com", ""])(
    "rejects invalid destination %j without calling SES",
    async (destination) => {
      const send = mockSend();

      await expect(sender(send).send({ ...job, destination })).rejects.toMatchObject({
        code: "EMAIL_INVALID_DESTINATION",
        retryable: false,
      });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "//evil.example/my",
    "http://byus.kr/my",
    "https://evil.example/my",
    "https://user:password@byus.kr/my",
    "javascript:alert(1)",
  ])(
    "rejects untrusted deep link %j without calling SES",
    async (deepLink) => {
      const send = mockSend();

      await expect(
        sender(send).send({ ...job, payload: { ...job.payload, deepLink } }),
      ).rejects.toMatchObject({ code: "EMAIL_INVALID_DEEP_LINK", retryable: false });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-email job without calling SES", async () => {
    const send = mockSend();

    await expect(sender(send).send({ ...job, channel: "kakao" })).rejects.toMatchObject({
      code: "EMAIL_INVALID_CHANNEL",
      retryable: false,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error("throttled"), { name: "ThrottlingException" }),
    Object.assign(new Error("rate limited"), { $metadata: { httpStatusCode: 429 } }),
    Object.assign(new Error("unavailable"), { $metadata: { httpStatusCode: 503 } }),
  ])("classifies throttling and 5xx failures as retryable", async (failure) => {
    const send = mockSend().mockRejectedValue(failure);

    await expect(sender(send).send(job)).rejects.toEqual(
      new ExternalNotificationError("EMAIL_RETRYABLE", true),
    );
  });

  it.each([
    Object.assign(new Error("address rejected"), { name: "MessageRejected" }),
    Object.assign(new Error("forbidden"), {
      name: "AccessDeniedException",
      $fault: "client",
      $metadata: { httpStatusCode: 403 },
    }),
  ])("classifies provider rejection without preserving sensitive error text", async (failure) => {
    const send = mockSend().mockRejectedValue(failure);

    const result = await sender(send).send(job).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "EMAIL_REJECTED", retryable: false });
    expect(result).not.toMatchObject({ message: failure.message });
  });

  it("fails permanently when SES omits its message id", async () => {
    const send = mockSend().mockResolvedValue({});

    await expect(sender(send).send(job)).rejects.toMatchObject({
      code: "EMAIL_INVALID_RESPONSE",
      retryable: false,
    });
  });
});

it.each(["live_24h", "live_cancelled"])("blocks excluded %s before fetching assets or calling SES",async(templateKey)=>{
 const send=mockSend();const fetcher=vi.fn();
 const client=new SesEmailSender({region:"ap-northeast-2",fromEmail:"notifications@byus.kr",client:{send},fetcher});
 await expect(client.send({...job,templateKey})).rejects.toMatchObject({retryable:false});
 expect(send).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it("uses English subject, text and HTML even when stored notification text is Korean",async()=>{
 const send=mockSend().mockResolvedValue({MessageId:"english"});
 await sender(send).send({...job,locale:"en",payload:{title:"예약 완료",detail:"한국어 상세 안내",deepLink:"/live/sample"}});
 const email=send.mock.calls[0]![0].input.Content!.Simple!;
 expect(email.Subject!.Data).not.toMatch(/[가-힣]/);expect(email.Body!.Text!.Data).not.toMatch(/[가-힣]/);expect(email.Body!.Html!.Data).not.toMatch(/[가-힣]/);
 expect(email.Body!.Text!.Data).toContain("locale=en");
});

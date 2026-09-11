import { describe, expect, it } from "vitest";
import {
  SOLAPI_APPROVED_TEMPLATES,
  SOLAPI_CHANNEL_ID,
  SOLAPI_HELD_TEMPLATE_KEYS,
  SOLAPI_PENDING_TEMPLATES,
  SOLAPI_TEMPLATE_MANIFEST_STATUS,
  SOLAPI_TEMPLATE_MANIFEST_VERSION,
} from "../src/solapi/template-manifest.js";
import { buildSolapiRequest } from "../src/solapi/template-builder.js";
import type {
  SolapiApprovalRecord,
  SolapiPendingTemplate,
  SolapiSubmitInput,
} from "../src/solapi/index.js";

const DELIVERY_ID = "018f47a2-8f4e-7c31-a1c2-12f6af3244a1";
const BENEFIT_ID = "018f47a2-8f4e-7c31-a1c2-12f6af3244a2";

function approvalFor(template: SolapiPendingTemplate): SolapiApprovalRecord {
  return {
    templateKey: template.templateKey,
    locale: "ko",
    channelId: SOLAPI_CHANNEL_ID,
    registeredTemplateId: template.pendingRegisteredTemplateId,
    verifiedAt: "2026-09-08T09:00:00+09:00",
    ...(template.fulfillmentStatus ? {fulfillmentStatus:template.fulfillmentStatus} : {}),
  };
}

function liveInput(templateKey: "live_reserved" | "live_24h" | "live_10m" | "live_changed"): SolapiSubmitInput {
  return {
    id:DELIVERY_ID,
    channel:"kakao",
    locale:"ko",
    destination:"01012345678",
    templateKey,
    startsAt:"2026-09-07T15:30:00Z",
    context:{artist:"KARA",title:"Fan Meeting"},
    deepLink:"/live/kara-fan_meeting?locale=ko",
  };
}

describe("SOLAPI reviewed template manifest", () => {
  it("tracks the 12 registrations and only the 11 verified approvals", () => {
    expect(SOLAPI_TEMPLATE_MANIFEST_VERSION).toBe("solapi-templates-ko-v2");
    expect(SOLAPI_TEMPLATE_MANIFEST_STATUS).toBe("approved_11_of_12_2026_09_11");
    expect(SOLAPI_PENDING_TEMPLATES.map((item) => item.pendingRegisteredTemplateId)).toEqual([
      "KA01TP260907033445072mn78mTsLaVg",
      "KA01TP260907034017949sLbNPkQLGBs",
      "KA01TP260907034304115ByqnnAhlCoc",
      "KA01TP260907034426918n2VAUyqbqv0",
      "KA01TP260907034513012XiUpGjJ4bQU",
      "KA01TP260907034548427ueVqEj03Jn9",
      "KA01TP260907034624117IQ9ntqowc3u",
      "KA01TP260907034658771D6kucvQvlwr",
      "KA01TP260907034727320h5IICVSvdTi",
      "KA01TP260907034757052KImeu1gLE8v",
      "KA01TP260907034829220P6ks9Ph30oV",
      "KA01TP260907034853958V7dkrlHtD8o",
    ]);
    expect(SOLAPI_APPROVED_TEMPLATES).toHaveLength(11);
    expect(SOLAPI_APPROVED_TEMPLATES.every((item) => item.verifiedAt.startsWith("2026-09-11"))).toBe(true);
    expect(SOLAPI_APPROVED_TEMPLATES).not.toContainEqual(expect.objectContaining({fulfillmentStatus:"digital_delivered"}));
    expect(SOLAPI_HELD_TEMPLATE_KEYS).toEqual(expect.arrayContaining([
      "benefit_available",
      "survey_reminder",
      "level_up",
    ]));
  });

  it("fails closed for the rejected registration, held keys, and English", () => {
    expect(() => buildSolapiRequest({
      id:DELIVERY_ID,channel:"kakao",locale:"ko",destination:"01012345678",
      templateKey:"fulfillment_meaningful_update",
      context:{artist:"KARA",title:"Digital benefit",fulfillmentStatus:"digital_delivered"},
      deepLink:`/benefits/${BENEFIT_ID}?locale=ko`,
    })).toThrowError("SOLAPI_TEMPLATE_NOT_APPROVED");
    expect(() => buildSolapiRequest({...liveInput("live_reserved"),templateKey:"survey_reminder"} as never, [])).toThrowError("SOLAPI_TEMPLATE_NOT_SUPPORTED");
    expect(() => buildSolapiRequest({...liveInput("live_reserved"),locale:"en"} as never, [])).toThrowError("SOLAPI_UNSUPPORTED_CHANNEL_OR_LOCALE");
  });

  it("builds only the exact ATA body and formats an offset instant in Seoul", () => {
    const manifest = SOLAPI_PENDING_TEMPLATES[0];
    const body = buildSolapiRequest(liveInput("live_reserved"), [approvalFor(manifest)]);
    expect(body).toEqual({
      messages:[{
        type:"ATA",
        country:"82",
        to:"01012345678",
        kakaoOptions:{
          pfId:SOLAPI_CHANNEL_ID,
          templateId:manifest.pendingRegisteredTemplateId,
          variables:{
            "#{artist}":"KARA",
            "#{title}":"Fan Meeting",
            "#{startsAt}":"2026-09-08 00:30",
            "#{liveSlug}":"kara-fan_meeting",
          },
          disableSms:true,
        },
        customFields:{deliveryKey:DELIVERY_ID},
      }],
      strict:true,
      allowDuplicates:false,
      showMessageList:true,
    });
    expect(JSON.stringify(body)).not.toMatch(/"from"|"text"|"sms"/i);
  });

  it("selects each fulfillment variant from context and derives only benefitId", () => {
    const fulfillmentTemplates = (SOLAPI_PENDING_TEMPLATES as readonly SolapiPendingTemplate[])
      .filter((entry) => entry.fulfillmentStatus);
    for (const manifest of fulfillmentTemplates) {
      const body = buildSolapiRequest({
        id:DELIVERY_ID,
        channel:"kakao",
        locale:"ko",
        destination:"01012345678",
        templateKey:"fulfillment_meaningful_update",
        context:{artist:"KARA",title:"Signed album",fulfillmentStatus:manifest.fulfillmentStatus!},
        deepLink:`https://byus.kr/benefits/${BENEFIT_ID}?locale=ko`,
      }, [approvalFor(manifest)]);
      expect(body.messages[0].kakaoOptions.templateId).toBe(manifest.pendingRegisteredTemplateId);
      expect(body.messages[0].kakaoOptions.variables).toEqual({
        "#{artist}":"KARA",
        "#{title}":"Signed album",
        "#{benefitId}":BENEFIT_ID,
      });
    }
  });

  it.each(SOLAPI_PENDING_TEMPLATES)(
    "builds the exact registered mapping for $artifactName",
    (manifest) => {
      let candidate: SolapiSubmitInput;
      if (manifest.templateKey === "fulfillment_meaningful_update") {
        candidate = {
          id:DELIVERY_ID,
          channel:"kakao",
          locale:"ko",
          destination:"01012345678",
          templateKey:"fulfillment_meaningful_update",
          context:{artist:"KARA",title:"Signed album",fulfillmentStatus:manifest.fulfillmentStatus},
          deepLink:`/benefits/${BENEFIT_ID}?locale=ko`,
        };
      } else if (manifest.templateKey === "live_cancelled") {
        candidate = {
          id:DELIVERY_ID,
          channel:"kakao",
          locale:"ko",
          destination:"01012345678",
          templateKey:"live_cancelled",
          context:{artist:"KARA",title:"Fan Meeting"},
          deepLink:"/live/kara?locale=ko",
        };
      } else if (manifest.templateKey.startsWith("live_")) {
        candidate = {
          ...liveInput(manifest.templateKey as "live_reserved" | "live_24h" | "live_10m" | "live_changed"),
        };
      } else {
        candidate = {
          id:DELIVERY_ID,
          channel:"kakao",
          locale:"ko",
          destination:"01012345678",
          templateKey:manifest.templateKey as "benefit_won" | "recipient_information_required",
          context:{artist:"KARA",title:"Signed album"},
          deepLink:`/benefits/${BENEFIT_ID}?locale=ko`,
        };
      }
      const body = buildSolapiRequest(candidate, [approvalFor(manifest)]);
      expect(body.messages[0].kakaoOptions.templateId).toBe(manifest.pendingRegisteredTemplateId);
      expect(Object.keys(body.messages[0].kakaoOptions.variables)).toEqual([...manifest.variables]);
      if (manifest.templateKey === "live_cancelled") {
        expect(body.messages[0].kakaoOptions.variables).not.toHaveProperty("#{startsAt}");
      }
    },
  );

  it.each([
    ["unnormalized destination", {...liveInput("live_reserved"),destination:"+82 10-1234-5678"}],
    ["non-UUID delivery key", {...liveInput("live_reserved"),id:"delivery-1"}],
    ["missing timezone", {...liveInput("live_reserved"),startsAt:"2026-09-07T15:30:00"}],
    ["invalid calendar date", {...liveInput("live_reserved"),startsAt:"2026-02-30T15:30:00Z"}],
    ["variable injection", {...liveInput("live_reserved"),context:{artist:"KARA #{x}",title:"Fan Meeting"}}],
    ["newline", {...liveInput("live_reserved"),context:{artist:"KARA",title:"Fan\nMeeting"}}],
    ["text tab", {...liveInput("live_reserved"),context:{artist:"KARA\tFan",title:"Fan Meeting"}}],
    ["text NUL", {...liveInput("live_reserved"),context:{artist:"KARA\u0000Fan",title:"Fan Meeting"}}],
    ["text DEL", {...liveInput("live_reserved"),context:{artist:"KARA\u007fFan",title:"Fan Meeting"}}],
    ["text C1 control", {...liveInput("live_reserved"),context:{artist:"KARA\u0085Fan",title:"Fan Meeting"}}],
    ["external host", {...liveInput("live_reserved"),deepLink:"https://evil.example/live/kara?locale=ko"}],
    ["userinfo", {...liveInput("live_reserved"),deepLink:"https://x@byus.kr/live/kara?locale=ko"}],
    ["port", {...liveInput("live_reserved"),deepLink:"https://byus.kr:443/live/kara?locale=ko"}],
    ["protocol-relative", {...liveInput("live_reserved"),deepLink:"//byus.kr/live/kara?locale=ko"}],
    ["query injection", {...liveInput("live_reserved"),deepLink:"/live/kara?locale=ko&next=evil"}],
    ["encoded slash", {...liveInput("live_reserved"),deepLink:"/live/kara%2Fother?locale=ko"}],
    ["dot path", {...liveInput("live_reserved"),deepLink:"/live/../admin?locale=ko"}],
    ["normalized-away nested dot path", {...liveInput("live_reserved"),deepLink:"/live/a/../real?locale=ko"}],
    ["encoded dot path", {...liveInput("live_reserved"),deepLink:"/live/%2e%2e/admin?locale=ko"}],
    ["deep-link control", {...liveInput("live_reserved"),deepLink:"/live/ka\u0000ra?locale=ko"}],
  ])("rejects %s", (_name, input) => {
    const approval = approvalFor(SOLAPI_PENDING_TEMPLATES[0]);
    expect(() => buildSolapiRequest(input as SolapiSubmitInput, [approval])).toThrow();
  });

  it("requires an approval record matching key, locale, channel, registration, status, and verification time", () => {
    const manifest = SOLAPI_PENDING_TEMPLATES[0];
    const valid = approvalFor(manifest);
    for (const invalid of [
      {...valid,templateKey:"live_24h" as const},
      {...valid,channelId:"KA01PFwrong"},
      {...valid,registeredTemplateId:"KA01TPwrong"},
      {...valid,verifiedAt:"not-a-date"},
      {...valid,locale:"en" as never},
    ]) {
      expect(() => buildSolapiRequest(liveInput("live_reserved"), [invalid])).toThrowError("SOLAPI_TEMPLATE_NOT_APPROVED");
    }
  });
});

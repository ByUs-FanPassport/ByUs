export type SolapiLocale = "ko";

export type SolapiFulfillmentStatus =
  | "shipping_in_transit"
  | "shipping_completed"
  | "pickup_available"
  | "pickup_completed"
  | "digital_delivered";

export type SolapiTemplateKey =
  | "live_reserved"
  | "live_24h"
  | "live_10m"
  | "live_changed"
  | "live_cancelled"
  | "benefit_won"
  | "recipient_information_required"
  | "fulfillment_meaningful_update";

export interface SolapiApprovalRecord {
  templateKey: SolapiTemplateKey;
  locale: SolapiLocale;
  channelId: string;
  registeredTemplateId: string;
  verifiedAt: string;
  fulfillmentStatus?: SolapiFulfillmentStatus;
}

interface SolapiSubmitBase {
  id: string;
  channel: "kakao";
  locale: SolapiLocale;
  destination: string;
  context: {
    artist: string;
    title: string;
  };
  deepLink: string;
}

export type SolapiSubmitInput =
  | (SolapiSubmitBase & {
      templateKey: "live_reserved" | "live_24h" | "live_10m" | "live_changed";
      startsAt: string;
    })
  | (SolapiSubmitBase & {
      templateKey: "live_cancelled";
      startsAt?: never;
    })
  | (SolapiSubmitBase & {
      templateKey: "benefit_won" | "recipient_information_required";
      startsAt?: never;
    })
  | (SolapiSubmitBase & {
      templateKey: "fulfillment_meaningful_update";
      startsAt?: never;
      context: SolapiSubmitBase["context"] & {
        fulfillmentStatus: SolapiFulfillmentStatus;
      };
    });

export interface SolapiPreparedRequest {
  messages: [
    {
      type: "ATA";
      country: "82";
      to: string;
      kakaoOptions: {
        pfId: string;
        templateId: string;
        variables: Record<string, string>;
        disableSms: true;
      };
      customFields: {
        deliveryKey: string;
      };
    },
  ];
  strict: true;
  allowDuplicates: false;
  showMessageList: true;
}

export type SolapiSubmitResult =
  | {
      status: "accepted";
      receipt: {
        providerMessageId: string;
        groupId: string;
      };
    }
  | {
      status: "rejected";
      code: "SOLAPI_PROVIDER_REJECTED";
    }
  | {
      status: "unknown";
      code:
        | "SOLAPI_INVALID_CONFIGURATION"
        | "SOLAPI_REQUEST_TIMEOUT"
        | "SOLAPI_NETWORK_UNKNOWN"
        | "SOLAPI_RATE_LIMIT_UNKNOWN"
        | "SOLAPI_SERVER_UNKNOWN"
        | "SOLAPI_HTTP_UNKNOWN"
        | "SOLAPI_RESPONSE_UNKNOWN";
      reconciliation: "DO_NOT_RESEND_OR_FALL_BACK_PENDING_MANUAL_RECONCILIATION";
    };

export interface SolapiCorrelation {
  providerMessageId: string;
  groupId: string;
  deliveryKey: string;
  destinationFingerprint: string;
  channelId: string;
  templateId: string;
}

export type SolapiLookupResult =
  | { status: "delivered"; statusCode: "4000" }
  | { status: "failed"; statusCode: string }
  | { status: "pending"; statusCode: string | null }
  | { status: "unknown"; statusCode: null };

export class SolapiValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SolapiValidationError";
  }
}

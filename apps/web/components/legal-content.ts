import type { FanLocale } from "./fan-shell/fan-app-shell";

export type LegalDocumentId = "privacy" | "terms";

export type LegalSection = {
  heading: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
  contact?: {
    before: string;
    email: "biz@sallylab.io";
    after?: string;
  };
};

export type LegalDocumentContent = {
  metadataTitle: string;
  metadataDescription: string;
  title: string;
  description: string;
  sections: readonly LegalSection[];
};

export const legalLabels = {
  ko: {
    notice: "ByUs 법적 고지",
    effectiveDate: "시행일: 2026년 7월 25일",
    home: "홈",
    homeAriaLabel: "홈으로 돌아가기",
    languageAriaLabel: "언어 선택, 현재 한국어",
  },
  en: {
    notice: "ByUs Legal Notice",
    effectiveDate: "Effective date: July 25, 2026",
    home: "Home",
    homeAriaLabel: "Return home",
    languageAriaLabel: "Choose language, currently English",
  },
} as const satisfies Record<FanLocale, Record<string, string>>;

export const legalDocuments = {
  privacy: {
    ko: {
      metadataTitle: "개인정보처리방침 | ByUs",
      metadataDescription: "ByUs 개인정보처리방침",
      title: "개인정보처리방침",
      description: "Sallylab Inc.는 ByUs를 이용하는 팬의 개인정보를 필요한 범위에서만 처리하고 안전하게 보호하기 위해 다음과 같이 개인정보처리방침을 안내합니다.",
      sections: [
        {
          heading: "1. 처리하는 개인정보",
          paragraphs: ["회사는 회원가입과 서비스 제공 과정에서 다음 정보를 처리할 수 있습니다."],
          items: [
            "Google 및 Privy 인증 식별자, 인증된 이메일 주소",
            "닉네임, Embedded Wallet 주소와 체인 식별 정보",
            "팬 인증 참여와 결과, Fan Passport 및 Stamp 발급·상태 정보",
            "LIVE 예약·출석·설문 참여 정보",
            "혜택 신청·수령·사용 상태와 알림 설정·구독 정보",
            "서비스 이용 과정에서 생성되는 접속 기록, 오류 및 보안 이벤트",
          ],
        },
        {
          heading: "2. 처리 목적",
          items: [
            "회원 식별, 로그인 유지 및 계정 보호",
            "팬 인증, Passport·Stamp 발급과 소유자 확인",
            "LIVE 예약·출석·설문 및 혜택 제공",
            "알림 발송, 문의 대응과 서비스 품질 개선",
            "부정 이용 방지, 보안 사고 대응과 법적 의무 이행",
          ],
        },
        {
          heading: "3. 보유 및 이용 기간",
          paragraphs: ["개인정보는 서비스 제공과 계정 유지에 필요한 기간 동안 보유하며, 처리 목적이 달성되거나 이용자가 삭제를 요청한 경우 지체 없이 파기합니다. 다만 관계 법령에서 일정 기간 보관을 요구하거나 분쟁·보안 대응을 위해 필요한 경우에는 해당 목적에 필요한 범위와 기간 동안 분리하여 보관할 수 있습니다."],
        },
        {
          heading: "4. 외부 서비스 이용",
          paragraphs: ["회사는 로그인과 Embedded Wallet 제공을 위해 Google 및 Privy의 인증·지갑 서비스를 이용합니다. 각 서비스 제공자는 인증 과정에서 필요한 식별 정보와 기술 정보를 자체 정책에 따라 처리할 수 있습니다. 회사는 서비스 제공에 필요한 범위를 넘어 개인정보를 판매하지 않습니다."],
        },
        {
          heading: "5. 이용자의 권리",
          paragraphs: ["이용자는 자신의 개인정보에 대한 열람, 정정, 삭제, 처리 정지 및 동의 철회를 요청할 수 있습니다. 요청은 아래 이메일로 접수할 수 있으며, 회사는 본인 확인 후 관계 법령에 따라 처리합니다."],
        },
        {
          heading: "6. 안전성 확보 조치",
          paragraphs: ["회사는 인증 정보의 서버 검증, 권한에 따른 접근 통제, 민감 정보의 비공개 처리, 운영 기록의 제한과 점검 등 개인정보 보호에 필요한 기술적·관리적 조치를 적용합니다."],
        },
        {
          heading: "7. 문의처",
          contact: {
            before: "개인정보 보호와 관련한 문의 및 권리 행사는 Sallylab Inc.의 개인정보 담당 창구 ",
            email: "biz@sallylab.io",
            after: "로 보내 주세요.",
          },
        },
        {
          heading: "8. 방침의 변경",
          paragraphs: ["법령이나 서비스 내용이 변경되어 본 방침을 수정하는 경우, 시행 전에 ByUs 서비스 내에서 변경 내용과 시행일을 안내합니다."],
        },
      ],
    },
    en: {
      metadataTitle: "Privacy Policy | ByUs",
      metadataDescription: "ByUs Privacy Policy",
      title: "Privacy Policy",
      description: "Sallylab Inc. provides this Privacy Policy to explain how we process only the personal information necessary to operate ByUs and how we protect it securely.",
      sections: [
        {
          heading: "1. Personal Information We Process",
          paragraphs: ["We may process the following information when you create an account and use the service."],
          items: [
            "Google and Privy authentication identifiers and your verified email address",
            "Nickname, Embedded Wallet address, and blockchain network identifiers",
            "Fan verification participation and results, and Fan Passport and Stamp issuance and status information",
            "LIVE reservations, attendance, and survey participation information",
            "Benefit application, receipt, and usage status, and notification settings and subscription information",
            "Access logs, errors, and security events generated while you use the service",
          ],
        },
        {
          heading: "2. Purposes of Processing",
          items: [
            "Identifying members, maintaining login sessions, and protecting accounts",
            "Providing fan verification, issuing Passports and Stamps, and confirming ownership",
            "Providing LIVE reservations, attendance, surveys, and benefits",
            "Sending notifications, responding to inquiries, and improving service quality",
            "Preventing misuse, responding to security incidents, and complying with legal obligations",
          ],
        },
        {
          heading: "3. Retention and Use Period",
          paragraphs: ["We retain personal information for as long as necessary to provide the service and maintain your account. We delete it without undue delay when the purpose of processing has been fulfilled or when you request deletion. If applicable laws require retention for a certain period, or if information is needed to resolve a dispute or respond to a security incident, we may store it separately for the scope and period necessary for that purpose."],
        },
        {
          heading: "4. Use of External Services",
          paragraphs: ["We use Google and Privy authentication and wallet services to provide login and Embedded Wallet functionality. Each provider may process identifiers and technical information required for authentication under its own policies. We do not sell personal information beyond what is necessary to provide the service."],
        },
        {
          heading: "5. Your Rights",
          paragraphs: ["You may request access to, correction or deletion of, restriction of processing of, or withdrawal of consent for your personal information. You may submit a request using the email address below. After verifying your identity, we will process the request in accordance with applicable laws."],
        },
        {
          heading: "6. Security Measures",
          paragraphs: ["We apply technical and administrative measures necessary to protect personal information, including server-side verification of authentication information, role-based access controls, non-public handling of sensitive information, and restricted access to and review of operational records."],
        },
        {
          heading: "7. Contact",
          contact: {
            before: "For privacy inquiries or requests to exercise your rights, contact the Sallylab Inc. privacy team at ",
            email: "biz@sallylab.io",
            after: ".",
          },
        },
        {
          heading: "8. Changes to This Policy",
          paragraphs: ["If we revise this Policy because of changes to applicable laws or the service, we will provide notice of the changes and their effective date through the ByUs service before the revised Policy takes effect."],
        },
      ],
    },
  },
  terms: {
    ko: {
      metadataTitle: "이용약관 | ByUs",
      metadataDescription: "ByUs 서비스 이용약관",
      title: "이용약관",
      description: "이 약관은 Sallylab Inc.가 제공하는 ByUs 서비스의 이용 조건과 회사 및 이용자의 권리와 책임을 정합니다.",
      sections: [
        {
          heading: "1. 약관의 목적과 적용",
          paragraphs: ["이 약관은 ByUs 웹·앱과 이에 연결된 팬 인증, LIVE 참여, Fan Passport, Stamp, 혜택 및 알림 기능에 적용됩니다. 이용자가 Google 로그인을 완료하고 서비스를 사용하면 이 약관과 개인정보처리방침에 동의한 것으로 봅니다."],
        },
        {
          heading: "2. 계정과 인증",
          items: [
            "이용자는 본인이 사용할 권한이 있는 Google 계정으로 로그인해야 합니다.",
            "계정과 인증 수단을 안전하게 관리할 책임은 이용자에게 있습니다.",
            "부정 이용이나 보안 위험이 확인되면 회사는 계정 보호를 위해 이용을 제한하거나 추가 확인을 요청할 수 있습니다.",
          ],
        },
        {
          heading: "3. 팬 인증과 디지털 기록",
          paragraphs: ["팬 인증 결과, Fan Passport와 Stamp는 ByUs 안에서 팬 활동을 기록하고 관련 기능을 제공하기 위한 디지털 기록입니다. 별도의 명시가 없는 한 현금, 증권, 투자 상품 또는 회사에 대한 권리를 의미하지 않습니다."],
        },
        {
          heading: "4. LIVE와 혜택",
          paragraphs: ["LIVE 일정, 예약, 출석 방식과 혜택의 수량·조건·기간은 각 화면에 표시된 안내를 따릅니다. 셀럽, 브랜드 또는 운영상 사유로 일정이나 제공 조건이 변경될 수 있으며, 회사는 가능한 범위에서 변경 내용을 안내합니다."],
        },
        {
          heading: "5. 금지 행위",
          items: [
            "타인의 계정, 인증 정보 또는 혜택을 도용하거나 거래하는 행위",
            "자동화 도구, 비정상적인 요청 또는 기술적 우회로 서비스 운영을 방해하는 행위",
            "팬 인증과 참여 결과를 조작하거나 허위 정보를 제출하는 행위",
            "다른 이용자, 셀럽, 브랜드 또는 회사의 권리를 침해하는 행위",
            "관계 법령 또는 공공질서에 위반되는 행위",
          ],
        },
        {
          heading: "6. 서비스 변경과 중단",
          paragraphs: ["회사는 서비스 개선, 보안, 점검, 제휴 관계 또는 불가피한 운영 사유에 따라 기능을 변경하거나 일시 중단할 수 있습니다. 이용자에게 중대한 영향을 주는 변경은 합리적인 방법으로 사전에 안내하되, 긴급한 보안 대응 등 사전 안내가 어려운 경우에는 사후 안내할 수 있습니다."],
        },
        {
          heading: "7. 책임의 범위",
          paragraphs: ["회사는 고의 또는 중대한 과실이 없는 한 천재지변, 통신 장애, 외부 인증·지갑·네트워크 서비스의 장애 또는 이용자의 귀책 사유로 발생한 손해에 책임을 지지 않습니다. 관계 법령상 제한할 수 없는 책임은 이 조항의 영향을 받지 않습니다."],
        },
        {
          heading: "8. 준거법과 관할",
          paragraphs: ["이 약관은 대한민국 법률에 따라 해석됩니다. 서비스 이용과 관련한 분쟁은 당사자 간 협의를 우선하며, 해결되지 않는 경우 대한민국 민사소송법상 관할 법원을 제1심 전속 관할 법원으로 합니다."],
        },
        {
          heading: "9. 문의",
          contact: {
            before: "서비스 또는 약관에 관한 문의는 Sallylab Inc.의 ",
            email: "biz@sallylab.io",
            after: "로 보내 주세요.",
          },
        },
      ],
    },
    en: {
      metadataTitle: "Terms of Use | ByUs",
      metadataDescription: "ByUs Terms of Use",
      title: "Terms of Use",
      description: "These Terms of Use set out the conditions for using the ByUs service provided by Sallylab Inc. and the rights and responsibilities of the company and its users.",
      sections: [
        {
          heading: "1. Purpose and Scope",
          paragraphs: ["These Terms apply to the ByUs web and app services and their connected fan verification, LIVE participation, Fan Passport, Stamp, benefit, and notification features. By completing Google login and using the service, you agree to these Terms and the Privacy Policy."],
        },
        {
          heading: "2. Accounts and Authentication",
          items: [
            "You must sign in with a Google account that you are authorized to use.",
            "You are responsible for keeping your account and authentication methods secure.",
            "If misuse or a security risk is identified, we may restrict access or request additional verification to protect your account.",
          ],
        },
        {
          heading: "3. Fan Verification and Digital Records",
          paragraphs: ["Fan verification results, Fan Passports, and Stamps are digital records used to record fan activities and provide related features within ByUs. Unless expressly stated otherwise, they do not represent cash, securities, investment products, or rights in the company."],
        },
        {
          heading: "4. LIVE and Benefits",
          paragraphs: ["LIVE schedules, reservation and attendance methods, and the quantity, conditions, and availability period of benefits are governed by the information displayed on the relevant screen. Schedules or availability conditions may change for reasons related to a celebrity, brand, or service operations, and we will provide notice of changes where reasonably possible."],
        },
        {
          heading: "5. Prohibited Conduct",
          items: [
            "Using or trading another person's account, authentication information, or benefits without authorization",
            "Disrupting the service through automated tools, abnormal requests, or technical circumvention",
            "Manipulating fan verification or participation results, or submitting false information",
            "Infringing the rights of another user, celebrity, brand, or the company",
            "Violating applicable laws or public order",
          ],
        },
        {
          heading: "6. Changes to and Suspension of the Service",
          paragraphs: ["We may change or temporarily suspend features to improve the service, maintain security, perform maintenance, manage partnership arrangements, or address unavoidable operational circumstances. We will provide reasonable advance notice of changes that materially affect users. If advance notice is impracticable, such as during an urgent security response, we may provide notice afterward."],
        },
        {
          heading: "7. Limitation of Liability",
          paragraphs: ["Except in cases of willful misconduct or gross negligence, we are not liable for loss arising from natural disasters, communication failures, outages of external authentication, wallet, or network services, or causes attributable to the user. Nothing in this section limits liability that cannot be limited under applicable law."],
        },
        {
          heading: "8. Governing Law and Jurisdiction",
          paragraphs: ["These Terms are governed by and construed in accordance with the laws of the Republic of Korea. The parties will first attempt to resolve any dispute relating to the service through consultation. If a dispute remains unresolved, the court having jurisdiction under the Civil Procedure Act of the Republic of Korea will have exclusive jurisdiction as the court of first instance."],
        },
        {
          heading: "9. Contact",
          contact: {
            before: "For questions about the service or these Terms, contact Sallylab Inc. at ",
            email: "biz@sallylab.io",
            after: ".",
          },
        },
      ],
    },
  },
} as const satisfies Record<LegalDocumentId, Record<FanLocale, LegalDocumentContent>>;

export function resolveLegalLocale(value: string | string[] | undefined): FanLocale {
  return value === "en" ? "en" : "ko";
}

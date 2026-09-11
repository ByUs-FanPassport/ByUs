import type { FanLocale } from "../fan-shell/fan-app-shell";

export type ServiceGuideContent = {
  metadataTitle: string;
  metadataDescription: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: string;
  secondaryAction: string;
  overviewTitle: string;
  overviewDescription: string;
  steps: readonly {
    number: string;
    title: string;
    description: string;
  }[];
  passportTitle: string;
  passportDescription: string;
  passportPoints: readonly string[];
  faqTitle: string;
  faqs: readonly {
    question: string;
    answer: string;
  }[];
  contactTitle: string;
  contactDescription: string;
  contactAction: string;
};

export const serviceGuideContent = {
  ko: {
    metadataTitle: "이용 가이드와 자주 묻는 질문",
    metadataDescription: "팬 인증, Fan Passport, LIVE 예약·출석, 선물 응모를 이용하는 방법과 자주 묻는 질문을 확인하세요.",
    eyebrow: "BYUS GUIDE",
    title: "팬 활동을 시작하는 방법",
    description: "최애를 찾고 팬 인증을 완료한 뒤, LIVE와 혜택에 참여할 수 있어요. 각 활동의 조건과 기간은 해당 화면에서 확인해 주세요.",
    primaryAction: "최애 찾기",
    secondaryAction: "LIVE 일정 보기",
    overviewTitle: "ByUs 참여 순서",
    overviewDescription: "팬 인증, 예약, 출석, 선물 응모는 각각 확인하고 완료해야 하는 별도 단계예요.",
    steps: [
      { number: "01", title: "최애를 찾고 팬 인증하기", description: "최애 페이지에서 팬 인증에 참여하세요. 인증을 통과하면 해당 최애의 Fan Passport를 시작할 수 있어요." },
      { number: "02", title: "LIVE 예약하기", description: "예약이 열려 있는 LIVE를 확인하고 기간 안에 예약하세요. 예약만으로 출석이 완료되지는 않아요." },
      { number: "03", title: "LIVE에 출석하기", description: "방송 중 이벤트 화면에 안내된 방법으로 출석하세요. LIVE마다 출석 방식과 운영 시간이 다를 수 있어요." },
      { number: "04", title: "선물에 따로 응모하기", description: "응모 조건과 기간을 확인한 뒤 혜택 화면에서 직접 응모하세요. 예약이나 출석만으로 자동 응모되지 않아요." },
    ],
    passportTitle: "Fan Passport에는 무엇이 기록되나요?",
    passportDescription: "Fan Passport는 ByUs 안에서 최애와 함께한 팬 활동을 기록하는 디지털 기록이에요.",
    passportPoints: [
      "팬 인증을 통과한 최애별로 Passport가 만들어져요.",
      "지원되는 팬 활동을 완료하면 Stamp와 참여 기록을 확인할 수 있어요.",
      "Passport와 Stamp는 현금, 증권, 투자 상품이나 회사에 대한 권리를 뜻하지 않아요.",
    ],
    faqTitle: "자주 묻는 질문",
    faqs: [
      { question: "팬 인증, LIVE 예약, 출석, 선물 응모는 한 번에 처리되나요?", answer: "아니요. 네 활동은 서로 다른 단계예요. 각 화면에서 완료 상태를 따로 확인해 주세요." },
      { question: "LIVE를 예약하면 출석으로 인정되나요?", answer: "아니요. 예약은 시청할 LIVE를 미리 등록하는 단계예요. 출석은 방송 중 해당 LIVE 화면에 안내된 방법으로 별도 완료해야 해요." },
      { question: "예약하거나 출석하면 선물에 자동 응모되나요?", answer: "아니요. 별도 안내가 없는 한 혜택 화면에서 응모 조건과 기간을 확인하고 직접 응모해야 해요." },
      { question: "해외에서도 참여할 수 있나요?", answer: "서비스 접속 여부와 별개로 이벤트 참여 대상, 혜택 배송 가능 국가, 수령 조건은 이벤트마다 다를 수 있어요. 참여 전 해당 LIVE와 혜택 화면의 안내를 확인해 주세요." },
      { question: "LIVE 일정이나 혜택 조건이 바뀔 수 있나요?", answer: "셀럽, 브랜드 또는 운영 사유로 일정이나 제공 조건이 바뀔 수 있어요. 변경 내용은 해당 화면의 최신 안내를 확인해 주세요." },
      { question: "서비스 이용 문의는 어디로 보내면 되나요?", answer: "Sallylab Inc.의 ByUs 문의 창구인 biz@sallylab.io로 보내 주세요." },
    ],
    contactTitle: "도움이 더 필요하신가요?",
    contactDescription: "계정이나 서비스 이용 문의는 ByUs 운영팀에서 확인해 드릴게요.",
    contactAction: "문의하기",
  },
  en: {
    metadataTitle: "Guide and Frequently Asked Questions",
    metadataDescription: "Learn how fan verification, Fan Passports, LIVE reservations and attendance, and prize entries work on ByUs.",
    eyebrow: "BYUS GUIDE",
    title: "Start your fan journey",
    description: "Find your favorite, complete fan verification, and join LIVE events and benefits. Check each screen for its specific conditions and participation period.",
    primaryAction: "Find favorites",
    secondaryAction: "View LIVE schedule",
    overviewTitle: "How to participate on ByUs",
    overviewDescription: "Fan verification, reservation, attendance, and prize entry are separate steps that you need to check and complete individually.",
    steps: [
      { number: "01", title: "Find your favorite and get verified", description: "Take the fan verification on your favorite’s page. After you pass, you can start a Fan Passport for that favorite." },
      { number: "02", title: "Reserve a LIVE", description: "Find a LIVE with open reservations and reserve it before the deadline. A reservation does not count as attendance." },
      { number: "03", title: "Check in during the LIVE", description: "Follow the attendance instructions shown on the event screen during the broadcast. The method and check-in window may vary by LIVE." },
      { number: "04", title: "Enter a prize draw separately", description: "Check the entry conditions and period, then enter from the benefit screen. A reservation or attendance does not enter you automatically." },
    ],
    passportTitle: "What does a Fan Passport record?",
    passportDescription: "A Fan Passport is a digital record of the activities you share with your favorite within ByUs.",
    passportPoints: [
      "A Passport is created for each favorite whose fan verification you pass.",
      "You can view Stamps and participation records for supported fan activities you complete.",
      "Passports and Stamps do not represent cash, securities, investment products, or rights in the company.",
    ],
    faqTitle: "Frequently asked questions",
    faqs: [
      { question: "Are fan verification, LIVE reservation, attendance, and prize entry completed together?", answer: "No. They are separate steps. Check the completion status for each activity on its relevant screen." },
      { question: "Does reserving a LIVE count as attendance?", answer: "No. A reservation registers the LIVE you plan to watch. You must complete attendance separately during the broadcast by following the instructions on that LIVE’s screen." },
      { question: "Does a reservation or attendance enter me into a prize draw automatically?", answer: "No. Unless a screen expressly says otherwise, check the conditions and entry period on the benefit screen and submit your entry there." },
      { question: "Can I participate from outside Korea?", answer: "Access to the service does not guarantee eligibility for every event. Eligible regions, countries available for benefit delivery, and receipt conditions may vary. Check the relevant LIVE and benefit screens before participating." },
      { question: "Can a LIVE schedule or benefit conditions change?", answer: "Schedules or availability conditions may change for reasons related to a celebrity, brand, or service operations. Check the relevant screen for the latest information." },
      { question: "Where can I ask about the service?", answer: "Email biz@sallylab.io, the ByUs contact operated by Sallylab Inc." },
    ],
    contactTitle: "Need more help?",
    contactDescription: "Contact the ByUs team with questions about your account or use of the service.",
    contactAction: "Contact support",
  },
} as const satisfies Record<FanLocale, ServiceGuideContent>;

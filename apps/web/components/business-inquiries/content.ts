import type { FanLocale } from "../fan-shell/fan-app-shell";

export type BusinessPageKind = "creator" | "partner";
export const businessPagePaths = {
  creator: "/pages/creator-onboarding",
  partner: "/pages/partners",
} as const;

type Content = {
  title: string;
  eyebrow: string;
  hero: string;
  description: string;
  cta: string;
  scope: string;
  audience: string;
  visualTitle: string;
  visualLabels: readonly string[];
  supportTitle: string;
  supportDescription: string;
  services: readonly { title: string; description: string }[];
  processTitle: string;
  steps: readonly { title: string; description: string }[];
  prepareTitle: string;
  prepareDescription: string;
  prepare: readonly string[];
  faqTitle: string;
  faqs: readonly { question: string; answer: string }[];
  closeTitle: string;
  closeDescription: string;
  guide: string;
  related: string;
};

export const businessPageContent: Record<BusinessPageKind, Record<FanLocale, Content>> = {
  creator: {
    ko: {
      title: "팬이 있는 당신에게",
      eyebrow: "FOR EVERYONE WITH FANS",
      hero: "팬이 있는 누구나,\nByUs에서 함께해요",
      description: "나를, 우리 팀을, 우리의 이야기를 좋아하는 팬이 있다면.\n팬과 함께할 다음 활동을 ByUs에서 준비하세요.",
      cta: "팬 활동 상담하기",
      scope: "함께할 수 있는 활동 보기",
      audience: "크리에이터 · 아티스트 · 운동선수 · 작가 · 팀 · 브랜드와 IP, 그리고 그 팬들",
      visualTitle: "함께한 순간이\n팬의 기록으로",
      visualLabels: ["나의 팬 페이지", "LIVE와 팬 참여", "Fan Passport"],
      supportTitle: "우리 팬에게 맞는\n활동을 함께 준비해요",
      supportDescription: "분야나 소속에 관계없이 문의해 주세요. 현재 활동과 팬들을 바탕으로 적합한 시작 방식과 운영 범위를 함께 정합니다.",
      services: [
        { title: "팬들이 찾아올 한 페이지", description: "소개, 활동 채널, 새로운 소식을 한곳에 모읍니다. 팬이 다음 활동을 쉽게 찾을 수 있도록 페이지를 준비합니다." },
        { title: "LIVE를 함께 기다리고", description: "기존 채널의 LIVE 일정을 알리고 팬들이 미리 예약하게 합니다. 방송 당일 출석과 참여 방식도 함께 준비합니다." },
        { title: "함께한 순간을 기록하고", description: "팬 인증부터 LIVE 참여까지, 팬의 활동을 Fan Passport에 남깁니다. 팬이 쌓아가는 기록에 맞춰 다음 활동을 기획합니다." },
        { title: "팬에게 특별한 기회를", description: "기념일 이벤트와 상품·티켓·체험 혜택을 기획합니다. 팬 인증, 응모, 추첨 등 목적에 맞는 참여 조건을 함께 정합니다." },
      ],
      processTitle: "첫 문의부터\n팬을 만나는 순간까지",
      steps: [
        { title: "활동 소개", description: "활동명과 채널, 팬들과 해보고 싶은 일을 알려주세요." },
        { title: "방향 상담", description: "활동 방식과 필요한 운영 범위, 일정을 상의합니다." },
        { title: "페이지와 활동 준비", description: "프로필과 이미지, 참여 안내 등 필요한 자료를 준비합니다." },
        { title: "팬에게 공개", description: "준비한 페이지와 참여 흐름을 확인한 뒤 팬들에게 안내합니다." },
      ],
      prepareTitle: "이 정도만 알려주셔도 좋아요",
      prepareDescription: "기획안이 완성되지 않아도 괜찮아요. 현재 정해진 내용부터 적어주세요.",
      prepare: ["활동명 또는 팀·브랜드명", "주로 활동하는 채널 링크", "팬들과 해보고 싶은 활동", "희망 일정이 있다면 함께"],
      faqTitle: "시작하기 전 궁금한 점",
      faqs: [
        { question: "크리에이터나 셀럽이 아니어도 되나요?", answer: "네. 팬과 함께할 활동을 준비하는 개인, 팀, 브랜드·IP 관계자 모두 문의할 수 있어요. 현재 활동을 알려주시면 적합한 운영 방식을 함께 검토합니다." },
        { question: "소속사 없이 혼자 활동해도 되나요?", answer: "네. 개인으로 활동한다면 문의창의 ‘활동명 / 팀·브랜드명’에 활동명을 적어주세요." },
        { question: "LIVE나 이벤트 일정이 정해져 있어야 하나요?", answer: "아직 일정이 없어도 괜찮아요. 활동 채널과 팬들과 해보고 싶은 일을 알려주시면 시작 방향부터 상의할 수 있어요." },
        { question: "이용 범위와 비용은 어떻게 정하나요?", answer: "활동 방식과 필요한 운영 범위를 확인한 뒤 협의합니다. 정해진 예산이나 조건이 있다면 함께 알려주세요." },
      ],
      closeTitle: "어떤 팬 활동을\n시작하고 싶으세요?",
      closeDescription: "현재 활동과 아이디어를 남겨주세요.\n담당자가 확인 후 이메일로 회신드릴게요.",
      guide: "팬 이용 가이드 보기",
      related: "브랜드·기업 협업을 찾고 계신가요?",
    },
    en: {
      title: "For everyone with fans",
      eyebrow: "FOR EVERYONE WITH FANS",
      hero: "If you have fans,\nthere’s a place to start",
      description: "For everyone with people who love their work, team, or story.\nPlan your next fan activity with ByUs.",
      cta: "Talk to us about fan activities",
      scope: "Explore fan activities",
      audience: "CREATORS · ARTISTS · ATHLETES · WRITERS · TEAMS · BRANDS & IP — AND THEIR FANS",
      visualTitle: "Shared moments.\nLasting fan memories.",
      visualLabels: ["Your fan page", "LIVE & participation", "Fan Passport"],
      supportTitle: "Plan activities\nthat fit your fans",
      supportDescription: "Whatever your field or affiliation, tell us about your activities and fans. We’ll discuss the right way to start and the support you need.",
      services: [
        { title: "One page for your fans", description: "Bring your introduction, channels, and updates together so fans can find your next activity." },
        { title: "Look forward to LIVE together", description: "Share LIVE schedules from your existing channels and let fans reserve in advance. Plan attendance and participation for the day." },
        { title: "Keep a record of shared moments", description: "Fan Passport records activities from fan verification to LIVE participation. Use those records to plan what comes next." },
        { title: "Give fans something special", description: "Plan milestone events and product, ticket, or experience benefits, with suitable verification, entry, and draw requirements." },
      ],
      processTitle: "From your first inquiry\nto meeting your fans",
      steps: [
        { title: "Introduce yourself", description: "Share your name or team, channels, and ideas for fan activities." },
        { title: "Discuss the plan", description: "Agree on the activity format, operational scope, and timing." },
        { title: "Prepare your page and activities", description: "Prepare your profile, images, and participation guidance." },
        { title: "Invite your fans", description: "Review the pages and participation flow before sharing them with fans." },
      ],
      prepareTitle: "Start with what you know",
      prepareDescription: "You don’t need a finished proposal. Share the details you have so far.",
      prepare: ["Your public name, team, or brand", "Links to your main channels", "Ideas for activities with fans", "Preferred timing, if you have it"],
      faqTitle: "Before you get started",
      faqs: [
        { question: "Is this only for creators and celebrities?", answer: "Anyone planning activities with fans can inquire, including individuals, teams, and brand or IP representatives. Tell us what you do so we can discuss a suitable setup." },
        { question: "Can I inquire without an agency?", answer: "Yes. If you work independently, enter your public name in the ‘Public name / team / brand’ field." },
        { question: "Do I need a confirmed LIVE event or schedule?", answer: "No. Share your channels and ideas for fan activities, and we can discuss where to start." },
        { question: "How are scope and pricing decided?", answer: "We discuss them after reviewing your activities and operational needs. Include any budget or requirements you already have." },
      ],
      closeTitle: "What would you like\nto do with your fans?",
      closeDescription: "Tell us about your activities and ideas.\nOur team will review your inquiry and reply by email.",
      guide: "Explore the fan guide",
      related: "Looking for a brand or business partnership?",
    },
  },
  partner: {
    ko: {
      title: "파트너 협업 제안",
      eyebrow: "PARTNERSHIPS",
      hero: "좋아하는 사람과 제품,\n팬이 반길 협업으로",
      description: "셀럽·크리에이터에게 제안하고 싶은 제품과 아이디어.\n커머스, 라이브커머스, 굿즈, 광고부터 팬 이벤트까지\nByUs와 함께할 협업을 제안해 주세요.",
      cta: "협업 제안하기",
      scope: "협업 분야 보기",
      audience: "브랜드 · 기업 · 에이전시 · 콘텐츠 / 행사 파트너",
      visualTitle: "브랜드와 크리에이터,\n그 중심에는 팬",
      visualLabels: ["브랜드", "크리에이터", "팬"],
      supportTitle: "어떤 협업을\n생각하고 계신가요?",
      supportDescription: "제품과 콘텐츠에 ByUs의 팬 인증, LIVE 참여, 이벤트를 더할 수 있습니다. 제안 내용을 검토한 뒤 참여자와 각 팀의 역할, 진행 조건을 함께 정합니다.",
      services: [
        { title: "커머스 · 공동구매", description: "셀럽·크리에이터에게 제품 판매 협업이나 공동구매를 제안해 주세요. 판매 채널과 조건을 바탕으로 제품 소개와 팬 참여 혜택을 함께 기획합니다." },
        { title: "라이브커머스", description: "외부 채널에서 진행할 판매 방송을 제안해 주세요. ByUs의 LIVE 예약·출석과 팬 혜택을 활용한 참여 흐름을 함께 준비합니다." },
        { title: "굿즈 · IP 협업", description: "팬이 소장하고 싶은 굿즈와 IP 협업을 제안해 주세요. 제품·디자인·제작 조건을 검토하고 공개 일정에 맞는 팬 이벤트를 상의합니다." },
        { title: "광고 · 브랜디드 콘텐츠", description: "제품과 브랜드를 소개할 SNS 콘텐츠, 영상, 캠페인을 제안해 주세요. 콘텐츠 형식과 사용 범위, 연계할 팬 참여 활동을 함께 검토합니다." },
        { title: "팬 혜택 · 이벤트", description: "제품, 티켓, 체험 기회를 팬에게 제안해 주세요. 팬 인증과 응모·추첨, 배송·현장 수령 안내 등 혜택에 맞는 운영 방식을 준비합니다." },
      ],
      processTitle: "아이디어를 나누고,\n함께 실행을 준비해요",
      steps: [
        { title: "협업 제안", description: "회사나 브랜드, 협업 목적과 제안 내용을 알려주세요." },
        { title: "범위 검토", description: "대상 팬, 콘텐츠, 일정과 운영 조건을 함께 검토합니다." },
        { title: "진행안 협의", description: "각 팀의 역할과 세부 운영 방식, 비용을 협의합니다." },
        { title: "프로젝트 준비", description: "합의한 범위에 맞춰 페이지와 콘텐츠, 참여 안내를 준비합니다." },
      ],
      prepareTitle: "함께 검토할 내용을 알려주세요",
      prepareDescription: "확정된 내용과 아직 상의가 필요한 내용을 편하게 적어주세요.",
      prepare: ["브랜드와 제안할 제품·콘텐츠", "희망 협업 분야와 판매·게시 채널", "함께하고 싶은 대상 또는 팬층", "일정·예산·제공 조건 중 정해진 내용"],
      faqTitle: "협업 전 궁금한 점",
      faqs: [
        { question: "특정 셀럽이나 크리에이터에게 제안할 수 있나요?", answer: "네. 함께하고 싶은 대상과 제안 이유를 알려주세요. 참여 의사와 일정, 협업 조건을 검토한 뒤 진행 여부를 협의합니다." },
        { question: "협업 대상이나 기획이 아직 정해지지 않아도 되나요?", answer: "네. 제품과 협업 목적, 만나고 싶은 팬층부터 알려주세요. 적합한 방향과 검토할 조건을 함께 정리합니다." },
        { question: "판매·제작·배송은 어떻게 진행하나요?", answer: "제안하실 판매 채널, 제작 방식, 배송·고객 응대 조건을 알려주세요. 파트너가 맡을 업무와 ByUs의 페이지·팬 참여 운영 범위, 비용을 각각 협의합니다." },
        { question: "상품이나 티켓 협찬만 제안해도 되나요?", answer: "네. 혜택의 종류, 수량, 제공 조건을 알려주세요. 팬 인증, LIVE 참여, 응모 이벤트 중 어울리는 방식과 운영 범위를 검토합니다." },
      ],
      closeTitle: "함께 만들 프로젝트를\n들려주세요",
      closeDescription: "아이디어와 제안을 남겨주세요.\n담당자가 확인 후 이메일로 회신드릴게요.",
      guide: "ByUs 이용 가이드 보기",
      related: "미국 팬미팅 협업을 찾고 계신가요?",
    },
    en: {
      title: "Partnership proposals",
      eyebrow: "PARTNERSHIPS",
      hero: "Products and people\nfans love, together",
      description: "Have a product or idea for a celebrity or creator?\nPropose commerce, live shopping, merchandise,\nbranded content, or fan events with ByUs.",
      cta: "Propose a collaboration",
      scope: "Explore collaborations",
      audience: "BRANDS · BUSINESSES · AGENCIES · CONTENT / EVENT PARTNERS",
      visualTitle: "Brands and creators.\nFans at the heart.",
      visualLabels: ["Brands", "Creators", "Fans"],
      supportTitle: "What kind of collaboration\ndo you have in mind?",
      supportDescription: "Add ByUs fan verification, LIVE participation, and events to your products and content. After reviewing your proposal, we’ll discuss participants, responsibilities, and terms.",
      services: [
        { title: "Commerce & group buying", description: "Propose a product sales collaboration or group buy with a celebrity or creator. Share your sales channels and terms to plan product introductions and fan benefits together." },
        { title: "Live shopping", description: "Propose a sales broadcast on an external channel. Plan fan participation through ByUs LIVE reservations, attendance, and benefits." },
        { title: "Merchandise & IP collaborations", description: "Propose merchandise fans will want to keep. We’ll review product, design, and production terms and discuss fan events for the launch." },
        { title: "Advertising & branded content", description: "Propose social posts, videos, or campaigns featuring your brand. Discuss content formats, usage scope, and related fan activities." },
        { title: "Fan benefits & events", description: "Offer products, tickets, or experiences to fans. Plan verification, entries, draws, and shipping or on-site pickup guidance to fit the benefit." },
      ],
      processTitle: "Share your idea.\nPlan the next steps together.",
      steps: [
        { title: "Propose a project", description: "Introduce your company or brand and share your goals and proposal." },
        { title: "Review the scope", description: "Discuss target fans, content, timing, and operational requirements." },
        { title: "Agree on a plan", description: "Define each team’s role, operations, and costs." },
        { title: "Prepare the project", description: "Prepare pages, content, and participation guidance within the agreed scope." },
      ],
      prepareTitle: "Tell us what you have in mind",
      prepareDescription: "Share both confirmed details and anything you’d like to discuss.",
      prepare: ["Your brand and proposed products or content", "Collaboration format and sales or content channels", "People you’d like to work with or target fans", "Any confirmed timing, budget, or offer terms"],
      faqTitle: "Before we collaborate",
      faqs: [
        { question: "Can we propose a specific celebrity or creator?", answer: "Yes. Tell us who you’d like to work with and why. Participation, availability, and terms need to be reviewed and agreed before proceeding." },
        { question: "What if we haven’t chosen a partner or format?", answer: "Start with your product, goals, and target fans. We can discuss a suitable direction and the terms to review." },
        { question: "Who handles sales, production, and delivery?", answer: "Share your sales channels, production plans, and delivery and customer support arrangements. We’ll agree on partner responsibilities, ByUs page and fan participation operations, and costs." },
        { question: "Can we offer products or tickets as sponsorship?", answer: "Yes. Share the benefit, quantity, and conditions. We’ll review verification, LIVE participation, or entry events to find a suitable format and scope." },
      ],
      closeTitle: "Tell us what you’d\nlike to create together",
      closeDescription: "Share your ideas and proposal.\nOur team will review your inquiry and reply by email.",
      guide: "Explore the ByUs guide",
      related: "Planning a U.S. fan meeting?",
    },
  },
};

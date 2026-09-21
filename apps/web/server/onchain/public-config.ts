import { messages as localizedMessages } from "@/i18n/catalogs/server__onchain__public-config";
import { additionalLocales } from "@/i18n/messages";
// Public deployment facts only. These constants never select a signer or a DB.
export const onchainConfig = {
  chainId: 91342,
  network: "GIWA Sepolia",
  rpcUrl: "https://sepolia-rpc.giwa.io",
  explorer: "https://sepolia-explorer.giwa.io",
  fromBlock: 35954883n,
  // Compatibility pointer for the currently active writer route. Multi-Hub reads use deployments below.
  hubAddress: "0xbd9991a26d0a0bf744ecdb8ad4f59f60a9132956",
  deployments: [
    { label: "Legacy ActionHub", hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d", fromBlock: 35954883n, writeStatus: "historical" },
    { label: "New ActionHub", hubAddress: "0xbd9991a26d0a0bf744ecdb8ad4f59f60a9132956", fromBlock: 35969543n, writeStatus: "current" },
  ],
  environmentId: "0xd5bc532db275cd70e5f55280b01cd2acc6b30b90d5aaa451adeb4b9a8f02c264",
  schemaUid: "0xbd97671d89c9f4bb246e33369389332486f406ab821a0c7f88860034759c5c0b",
  easAddress: "0x4200000000000000000000000000000000000021",
  assets: { 0: "0x17f9fb7658a326dd88db523739c227faf50fca20", 1: "0x1adcde3473c4e884e60205b397ece744d8892285" },
  qaWallets: ["0x29b000d7791c671a9556a0c83b985b7487364082"],
} as const;

export const officialAddresses = [
  { name: "ByUs ActionHub · new", role: "actionHub", address: onchainConfig.deployments[1].hubAddress },
  { name: "ByUs ActionHub · legacy", role: "actionHub", address: onchainConfig.deployments[0].hubAddress },
  { name: "Fan Passport · ERC-721", role: "passport", address: onchainConfig.assets[0] },
  { name: "ByUs Stamp · ERC-1155", role: "stamp", address: onchainConfig.assets[1] },
  { name: "ByUs ActionHub implementation", role: "implementation", address: "0x049b758b3d1cc0c66408b264c7f9a96ea479860b" },
  { name: "ByUs ActionCodec", role: "codec", address: "0x4e44a1c183bac430f30033bd1a639c696b93612a" },
  { name: "ByUs PublicContextRegistry V3", role: "registry", address: "0x4e104e5dfb3d466a2aac9ed0cf7572578068529b" },
  { name: "EAS", role: "eas", address: onchainConfig.easAddress },
  { name: "Schema Registry", role: "schema", address: "0x4200000000000000000000000000000000000020" },
  { name: "ByUs Timelock", role: "timelock", address: "0x40eaeb0b73c50da5053502eb3b836a6effe54642" },
  { name: "ByUs_Admin", role: "admin", address: "0xeee82f960476c888950c798c444c1fd92cbbfe50" },
  { name: "ByUs action writer", role: "writer", address: "0xd0f5dd0885ca87f2c9f4d1017fa1714dd98dc815" },
] as const;

export const actionDefinitions = [
  { code: 1, name: "FAN_VERIFIED", ko: "팬 인증", en: "Fan verification", descriptionKo: "팬 퀴즈 통과와 Passport·스탬프 발급", descriptionEn: "Fan quiz passed; Passport and stamp issued", description: { ko: "팬 퀴즈 통과와 Passport·스탬프 발급", en: "Fan quiz passed; Passport and stamp issued" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m966431b6e409[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m6879504e351c[translationLocale]))
},
  { code: 2, name: "LIVE_RESERVED", ko: "LIVE 예약", en: "LIVE reservation", descriptionKo: "실제 LIVE 예약 완료", descriptionEn: "A LIVE reservation completed", description: { ko: "실제 LIVE 예약 완료", en: "A LIVE reservation completed" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m603c01882455[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.me08e26dce0e6[translationLocale]))
},
  { code: 3, name: "LIVE_ATTENDED", ko: "LIVE 출석", en: "LIVE attendance", descriptionKo: "서비스가 확인한 LIVE 출석", descriptionEn: "LIVE attendance confirmed by the service", description: { ko: "서비스가 확인한 LIVE 출석", en: "LIVE attendance confirmed by the service" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m296eba3abb22[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m9d465c322e78[translationLocale]))
},
  { code: 4, name: "MISSION_COMPLETED", ko: "미션 완료", en: "Mission completion", descriptionKo: "LIVE 미션 완료 조건 충족", descriptionEn: "LIVE mission requirements met", description: { ko: "LIVE 미션 완료 조건 충족", en: "LIVE mission requirements met" ,
  ...additionalLocales((translationLocale) => (localizedMessages.ma60dbe5a8a92[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m11eb7e3fd7ca[translationLocale]))
},
  { code: 5, name: "SURVEY_SUBMITTED", ko: "설문 제출", en: "Survey submission", descriptionKo: "설문 응답 제출 완료", descriptionEn: "A survey response submitted", description: { ko: "설문 응답 제출 완료", en: "A survey response submitted" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m0af6eb354764[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m1dcc1564a326[translationLocale]))
},
  { code: 6, name: "FIRST_REACTION", ko: "첫 리액션", en: "First reaction", descriptionKo: "크리에이터별 첫 리액션", descriptionEn: "First qualifying reaction per creator", description: { ko: "크리에이터별 첫 리액션", en: "First qualifying reaction per creator" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m752d34c316a1[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.mcd70a120b92c[translationLocale]))
},
  { code: 7, name: "WELCOME_COMPLETED", ko: "웰컴 미션 완료", en: "Welcome completion", descriptionKo: "웰컴 스탬프 수령 · 회원가입 수와 다름", descriptionEn: "Welcome stamp claimed; not an account signup", description: { ko: "웰컴 스탬프 수령 · 회원가입 수와 다름", en: "Welcome stamp claimed; not an account signup" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m48512dc35c2a[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m1aec0326bc22[translationLocale]))
},
  { code: 8, name: "FIRST_COMMENT", ko: "첫 댓글", en: "First comment", descriptionKo: "팬·크리에이터별 첫 댓글 · 전체 댓글 수와 다름", descriptionEn: "First qualifying comment per fan and creator; not all comments", description: { ko: "팬·크리에이터별 첫 댓글 · 전체 댓글 수와 다름", en: "First qualifying comment per fan and creator; not all comments" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m7c5b88dd4742[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m31d67a183102[translationLocale]))
},
  { code: 9, name: "INVITE_COMPLETED", ko: "초대 완료", en: "Invite completion", descriptionKo: "서비스의 초대 완료 조건 충족", descriptionEn: "The service’s invite requirements met", description: { ko: "서비스의 초대 완료 조건 충족", en: "The service’s invite requirements met" ,
  ...additionalLocales((translationLocale) => (localizedMessages.ma00a028544ed[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m3549d9d2457a[translationLocale]))
},
  { code: 10, name: "DAILY_CHECKIN", ko: "일일 출석", en: "Daily check-in", descriptionKo: "크리에이터별 일일 출석 완료", descriptionEn: "A daily check-in for a creator completed", description: { ko: "크리에이터별 일일 출석 완료", en: "A daily check-in for a creator completed" ,
  ...additionalLocales((translationLocale) => (localizedMessages.mfa37c51ac8ec[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.maa537b3267b6[translationLocale]))
},
  { code: 11, name: "COLLECTIBLE_CLAIMED", ko: "Collectible 수령", en: "Collectible claim", descriptionKo: "운영 발급 계약 미설정", descriptionEn: "Production issuance contract not configured", description: { ko: "운영 발급 계약 미설정", en: "Production issuance contract not configured" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m70c78ae25d27[translationLocale]))
} ,
  ...additionalLocales((translationLocale) => (localizedMessages.m3cf119caeffa[translationLocale]))
},
] as const;

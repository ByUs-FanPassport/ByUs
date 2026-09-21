import type { AppLocale } from "./locales";

export const languageSettings: Record<AppLocale, { website: string; email: string; help: string }> = {
  ko: { website: "사이트 언어", email: "이메일 언어", help: "자동 이메일에 사용할 언어를 선택하세요." },
  en: { website: "Website language", email: "Email language", help: "Choose the language for automatic emails." },
  ja: { website: "サイトの言語", email: "メールの言語", help: "自動送信メールの言語を選んでください。" },
  "zh-Hans": { website: "网站语言", email: "邮件语言", help: "选择自动邮件使用的语言。" },
  "zh-Hant": { website: "網站語言", email: "電子郵件語言", help: "選擇自動郵件使用的語言。" },
  es: { website: "Idioma del sitio", email: "Idioma de los correos", help: "Elige el idioma de los correos automáticos." },
  id: { website: "Bahasa situs", email: "Bahasa email", help: "Pilih bahasa untuk email otomatis." },
  vi: { website: "Ngôn ngữ trang web", email: "Ngôn ngữ email", help: "Chọn ngôn ngữ cho email tự động." },
  th: { website: "ภาษาเว็บไซต์", email: "ภาษาอีเมล", help: "เลือกภาษาสำหรับอีเมลอัตโนมัติ" },
  pt: { website: "Idioma do site", email: "Idioma dos emails", help: "Escolha o idioma dos emails automáticos." },
  fr: { website: "Langue du site", email: "Langue des e-mails", help: "Choisissez la langue des e-mails automatiques." },
};

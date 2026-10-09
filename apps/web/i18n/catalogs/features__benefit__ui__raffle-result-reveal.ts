import type { TranslatedMessage } from "../messages";

export const messages = {
  ready: { ja: "チケットの中の結果は？", "zh-Hans": "你的抽奖券里藏着什么结果？", "zh-Hant": "你的抽獎券裡藏著什麼結果？", es: "¿Qué resultado guarda tu boleto?", id: "Apa hasil di balik tiket Anda?", vi: "Tấm vé của bạn có kết quả gì?", th: "ผลในตั๋วของคุณคืออะไร?", pt: "Qual é o resultado do seu bilhete?", fr: "Quel résultat se cache dans votre billet ?" },
  open: { ja: "結果を見る", "zh-Hans": "揭晓我的结果", "zh-Hant": "揭曉我的結果", es: "Revelar mi resultado", id: "Lihat hasil saya", vi: "Xem kết quả của tôi", th: "ดูผลของฉัน", pt: "Revelar meu resultado", fr: "Découvrir mon résultat" },
  waiting: { ja: "ドキドキ…", "zh-Hans": "咚咚咚…", "zh-Hant": "咚咚咚…", es: "Redoble de tambores…", id: "Deg-degan…", vi: "Hồi hộp quá…", th: "ลุ้นกัน…", pt: "Rufem os tambores…", fr: "Roulement de tambour…" },
  skip: { ja: "すぐに結果を見る", "zh-Hans": "直接查看结果", "zh-Hant": "直接查看結果", es: "Ver resultado ahora", id: "Langsung lihat hasil", vi: "Xem kết quả ngay", th: "ดูผลทันที", pt: "Ver resultado agora", fr: "Voir le résultat maintenant" },
  replay: { ja: "もう一度見る", "zh-Hans": "再看一次", "zh-Hant": "再看一次", es: "Volver a ver", id: "Lihat lagi", vi: "Xem lại", th: "ดูอีกครั้ง", pt: "Ver novamente", fr: "Revoir l’animation" },
  help: { ja: "チケットを開いて抽選結果を確認しましょう。", "zh-Hans": "打开抽奖券，查看你的抽奖结果。", "zh-Hant": "打開抽獎券，查看你的抽獎結果。", es: "Abre tu boleto para ver el resultado del sorteo.", id: "Buka tiket untuk melihat hasil undian Anda.", vi: "Mở vé để xem kết quả rút thăm của bạn.", th: "เปิดตั๋วเพื่อดูผลการจับรางวัลของคุณ", pt: "Abra o seu bilhete para ver o resultado do sorteio.", fr: "Ouvrez votre billet pour découvrir le résultat du tirage au sort." },
  thanks: { ja: "ご参加ありがとうございます", "zh-Hans": "谢谢你的参与", "zh-Hant": "謝謝你的參與", es: "Gracias por participar", id: "Terima kasih sudah berpartisipasi", vi: "Cảm ơn bạn đã tham gia", th: "ขอบคุณที่ร่วมสนุกด้วยกัน", pt: "Agradecemos a sua participação", fr: "Merci d’avoir participé" },
  ticket: { ja: "あなたへのチケット", "zh-Hans": "属于你的抽奖券", "zh-Hant": "屬於你的抽獎券", es: "Un boleto para ti", id: "Tiket untuk Anda", vi: "Tấm vé dành cho bạn", th: "ตั๋วสำหรับคุณ", pt: "Um bilhete para você", fr: "Un billet pour vous" },
  result: { ja: "自分の抽選結果", "zh-Hans": "我的抽奖结果", "zh-Hant": "我的抽獎結果", es: "Mi resultado del sorteo", id: "Hasil undian saya", vi: "Kết quả rút thăm của tôi", th: "ผลการจับรางวัลของฉัน", pt: "Meu resultado do sorteio", fr: "Mon résultat du tirage au sort" },
} satisfies Record<string, TranslatedMessage>;

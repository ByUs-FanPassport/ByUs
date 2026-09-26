import type { AppLocale } from "../locales";

const labels = {
  ko: ["최애 요청", "찾는 최애가 없나요?", "팬들과 감상과 응원을 나눠 보세요.", "오늘은 어떤 이야기를 나눌까요?", "공식 소식", "공식 채널의 사진과 영상을 모았어요.", "공식 채널", "아직 모아둔 미디어가 없어요. 공식 채널에서 더 많은 소식을 만나보세요.", "영상을 불러오지 못했어요. 공식 채널에서 확인해 주세요."],
  en: ["Request a favorite", "Can't find your favorite?", "Share your thoughts and support with other fans.", "What would you like to share today?", "Official updates", "Photos and videos from official channels.", "Official channels", "No media here yet. Explore more updates on the official channels.", "Videos couldn't be loaded. Visit the official channel."],
  ja: ["推しをリクエスト", "推しが見つかりませんか？", "ファン同士で感想や応援をシェアしましょう。", "今日はどんな話をしますか？", "公式ニュース", "公式チャンネルの写真と動画を集めました。", "公式チャンネル", "まだメディアはありません。公式チャンネルで最新情報をご覧ください。", "動画を読み込めませんでした。公式チャンネルでご確認ください。"],
  "zh-Hans": ["申请添加喜爱的艺人", "找不到你喜欢的艺人？", "和其他粉丝分享感想与支持。", "今天想分享什么？", "官方动态", "汇集官方频道的照片和视频。", "官方频道", "暂无媒体内容。前往官方频道查看更多动态。", "无法加载视频，请前往官方频道查看。"],
  "zh-Hant": ["申請新增喜愛的藝人", "找不到你喜歡的藝人？", "和其他粉絲分享感想與支持。", "今天想分享什麼？", "官方動態", "彙集官方頻道的照片和影片。", "官方頻道", "暫無媒體內容。前往官方頻道查看更多動態。", "無法載入影片，請前往官方頻道查看。"],
  es: ["Solicitar un artista", "¿No encuentras a tu favorito?", "Comparte tus ideas y apoyo con otros fans.", "¿Qué quieres compartir hoy?", "Novedades oficiales", "Fotos y vídeos de los canales oficiales.", "Canales oficiales", "Aún no hay contenido. Descubre más en los canales oficiales.", "No se pudieron cargar los vídeos. Visita el canal oficial."],
  id: ["Ajukan artis favorit", "Tidak menemukan favoritmu?", "Bagikan kesan dan dukungan dengan sesama penggemar.", "Apa yang ingin kamu bagikan hari ini?", "Kabar resmi", "Foto dan video dari kanal resmi.", "Kanal resmi", "Belum ada media di sini. Lihat kabar lainnya di kanal resmi.", "Video tidak dapat dimuat. Kunjungi kanal resmi."],
  vi: ["Đề xuất nghệ sĩ", "Không tìm thấy nghệ sĩ yêu thích?", "Chia sẻ cảm nghĩ và lời cổ vũ với các fan.", "Hôm nay bạn muốn chia sẻ gì?", "Tin chính thức", "Ảnh và video từ các kênh chính thức.", "Kênh chính thức", "Chưa có nội dung. Khám phá thêm trên các kênh chính thức.", "Không tải được video. Hãy xem trên kênh chính thức."],
  th: ["ขอเพิ่มศิลปินที่ชอบ", "ไม่พบศิลปินที่ชอบใช่ไหม?", "แบ่งปันความรู้สึกและกำลังใจกับแฟนคนอื่น ๆ", "วันนี้อยากเล่าเรื่องอะไร?", "ข่าวสารทางการ", "ภาพและวิดีโอจากช่องทางทางการ", "ช่องทางทางการ", "ยังไม่มีสื่อที่นี่ ดูข่าวสารเพิ่มเติมได้ที่ช่องทางทางการ", "โหลดวิดีโอไม่ได้ โปรดดูที่ช่องทางทางการ"],
  pt: ["Pedir um artista", "Não encontra seu favorito?", "Compartilhe ideias e apoio com outros fãs.", "O que você quer compartilhar hoje?", "Novidades oficiais", "Fotos e vídeos dos canais oficiais.", "Canais oficiais", "Ainda não há conteúdo. Veja mais nos canais oficiais.", "Não foi possível carregar os vídeos. Visite o canal oficial."],
  fr: ["Proposer un artiste", "Vous ne trouvez pas votre favori ?", "Partagez vos impressions et votre soutien avec les fans.", "Que souhaitez-vous partager aujourd’hui ?", "Actualités officielles", "Photos et vidéos des chaînes officielles.", "Chaînes officielles", "Aucun contenu pour le moment. Retrouvez les actualités sur les chaînes officielles.", "Impossible de charger les vidéos. Consultez la chaîne officielle."],
} satisfies Record<AppLocale, readonly string[]>;

export function discoveryCopy(locale: AppLocale) {
  const [requestFavorite, missingFavorite, communityIntro, writePrompt, officialUpdates, mediaIntro, officialChannels, emptyMedia, unavailableMedia] = labels[locale];
  return { requestFavorite, missingFavorite, communityIntro, writePrompt, officialUpdates, mediaIntro, officialChannels, emptyMedia, unavailableMedia };
}

import type { AppLocale } from "../locales";
import type { LEADERBOARD_CATEGORIES } from "@/features/fanpage/domain/community";

type Category = typeof LEADERBOARD_CATEGORIES[number];
type Copy = {
  filters: string; intro: string; guide: string; equalScores: string; ties: string;
  empty: string; explore: string; medals: readonly [string, string, string];
  categories: Record<Category, string>; descriptions: Record<Category, string>;
};

export const leaderboardActivityCopy: Record<AppLocale, Copy> = {
  ko: {
    filters: "활동별 순위", intro: "전체 또는 활동별 팬점수로 순위를 확인하세요.",
    categories: { all: "전체", knowledge: "퀴즈", live: "LIVE", mission: "미션", certification: "인증" },
    descriptions: {
      all: "퀴즈·LIVE·미션·인증에서 받은 누적 점수예요. 운영 조정 점수는 전체에만 반영돼요.",
      knowledge: "팬 인증 퀴즈를 처음 통과하면 1점을 받아요.",
      live: "LIVE 예약은 1점, 출석은 3점을 받아요.",
      mission: "미션을 완료하면 안내된 점수를 받아요. 미션마다 보상이 달라요.",
      certification: "인증 활동은 승인 후 안내된 점수가 반영돼요.",
    },
    guide: "팬점수는 어떻게 쌓이나요?", equalScores: "같은 활동을 완료했다면 점수도 같을 수 있어요. 활동별 순위에는 해당 활동으로 점수를 받은 팬이 표시돼요.",
    ties: "동점이면 패스포트 발급 시각, 패스포트가 없으면 참여 시각이 빠른 팬이 앞서요.",
    empty: "아직 이 활동으로 점수를 받은 팬이 없어요.", explore: "팬 활동 보러 가기", medals: ["금메달", "은메달", "동메달"],
  },
  en: {
    filters: "Rank by activity", intro: "See your overall Fan Score ranking or explore each activity.",
    categories: { all: "Overall", knowledge: "Quiz", live: "LIVE", mission: "Missions", certification: "Verification" },
    descriptions: {
      all: "Lifetime points from quizzes, LIVE, missions and verifications. Admin adjustments appear only in Overall.",
      knowledge: "Earn 1 point the first time you pass the fan verification quiz.",
      live: "Earn 1 point for a LIVE reservation and 3 points for attendance.",
      mission: "Complete a mission to earn its listed points. Rewards vary by mission.",
      certification: "Verification points are awarded as listed after approval.",
    },
    guide: "How do I earn Fan Score?", equalScores: "Fans who complete the same activities may have the same score. Activity rankings show fans who earned points in that activity.",
    ties: "Ties use the earlier Passport issuance time, or participation time for fans without one.",
    empty: "No fans have earned points for this activity yet.", explore: "Explore fan activities", medals: ["Gold medal", "Silver medal", "Bronze medal"],
  },
  ja: {
    filters: "活動別ランキング", intro: "総合または活動別のFan Scoreランキングを確認できます。",
    categories: { all: "総合", knowledge: "クイズ", live: "LIVE", mission: "ミッション", certification: "認証" },
    descriptions: {
      all: "クイズ・LIVE・ミッション・認証の累計ポイントです。運営による調整は総合のみに反映されます。",
      knowledge: "ファン認証クイズに初めて合格すると1ポイント獲得できます。",
      live: "LIVE予約で1ポイント、出席で3ポイント獲得できます。",
      mission: "ミッションを完了すると、表示されたポイントを獲得できます。報酬はミッションごとに異なります。",
      certification: "認証活動は承認後、表示されたポイントが反映されます。",
    },
    guide: "Fan Scoreの獲得方法", equalScores: "同じ活動を完了したファンは同点になる場合があります。活動別ランキングには、その活動でポイントを獲得したファンが表示されます。",
    ties: "同点の場合はPassport発行時刻、未保有なら参加時刻が早いファンが上位になります。",
    empty: "この活動でポイントを獲得したファンはまだいません。", explore: "ファン活動を見る", medals: ["金メダル", "銀メダル", "銅メダル"],
  },
  "zh-Hans": {
    filters: "按活动排名", intro: "查看总Fan Score排名或各类活动排名。",
    categories: { all: "总榜", knowledge: "答题", live: "LIVE", mission: "任务", certification: "认证" },
    descriptions: {
      all: "答题、LIVE、任务和认证的累计积分。运营调整积分仅计入总榜。",
      knowledge: "首次通过粉丝认证答题可获得1分。", live: "预约LIVE获得1分，签到获得3分。",
      mission: "完成任务可获得页面标明的积分。不同任务的奖励不同。", certification: "认证活动审核通过后，发放页面标明的积分。",
    },
    guide: "如何获得Fan Score？", equalScores: "完成相同活动的粉丝可能积分相同。活动榜仅显示在该活动中获得积分的粉丝。",
    ties: "同分时，Passport发放时间较早的粉丝在前；没有Passport则按参与时间排序。",
    empty: "还没有粉丝通过此活动获得积分。", explore: "查看粉丝活动", medals: ["金牌", "银牌", "铜牌"],
  },
  "zh-Hant": {
    filters: "依活動排名", intro: "查看總Fan Score排名或各類活動排名。",
    categories: { all: "總榜", knowledge: "答題", live: "LIVE", mission: "任務", certification: "認證" },
    descriptions: {
      all: "答題、LIVE、任務和認證的累計積分。營運調整積分僅計入總榜。",
      knowledge: "首次通過粉絲認證答題可獲得1分。", live: "預約LIVE獲得1分，簽到獲得3分。",
      mission: "完成任務可獲得頁面標示的積分。不同任務的獎勵不同。", certification: "認證活動審核通過後，發放頁面標示的積分。",
    },
    guide: "如何獲得Fan Score？", equalScores: "完成相同活動的粉絲可能積分相同。活動榜僅顯示在該活動中獲得積分的粉絲。",
    ties: "同分時，Passport發放時間較早的粉絲在前；沒有Passport則依參與時間排序。",
    empty: "還沒有粉絲透過此活動獲得積分。", explore: "查看粉絲活動", medals: ["金牌", "銀牌", "銅牌"],
  },
  es: {
    filters: "Clasificación por actividad", intro: "Consulta tu clasificación de Fan Score total o por actividad.",
    categories: { all: "Total", knowledge: "Cuestionario", live: "LIVE", mission: "Misiones", certification: "Verificación" },
    descriptions: {
      all: "Puntos acumulados en cuestionarios, LIVE, misiones y verificaciones. Los ajustes del equipo solo cuentan en Total.",
      knowledge: "Gana 1 punto al aprobar por primera vez el cuestionario de verificación de fan.",
      live: "Gana 1 punto por reservar un LIVE y 3 puntos por asistir.",
      mission: "Completa una misión para ganar los puntos indicados. La recompensa varía según la misión.",
      certification: "Los puntos de verificación indicados se conceden tras la aprobación.",
    },
    guide: "¿Cómo se gana Fan Score?", equalScores: "Completar las mismas actividades puede dar la misma puntuación. Cada clasificación muestra a quienes ganaron puntos en esa actividad.",
    ties: "En caso de empate, va primero quien recibió antes su Passport o, si no tiene, quien participó antes.",
    empty: "Aún nadie ha ganado puntos en esta actividad.", explore: "Ver actividades de fans", medals: ["Medalla de oro", "Medalla de plata", "Medalla de bronce"],
  },
  id: {
    filters: "Peringkat per aktivitas", intro: "Lihat peringkat Fan Score keseluruhan atau per aktivitas.",
    categories: { all: "Keseluruhan", knowledge: "Kuis", live: "LIVE", mission: "Misi", certification: "Verifikasi" },
    descriptions: {
      all: "Akumulasi poin dari kuis, LIVE, misi, dan verifikasi. Penyesuaian admin hanya masuk ke Keseluruhan.",
      knowledge: "Dapatkan 1 poin saat pertama kali lulus kuis verifikasi penggemar.",
      live: "Dapatkan 1 poin untuk reservasi LIVE dan 3 poin untuk kehadiran.",
      mission: "Selesaikan misi untuk memperoleh poin yang tercantum. Hadiah berbeda untuk tiap misi.",
      certification: "Poin verifikasi yang tercantum diberikan setelah disetujui.",
    },
    guide: "Bagaimana cara mendapatkan Fan Score?", equalScores: "Penggemar yang menyelesaikan aktivitas yang sama dapat memiliki skor sama. Peringkat aktivitas menampilkan penggemar yang mendapat poin dari aktivitas tersebut.",
    ties: "Jika seri, penggemar dengan Passport yang terbit lebih awal didahulukan, atau waktu partisipasi jika belum memiliki Passport.",
    empty: "Belum ada penggemar yang mendapat poin dari aktivitas ini.", explore: "Lihat aktivitas penggemar", medals: ["Medali emas", "Medali perak", "Medali perunggu"],
  },
  vi: {
    filters: "Xếp hạng theo hoạt động", intro: "Xem thứ hạng Fan Score tổng hoặc theo từng hoạt động.",
    categories: { all: "Tổng", knowledge: "Đố vui", live: "LIVE", mission: "Nhiệm vụ", certification: "Xác minh" },
    descriptions: {
      all: "Điểm tích lũy từ đố vui, LIVE, nhiệm vụ và xác minh. Điểm điều chỉnh chỉ được tính vào Tổng.",
      knowledge: "Nhận 1 điểm khi vượt qua bài đố xác minh fan lần đầu.",
      live: "Nhận 1 điểm khi đăng ký LIVE và 3 điểm khi điểm danh.",
      mission: "Hoàn thành nhiệm vụ để nhận số điểm được ghi. Phần thưởng tùy thuộc vào nhiệm vụ.",
      certification: "Điểm xác minh được ghi sẽ được cộng sau khi phê duyệt.",
    },
    guide: "Làm sao để nhận Fan Score?", equalScores: "Fan hoàn thành cùng hoạt động có thể bằng điểm. Bảng xếp hạng từng hoạt động chỉ hiển thị fan đã nhận điểm từ hoạt động đó.",
    ties: "Nếu bằng điểm, fan được cấp Passport sớm hơn sẽ xếp trước; nếu chưa có Passport thì xét thời gian tham gia.",
    empty: "Chưa có fan nào nhận điểm từ hoạt động này.", explore: "Xem hoạt động fan", medals: ["Huy chương vàng", "Huy chương bạc", "Huy chương đồng"],
  },
  th: {
    filters: "อันดับตามกิจกรรม", intro: "ดูอันดับ Fan Score รวม หรือแยกตามกิจกรรม",
    categories: { all: "รวม", knowledge: "แบบทดสอบ", live: "LIVE", mission: "ภารกิจ", certification: "การยืนยัน" },
    descriptions: {
      all: "คะแนนสะสมจากแบบทดสอบ LIVE ภารกิจ และการยืนยัน คะแนนที่ทีมงานปรับจะแสดงในอันดับรวมเท่านั้น",
      knowledge: "รับ 1 คะแนนเมื่อผ่านแบบทดสอบยืนยันแฟนเป็นครั้งแรก",
      live: "รับ 1 คะแนนเมื่อจอง LIVE และ 3 คะแนนเมื่อเช็กอิน",
      mission: "ทำภารกิจให้สำเร็จเพื่อรับคะแนนตามที่ระบุ รางวัลแตกต่างกันตามภารกิจ",
      certification: "คะแนนการยืนยันตามที่ระบุจะได้รับหลังจากอนุมัติ",
    },
    guide: "จะได้รับ Fan Score ได้อย่างไร?", equalScores: "แฟนที่ทำกิจกรรมเดียวกันอาจมีคะแนนเท่ากัน อันดับตามกิจกรรมจะแสดงเฉพาะแฟนที่ได้รับคะแนนจากกิจกรรมนั้น",
    ties: "หากคะแนนเท่ากัน ผู้ที่ได้รับ Passport ก่อนจะอยู่อันดับสูงกว่า หากไม่มี Passport จะใช้เวลาเข้าร่วม",
    empty: "ยังไม่มีแฟนได้รับคะแนนจากกิจกรรมนี้", explore: "ดูกิจกรรมแฟน", medals: ["เหรียญทอง", "เหรียญเงิน", "เหรียญทองแดง"],
  },
  pt: {
    filters: "Ranking por atividade", intro: "Veja seu ranking de Fan Score geral ou por atividade.",
    categories: { all: "Geral", knowledge: "Quiz", live: "LIVE", mission: "Missões", certification: "Verificação" },
    descriptions: {
      all: "Pontos acumulados em quizzes, LIVE, missões e verificações. Ajustes da equipe entram apenas no Geral.",
      knowledge: "Ganhe 1 ponto ao passar pela primeira vez no quiz de verificação de fã.",
      live: "Ganhe 1 ponto ao reservar um LIVE e 3 pontos pela presença.",
      mission: "Conclua uma missão para ganhar os pontos indicados. A recompensa varia por missão.",
      certification: "Os pontos de verificação indicados são concedidos após a aprovação.",
    },
    guide: "Como ganhar Fan Score?", equalScores: "Fãs que concluem as mesmas atividades podem ter a mesma pontuação. Cada ranking mostra quem ganhou pontos naquela atividade.",
    ties: "Em caso de empate, fica à frente quem recebeu o Passport antes ou, sem Passport, quem participou antes.",
    empty: "Nenhum fã ganhou pontos nesta atividade ainda.", explore: "Ver atividades de fãs", medals: ["Medalha de ouro", "Medalha de prata", "Medalha de bronze"],
  },
  fr: {
    filters: "Classement par activité", intro: "Consultez votre classement Fan Score global ou par activité.",
    categories: { all: "Global", knowledge: "Quiz", live: "LIVE", mission: "Missions", certification: "Vérification" },
    descriptions: {
      all: "Points cumulés des quiz, LIVE, missions et vérifications. Les ajustements de l’équipe comptent uniquement dans Global.",
      knowledge: "Gagnez 1 point en réussissant le quiz de vérification de fan pour la première fois.",
      live: "Gagnez 1 point en réservant un LIVE et 3 points en y participant.",
      mission: "Terminez une mission pour gagner les points indiqués. La récompense varie selon la mission.",
      certification: "Les points de vérification indiqués sont attribués après validation.",
    },
    guide: "Comment gagner du Fan Score ?", equalScores: "Les fans ayant terminé les mêmes activités peuvent avoir le même score. Chaque classement affiche les fans ayant gagné des points pour cette activité.",
    ties: "En cas d’égalité, le Passport émis le plus tôt est prioritaire ou, sans Passport, la participation la plus ancienne.",
    empty: "Aucun fan n’a encore gagné de points pour cette activité.", explore: "Voir les activités de fans", medals: ["Médaille d’or", "Médaille d’argent", "Médaille de bronze"],
  },
};

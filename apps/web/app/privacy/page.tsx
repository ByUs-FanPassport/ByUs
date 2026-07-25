import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

// Operations draft: obtain Korean legal review before the production policy is finalized.
export const metadata: Metadata = {
  title: "개인정보처리방침 | ByUs",
  description: "ByUs 개인정보처리방침",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="개인정보처리방침"
      description="Sallylab Inc.는 ByUs를 이용하는 팬의 개인정보를 필요한 범위에서만 처리하고 안전하게 보호하기 위해 다음과 같이 개인정보처리방침을 안내합니다."
    >
      <section>
        <h2>1. 처리하는 개인정보</h2>
        <p>회사는 회원가입과 서비스 제공 과정에서 다음 정보를 처리할 수 있습니다.</p>
        <ul>
          <li>Google 및 Privy 인증 식별자, 인증된 이메일 주소</li>
          <li>닉네임, Embedded Wallet 주소와 체인 식별 정보</li>
          <li>팬 인증 참여와 결과, Fan Passport 및 Stamp 발급·상태 정보</li>
          <li>LIVE 예약·출석·설문 참여 정보</li>
          <li>혜택 신청·수령·사용 상태와 알림 설정·구독 정보</li>
          <li>서비스 이용 과정에서 생성되는 접속 기록, 오류 및 보안 이벤트</li>
        </ul>
      </section>

      <section>
        <h2>2. 처리 목적</h2>
        <ul>
          <li>회원 식별, 로그인 유지 및 계정 보호</li>
          <li>팬 인증, Passport·Stamp 발급과 소유자 확인</li>
          <li>LIVE 예약·출석·설문 및 혜택 제공</li>
          <li>알림 발송, 문의 대응과 서비스 품질 개선</li>
          <li>부정 이용 방지, 보안 사고 대응과 법적 의무 이행</li>
        </ul>
      </section>

      <section>
        <h2>3. 보유 및 이용 기간</h2>
        <p>개인정보는 서비스 제공과 계정 유지에 필요한 기간 동안 보유하며, 처리 목적이 달성되거나 이용자가 삭제를 요청한 경우 지체 없이 파기합니다. 다만 관계 법령에서 일정 기간 보관을 요구하거나 분쟁·보안 대응을 위해 필요한 경우에는 해당 목적에 필요한 범위와 기간 동안 분리하여 보관할 수 있습니다.</p>
      </section>

      <section>
        <h2>4. 외부 서비스 이용</h2>
        <p>회사는 로그인과 Embedded Wallet 제공을 위해 Google 및 Privy의 인증·지갑 서비스를 이용합니다. 각 서비스 제공자는 인증 과정에서 필요한 식별 정보와 기술 정보를 자체 정책에 따라 처리할 수 있습니다. 회사는 서비스 제공에 필요한 범위를 넘어 개인정보를 판매하지 않습니다.</p>
      </section>

      <section>
        <h2>5. 이용자의 권리</h2>
        <p>이용자는 자신의 개인정보에 대한 열람, 정정, 삭제, 처리 정지 및 동의 철회를 요청할 수 있습니다. 요청은 아래 이메일로 접수할 수 있으며, 회사는 본인 확인 후 관계 법령에 따라 처리합니다.</p>
      </section>

      <section>
        <h2>6. 안전성 확보 조치</h2>
        <p>회사는 인증 정보의 서버 검증, 권한에 따른 접근 통제, 민감 정보의 비공개 처리, 운영 기록의 제한과 점검 등 개인정보 보호에 필요한 기술적·관리적 조치를 적용합니다.</p>
      </section>

      <section>
        <h2>7. 문의처</h2>
        <p>개인정보 보호와 관련한 문의 및 권리 행사는 Sallylab Inc.의 개인정보 담당 창구 <a href="mailto:biz@sallylab.io">biz@sallylab.io</a>로 보내 주세요.</p>
      </section>

      <section>
        <h2>8. 방침의 변경</h2>
        <p>법령이나 서비스 내용이 변경되어 본 방침을 수정하는 경우, 시행 전에 ByUs 서비스 내에서 변경 내용과 시행일을 안내합니다.</p>
      </section>
    </LegalPage>
  );
}

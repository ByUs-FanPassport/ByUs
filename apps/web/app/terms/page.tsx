import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

// Operations draft: obtain Korean legal review before the production terms are finalized.
export const metadata: Metadata = {
  title: "이용약관 | ByUs",
  description: "ByUs 서비스 이용약관",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="이용약관"
      description="이 약관은 Sallylab Inc.가 제공하는 ByUs 서비스의 이용 조건과 회사 및 이용자의 권리와 책임을 정합니다."
    >
      <section>
        <h2>1. 약관의 목적과 적용</h2>
        <p>이 약관은 ByUs 웹·앱과 이에 연결된 팬 인증, LIVE 참여, Fan Passport, Stamp, 혜택 및 알림 기능에 적용됩니다. 이용자가 Google 로그인을 완료하고 서비스를 사용하면 이 약관과 개인정보처리방침에 동의한 것으로 봅니다.</p>
      </section>

      <section>
        <h2>2. 계정과 인증</h2>
        <ul>
          <li>이용자는 본인이 사용할 권한이 있는 Google 계정으로 로그인해야 합니다.</li>
          <li>계정과 인증 수단을 안전하게 관리할 책임은 이용자에게 있습니다.</li>
          <li>부정 이용이나 보안 위험이 확인되면 회사는 계정 보호를 위해 이용을 제한하거나 추가 확인을 요청할 수 있습니다.</li>
        </ul>
      </section>

      <section>
        <h2>3. 팬 인증과 디지털 기록</h2>
        <p>팬 인증 결과, Fan Passport와 Stamp는 ByUs 안에서 팬 활동을 기록하고 관련 기능을 제공하기 위한 디지털 기록입니다. 별도의 명시가 없는 한 현금, 증권, 투자 상품 또는 회사에 대한 권리를 의미하지 않습니다.</p>
      </section>

      <section>
        <h2>4. LIVE와 혜택</h2>
        <p>LIVE 일정, 예약, 출석 방식과 혜택의 수량·조건·기간은 각 화면에 표시된 안내를 따릅니다. 셀럽, 브랜드 또는 운영상 사유로 일정이나 제공 조건이 변경될 수 있으며, 회사는 가능한 범위에서 변경 내용을 안내합니다.</p>
      </section>

      <section>
        <h2>5. 금지 행위</h2>
        <ul>
          <li>타인의 계정, 인증 정보 또는 혜택을 도용하거나 거래하는 행위</li>
          <li>자동화 도구, 비정상적인 요청 또는 기술적 우회로 서비스 운영을 방해하는 행위</li>
          <li>팬 인증과 참여 결과를 조작하거나 허위 정보를 제출하는 행위</li>
          <li>다른 이용자, 셀럽, 브랜드 또는 회사의 권리를 침해하는 행위</li>
          <li>관계 법령 또는 공공질서에 위반되는 행위</li>
        </ul>
      </section>

      <section>
        <h2>6. 서비스 변경과 중단</h2>
        <p>회사는 서비스 개선, 보안, 점검, 제휴 관계 또는 불가피한 운영 사유에 따라 기능을 변경하거나 일시 중단할 수 있습니다. 이용자에게 중대한 영향을 주는 변경은 합리적인 방법으로 사전에 안내하되, 긴급한 보안 대응 등 사전 안내가 어려운 경우에는 사후 안내할 수 있습니다.</p>
      </section>

      <section>
        <h2>7. 책임의 범위</h2>
        <p>회사는 고의 또는 중대한 과실이 없는 한 천재지변, 통신 장애, 외부 인증·지갑·네트워크 서비스의 장애 또는 이용자의 귀책 사유로 발생한 손해에 책임을 지지 않습니다. 관계 법령상 제한할 수 없는 책임은 이 조항의 영향을 받지 않습니다.</p>
      </section>

      <section>
        <h2>8. 준거법과 관할</h2>
        <p>이 약관은 대한민국 법률에 따라 해석됩니다. 서비스 이용과 관련한 분쟁은 당사자 간 협의를 우선하며, 해결되지 않는 경우 대한민국 민사소송법상 관할 법원을 제1심 전속 관할 법원으로 합니다.</p>
      </section>

      <section>
        <h2>9. 문의</h2>
        <p>서비스 또는 약관에 관한 문의는 Sallylab Inc.의 <a href="mailto:biz@sallylab.io">biz@sallylab.io</a>로 보내 주세요.</p>
      </section>
    </LegalPage>
  );
}

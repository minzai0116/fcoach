export default function PrivacyPage() {
  return (
    <main className="container grid">
      <section className="panel">
        <h1 className="title">개인정보처리방침</h1>
        <p className="muted">최종 업데이트: 2026-03-13 (KST)</p>
      </section>

      <section className="panel">
        <h2 className="section-title">1. 수집 항목 및 방식</h2>
        <ul className="list">
          <li>사용자 입력: FC Online 닉네임</li>
          <li>외부 조회값: OUID, 경기/선수 관련 통계(Open API 응답 기반)</li>
          <li>서비스 로그: 오류/성능 추적을 위한 최소한의 운영 로그</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="section-title">2. 처리 목적</h2>
        <ul className="list">
          <li>전술 코칭 리포트 생성 및 개선 추적 제공</li>
          <li>랭커 비교/선수 리포트/전술 코칭 제공</li>
          <li>서비스 안정성 확보 및 품질 개선</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="section-title">3. 보관 기간 및 파기</h2>
        <ul className="list">
          <li>분석 데이터는 서비스 제공을 위해 SQLite 저장소에 보관됩니다.</li>
          <li>데이터 삭제 요청 접수 시 확인 후 지체 없이 파기합니다.</li>
          <li>법령상 보존 의무가 있는 경우 해당 기간 동안 별도 보관할 수 있습니다.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="section-title">4. 제3자 제공 및 처리위탁</h2>
        <p className="muted">
          본 서비스는 Nexon Open API를 호출하여 데이터를 조회하며, 별도 광고성 제3자 제공을 하지 않습니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="section-title">5. 이용자 권리</h2>
        <p className="muted">
          이용자는 자신의 데이터 열람/정정/삭제를 요청할 수 있으며, 운영자는 본인 확인 후 처리합니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="section-title">6. 문의처</h2>
        <p className="muted">개인정보 문의: abcda2@naver.com</p>
      </section>
    </main>
  );
}

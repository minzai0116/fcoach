export default function TermsPage() {
  return (
    <main className="container grid">
      <section className="panel">
        <h1 className="title">이용약관</h1>
        <p className="muted">최종 업데이트: 2026-03-13 (KST)</p>
      </section>

      <section className="panel">
        <h2 className="section-title">1. 서비스 목적</h2>
        <p className="muted">FCOACH는 FC Online 전적 데이터를 바탕으로 분석·코칭 정보를 제공하는 참고 서비스입니다.</p>
      </section>

      <section className="panel">
        <h2 className="section-title">2. 계정 및 데이터 이용</h2>
        <ul className="list">
          <li>사용자는 본인이 조회할 권한이 있는 닉네임/데이터만 이용해야 합니다.</li>
          <li>외부 API 정책 변경 또는 호출 제한에 따라 일부 기능이 제한될 수 있습니다.</li>
          <li>서비스는 제공 범위 내에서 합리적으로 유지·보수됩니다.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="section-title">3. 책임 제한</h2>
        <ul className="list">
          <li>본 서비스의 추천은 확률적 분석 결과이며 승률을 보장하지 않습니다.</li>
          <li>게임 내 정책 변경, 패치, 이벤트에 따라 결과가 달라질 수 있습니다.</li>
          <li>서비스 장애·외부 API 장애로 인해 일부 기능이 일시 중단될 수 있습니다.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="section-title">4. 금지 행위</h2>
        <ul className="list">
          <li>서비스 악용(대량 자동 호출, 우회 요청, 무단 재배포)</li>
          <li>타인의 계정 정보 도용 및 허위 데이터 입력</li>
          <li>법령 또는 공서양속에 반하는 사용</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="section-title">5. 문의</h2>
        <p className="muted">서비스 문의: abcda2@naver.com</p>
      </section>
    </main>
  );
}

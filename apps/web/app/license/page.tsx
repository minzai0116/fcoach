export default function LicensePage() {
  return (
    <main className="container grid">
      <section className="panel">
        <h1 className="title">라이선스 고지</h1>
        <p className="muted">최종 업데이트: 2026-03-13 (KST)</p>
      </section>

      <section className="panel">
        <h2 className="section-title">1. 데이터 출처</h2>
        <ul className="list">
          <li>Data by Nexon Open API</li>
          <li>일부 시즌/선수 이미지는 Nexon CDN 공개 자산 URL을 참조합니다.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="section-title">2. 상표/저작권</h2>
        <p className="muted">
          FC Online 및 관련 로고·이미지의 권리는 각 권리자에게 있습니다. 본 서비스는 비공식 분석 도구이며,
          사용자 경험 개선 목적의 참조 정보를 제공합니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="section-title">3. 서비스 코드 라이선스</h2>
        <p className="muted">
          본 프로젝트의 소스코드 라이선스는 저장소 루트의 <code>LICENSE</code> 파일을 따릅니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="section-title">4. 오픈소스 구성요소</h2>
        <p className="muted">
          Next.js, React, FastAPI 등 오픈소스 라이브러리를 사용하며, 세부 라이선스는 각 패키지의 고지 문서를 따릅니다.
        </p>
      </section>
    </main>
  );
}

"use client";

type GuideScreenProps = {
  hasAnalysis: boolean;
  onStartSearch: () => void;
  onOpenPlayers: () => void;
  onOpenActions: () => void;
  onOpenTracking: () => void;
};
const STEPS = [
  { number: "01", title: "닉네임 입력 → 경기 분석 시작", body: "공식경기·공식 친선 최근 30경기를 분석합니다. 몰수승·몰수패도 포함합니다." },
  { number: "02", title: "팀·선수·경기별로 비교하세요", body: "팀 분석에서 세부 지표와 랭커 평균을, 선수 비교에서 두 선수의 기록을, 경기별 분석에서 상대와의 기록 차이를 확인하세요." },
  { number: "03", title: "맞춤 코칭을 확인하세요", body: "강점은 유지하고, 보완 지표에 맞는 플레이와 전술 제안을 확인하세요." },
  { number: "04", title: "최근 경기 추이에서 변화를 보세요", body: "각 경기 시점의 최근 30경기 기록을 그래프로 보여줍니다. 새 경기를 했다면 ‘최근 경기로 갱신’을 누르세요." },
];
const FEATURES = [
  { title: "팀 분석", body: "상대보다 앞선 지표와 낮은 지표를 나눠 보여줍니다. 영역 점수를 누르면 세부 기록과 추천 플레이가 나옵니다." },
  { title: "선수 분석", body: "최근 경기 등록 포지션으로 표시합니다. ‘선수 변경’에서 같은 자리의 다른 선수를 고를 수 있습니다. 모바일에서는 ‘자세히 보기’로 상세 화면을 엽니다." },
  { title: "선수 비교", body: "두 선수를 골라 출전 수·경기당 기록·성공률을 비교하세요. 시즌·강화·포지션으로 기록을 구분합니다." },
  { title: "슈팅 위치", body: "선수와 슈팅 유형을 골라 보세요. PC에서는 점에 마우스를 올리고, 모바일에서는 점을 누르면 슈팅 정보가 나옵니다." },
  { title: "랭커 비교", body: "최근 30경기와 랭커 평균을 비교합니다. 영역마다 강점 지표와 보완 지표를 먼저 보여줍니다." },
  { title: "최근 경기 추이", body: "득점·패스·슈팅·수비 기록이 경기마다 어떻게 변했는지 확인하세요. 변화가 큰 지표를 누르면 해당 그래프가 열립니다." },
];
export function GuideScreen({ hasAnalysis, onStartSearch, onOpenPlayers, onOpenActions, onOpenTracking }: GuideScreenProps) {
  return <section className="grid guide-current">
    <article className="panel guide-hero"><h2 className="section-title">이용 방법</h2><p><strong>내 경기의 장점과 보완점을 확인하고, 바꿀 플레이를 찾아보세요.</strong></p><p>FC온라인 경기 기록을 선수·팀·한 경기 단위로 분석합니다. 공개 피드를 연결하면 저장된 전술·특성·훈련코치도 함께 참고할 수 있습니다.</p><div className="button-row"><button className="btn" onClick={onStartSearch}>경기 검색 시작하기</button><button className="btn secondary" onClick={onOpenTracking}>최근 경기 추이 보기</button></div></article>
    <article className="panel"><h3 className="section-title">시작은 두 단계면 됩니다</h3><p><strong>닉네임 입력 → 경기 분석 시작</strong></p><p>전술·특성·훈련코치까지 참고하려면 분석 전에 ‘닉네임의 공개 피드 불러오기’에서 공개 피드 하나를 선택하세요. 피드 연결은 선택 사항입니다.</p><div className="guide-current-steps">{STEPS.map(step => <section key={step.number}><span>{step.number}</span><div><h4>{step.title}</h4><p>{step.body}</p></div></section>)}</div></article>
    <article className="panel"><div className="coaching-section-heading"><h3 className="section-title">화면에서 확인할 수 있는 것</h3>{hasAnalysis && <div className="button-row"><button className="btn secondary" onClick={onOpenPlayers}>선수 분석 보기</button><button className="btn secondary" onClick={onOpenActions}>맞춤 코칭 보기</button></div>}</div><div className="guide-feature-grid">{FEATURES.map(item => <section key={item.title}><h4>{item.title}</h4><p>{item.body}</p></section>)}</div></article>
    <article className="panel guide-faq"><h3 className="section-title">자주 묻는 질문</h3>
      <details><summary>공개 피드는 어떻게 연결하나요?</summary><p>스쿼드메이커에서 피드를 공개 공유한 뒤, 경기 검색에서 ‘닉네임의 공개 피드 불러오기’를 누르세요. 저장한 미니페이스온과 신규 특성을 표시합니다. 같은 카드·포지션이면 강화가 달라도 설정·특성에서 기본·획득 특성, 훈련코치와 개인 전술을 볼 수 있습니다. 다른 강화의 설정에는 피드의 저장 강화를 표시합니다.</p></details>
      <details><summary>비교 색상은 무엇을 뜻하나요?</summary><p>선수 비교는 첫 번째 선수 파랑, 두 번째 선수 보라로 고정합니다. 랭커·상대 비교는 파랑이 앞선 방향, 빨강이 낮은 방향입니다. 사용 비중·거리 같은 참고 기록은 중립색입니다.</p></details>
      <details><summary>닉네임을 검색해도 경기가 나오지 않아요.</summary><p>닉네임과 최근 경기 내역을 확인하세요. 연결 실패·점검·호출 제한이 표시되면 잠시 후 다시 조회하세요.</p></details>
    </article>
  </section>;
}

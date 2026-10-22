"use client";

type GuideScreenProps = {
  hasAnalysis: boolean;
  onStartSearch: () => void;
  onOpenPlayers: () => void;
  onOpenActions: () => void;
  onOpenTracking: () => void;
};
const STEPS = [
  { number: "01", title: "분석할 경기를 고르세요", body: "검색/설정에서 닉네임과 경기 모드를 입력하고 경기 목록을 불러오세요. 시작·종료 경기를 고르면 그 사이 경기를 모두 분석합니다. 종료를 지정하지 않으면 최신 경기까지 포함합니다." },
  { number: "02", title: "선수와 팀의 기록을 확인하세요", body: "포메이션에서 선수를 선택하면 경기 기록·설정과 특성·종합 코칭을 볼 수 있습니다. 모바일에서는 선수 선택 후 ‘자세히 보기’를 누르고, 뒤로가기로 포메이션에 돌아옵니다." },
  { number: "03", title: "바꿀 플레이를 바로 확인하세요", body: "전술 처방에서는 팀·선수별 행동과 훈련코치 선택지를 확인하세요. 종합 코칭은 현재 기록과 이전 경기 대비 변화를 구분해 설명합니다. 여러 설정을 한꺼번에 바꾸기보다 한 가지씩 적용하세요." },
  { number: "04", title: "개선 전·후 경기를 직접 비교하세요", body: "개선 추적에서 경기를 ‘개선 전’과 ‘개선 후’로 나누세요. 범위로 고르거나 경기를 하나씩 선택할 수 있습니다. 별도 등록 없이 수치 변화와 유지·보완할 플레이를 볼 수 있습니다." },
];
const FEATURES = [
  { title: "선수 분석", body: "사진 아래 시즌·강화·이름으로 카드를 구분합니다. 골키퍼는 선방 횟수와 배급 등 역할에 맞는 기록을 보여줍니다." },
  { title: "팀 기록", body: "패스 유형별 성공률·사용 비중, 슈팅 종류와 위치, 수비·드리블·경합 기록을 비교합니다. 슈팅 점에 마우스를 올리거나 모바일에서 누르면 슈팅한 선수를 확인할 수 있습니다." },
  { title: "경기별 분석", body: "상대 정보와 그 경기의 양 팀 기록을 비교합니다. 앞선 점과 ‘이 경기 개선점’에서 해당 경기에 필요한 플레이를 확인하세요." },
  { title: "전후 비교", body: "경기 수가 달라도 득점·실점·횟수는 경기당 평균으로, 성공률은 성공 합계 ÷ 시도 합계로 비교합니다. 패스·슈팅·수비 등 영역별 수치와 변화량을 보여줍니다." },
];
export function GuideScreen({ hasAnalysis, onStartSearch, onOpenPlayers, onOpenActions, onOpenTracking }: GuideScreenProps) {
  return <section className="grid guide-current">
    <article className="panel guide-hero"><p className="eyebrow">FCOACH 이용가이드</p><h2 className="section-title">내 경기에서 확인하고, 바꿀 플레이를 찾고, 전후를 비교하세요</h2><p>FC온라인 경기 기록을 선수·팀·한 경기 단위로 분석합니다. 공개 피드를 연결하면 저장된 전술·특성·훈련코치도 함께 참고할 수 있습니다.</p><div className="button-row"><button className="btn" onClick={onStartSearch}>닉네임으로 경기 불러오기</button><button className="btn secondary" onClick={onOpenTracking}>개선 전·후 비교하기</button></div></article>
    <article className="panel"><h3 className="section-title">이 순서로 사용하세요</h3><div className="guide-current-steps">{STEPS.map(step => <section key={step.number}><span>{step.number}</span><div><h4>{step.title}</h4><p>{step.body}</p></div></section>)}</div></article>
    <article className="panel"><div className="coaching-section-heading"><h3 className="section-title">화면에서 확인할 수 있는 것</h3>{hasAnalysis && <div className="button-row"><button className="btn secondary" onClick={onOpenPlayers}>선수·경기 분석</button><button className="btn secondary" onClick={onOpenActions}>전술·플레이 제안</button></div>}</div><div className="guide-feature-grid">{FEATURES.map(item => <section key={item.title}><h4>{item.title}</h4><p>{item.body}</p></section>)}</div></article>
    <article className="panel guide-faq"><h3 className="section-title">알아두면 좋은 점</h3>
      <details><summary>닉네임만으로 무엇을 볼 수 있나요?</summary><p>경기 기록과 선수·팀 분석은 닉네임만으로 이용할 수 있습니다. 전술·특성·훈련코치는 닉네임의 공개 스쿼드 피드 하나를 선택해 연결합니다. 게임 안의 전술 슬롯 번호나 현재 장착 설정을 직접 조회하는 기능은 제공하지 않습니다.</p></details>
      <details><summary>공개 피드가 실제 경기 설정과 같은가요?</summary><p>피드는 저장한 시점의 설정입니다. 카드·강화·포지션이 맞는 기록에 연결하며, 다른 값과 피드에 없는 값은 구분합니다. 과거 경기에서 같은 설정을 사용했는지와 특성이 발동했는지는 확인할 수 없습니다.</p></details>
      <details><summary>수치가 낮으면 무조건 문제인가요?</summary><p>그렇지 않습니다. 선수 종합 코칭은 같은 모드·카드·강화·자리의 이전 기록과 비교하며, 팀 코칭은 같은 모드의 이전 정상 종료 경기와 비교합니다. 경기별 분석은 그 경기의 상대 기록과 비교합니다. 비교 근거가 없으면 문제라고 단정하지 않고, 관측한 기록과 역할에 맞춘 플레이 선택지를 제안합니다.</p></details>
      <details><summary>개선 추적의 ‘개선’은 무엇을 뜻하나요?</summary><p>사용자가 고른 두 경기 구간의 실제 수치가 어느 방향으로 변했는지를 뜻합니다. 상대·선수 구성·슈팅 난이도가 달라질 수 있어 특정 설정이나 코치 덕분이라고 단정하지 않습니다. 점유율·드리블 거리처럼 높다고 항상 좋은 것은 아닌 지표는 참고 지표로 표시합니다.</p></details>
      <details><summary>랭커 비교와 예상 득점은 어떤 자료인가요?</summary><p>랭킹 목록과 실제 경기 기록은 별도 자료입니다. 같은 공식경기 모드의 랭커 경기 기록이 있을 때만 플레이 수치를 비교하며, 승률만으로 성향이 비슷하다고 판단하지 않습니다. 대시보드의 예상 득점은 서비스 자체 추정값이며 공식 기록이나 코칭의 비교 기준으로 사용하지 않습니다.</p></details>
      <details><summary>닉네임을 검색해도 경기가 나오지 않아요.</summary><p>구단주를 찾을 수 없다는 안내가 나오면 닉네임을 확인하세요. 구단주는 조회되지만 경기 내역이 없다면 다른 경기 모드를 선택해보세요. 조회 서비스의 연결 실패·점검·호출 제한은 기록 없음과 구분해서 안내합니다.</p></details>
      <details><summary>몰수 경기와 기록이 없는 항목은 어떻게 처리하나요?</summary><p>몰수승·몰수패는 기본 제외하며 각각 포함 여부를 선택할 수 있습니다. 알 수 없는 종료 유형은 제외합니다. 시도하지 않았거나 제공되지 않은 수치를 0%로 해석하지 않습니다. 세부 집계 방식은 각 화면 위의 ‘분석 안내’ 또는 ‘집계 기준’에서 확인하세요.</p></details>
    </article>
  </section>;
}

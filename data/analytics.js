/* 방문자·유입경로·쿠팡 클릭 측정 설정
 *
 * 둘 중 하나만 채우면 됩니다. 둘 다 비어 있으면 아무것도 불러오지 않고
 * 네트워크 요청도, 쿠키도 만들지 않습니다. (지금이 그 상태입니다)
 *
 *  Cloudflare Web Analytics — 쿠키 없음, 동의 배너 불필요, 설정 간단
 *    Cloudflare → Analytics & Logs → Web Analytics → Add a site
 *    → recipe.eliteaja.com 등록 → 받은 토큰을 아래에 붙여넣기
 *    다만 페이지뷰만 셉니다. 쿠팡 클릭은 안 잡힙니다.
 *
 *  GA4 — 페이지뷰 + 쿠팡 클릭까지. 대신 쿠키를 쓰므로 동의 배너가 필요할 수 있습니다.
 *    analytics.google.com → 속성 만들기 → 웹 스트림 → 측정 ID(G-...) 를 아래에
 *
 * 둘 다 넣으면 둘 다 동작합니다. (Cloudflare 로 방문자, GA4 로 클릭)
 */
window.ANALYTICS = {

  // ── 여기만 채우면 됩니다 ──────────────────────
  cloudflareToken: '',      // 예: 'a1b2c3d4e5f6...'
  ga4Id: '',                // 예: 'G-XXXXXXXXXX'
  // ────────────────────────────────────────────

  // 콘솔에 측정 내용을 찍어 확인하고 싶을 때
  debug: false
};

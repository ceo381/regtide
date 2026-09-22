/**
 * 규격·인증 카탈로그
 * - 사용자가 품목별로 선택하는 옵션이며, 수집된 업데이트를 매칭하는 기준이 됩니다.
 * - keywords: 제목·본문 키워드 매칭에 사용 (제목 3점, 본문 1점). 매칭 정확도는 이 목록의 품질에 달려 있습니다.
 * - sources: 이 항목과 관련된 업데이트가 주로 나오는 수집 소스 키
 */

export type Jurisdiction = "KR" | "US" | "EU" | "INTL";

export interface CatalogItem {
  id: string;
  group: string;
  jurisdiction: Jurisdiction;
  label: string;
  description: string;
  keywords: string[];
  sources: string[];
}

export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  KR: "한국 (식약처 MFDS)",
  US: "미국 (FDA)",
  EU: "유럽 (EU MDR/IVDR)",
  INTL: "국제규격 (ISO/IEC)",
};

export const PRODUCT_CATEGORIES = [
  "1등급",
  "2등급",
  "3등급",
  "4등급",
  "체외진단의료기기",
  "디지털의료기기(SaMD)",
  "능동형 전기·전자기기",
  "이식형",
  "멸균 제품",
  "기타",
] as const;

const KR_SOURCES = ["mfds_rss:data0009", "mfds_rss:data0005", "mfds_rss:data0006", "mfds_rss:data0007", "mfds_rss:data0013", "mfds_rss:ntc0003", "mfds_rss:ntc0004", "mfds_rss:ntc0021", "mfds_rss:seohan001", "law_go_kr"];
const US_SOURCES = ["federal_register"];
const EU_SOURCES = ["page_watch:eu_md_latest", "page_watch:eu_harmonised"];
const ISO_SOURCES = ["page_watch:iso", "page_watch:iec", "page_watch:fda_recognized_standards"];

export const CATALOG: CatalogItem[] = [
  // ───────────── 한국 (MFDS) ─────────────
  {
    id: "kr-mdact",
    group: "법률·시행령·시행규칙",
    jurisdiction: "KR",
    label: "의료기기법 · 시행령 · 시행규칙",
    description: "의료기기 제조·수입·판매 전반의 상위 법령 및 개정(안) 입법예고",
    keywords: ["의료기기법", "의료기기법 시행령", "의료기기법 시행규칙"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-digital-act",
    group: "법률·시행령·시행규칙",
    jurisdiction: "KR",
    label: "디지털의료제품법 · 하위규정",
    description: "디지털의료기기(SaMD, AI) 허가·인증·임상·사이버보안 관련 법령",
    keywords: ["디지털의료제품", "디지털의료기기", "인공지능 의료기기", "AI 의료기기", "소프트웨어 의료기기"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-ivd-act",
    group: "법률·시행령·시행규칙",
    jurisdiction: "KR",
    label: "체외진단의료기기법 · 하위규정",
    description: "체외진단의료기기 허가·임상적 성능시험·품질관리 관련 법령",
    keywords: ["체외진단", "체외진단의료기기법", "임상적 성능시험"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-approval",
    group: "허가·심사 고시",
    jurisdiction: "KR",
    label: "의료기기 허가·신고·심사 등에 관한 규정",
    description: "품목허가·인증·신고 절차, 기술문서 심사 기준 고시",
    keywords: ["허가·신고·심사", "허가신고심사", "기술문서", "품목허가", "품목신고", "변경허가"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-classification",
    group: "허가·심사 고시",
    jurisdiction: "KR",
    label: "의료기기 품목 및 품목별 등급에 관한 규정",
    description: "품목 분류 코드 신설·변경·등급 조정 고시",
    keywords: ["품목 및 품목별 등급", "품목별 등급", "등급 조정", "품목 분류"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-gmp",
    group: "품질관리",
    jurisdiction: "KR",
    label: "의료기기 제조 및 품질관리 기준 (KGMP)",
    description: "GMP 적합성 인정, 심사 절차, 제조소 관리 기준 고시",
    keywords: ["제조 및 품질관리 기준", "GMP", "적합성인정", "적합인정", "품질관리기준", "제조소"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-clinical",
    group: "허가·심사 고시",
    jurisdiction: "KR",
    label: "의료기기 임상시험 계획 승인 · 관리 기준",
    description: "임상시험 계획 승인, 임상시험기관 지정, 임상시험 관리기준(GCP)",
    keywords: ["임상시험", "임상시험계획", "임상시험기관", "GCP"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-vigilance",
    group: "시판후 관리",
    jurisdiction: "KR",
    label: "부작용 보고 · 회수 · 추적관리 · 재평가",
    description: "이상사례 보고, 회수·판매중지, 추적관리대상 의료기기, 재평가 관련 고시",
    keywords: ["부작용", "이상사례", "회수", "판매중지", "추적관리", "재평가", "안전성 정보"],
    sources: [...KR_SOURCES, "mfds_rss:plc0139", "mfds_rss:plc0168"],
  },
  {
    id: "kr-udi",
    group: "시판후 관리",
    jurisdiction: "KR",
    label: "표준코드(UDI) · 공급내역 보고",
    description: "의료기기 표준코드 부여, 통합정보시스템 공급내역 보고 관련",
    keywords: ["표준코드", "UDI", "공급내역", "통합정보시스템", "통합정보센터"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-labeling-ad",
    group: "표시·광고",
    jurisdiction: "KR",
    label: "표시·기재 · 광고 심의",
    description: "용기·외장·첨부문서 기재사항, 광고 사전심의 및 금지 광고 관련",
    keywords: ["표시·기재", "기재사항", "첨부문서", "광고", "광고심의"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-cyber",
    group: "기술 기준·안내서",
    jurisdiction: "KR",
    label: "의료기기 사이버보안 허가·심사 안내서",
    description: "사이버보안 요구사항, SBOM, 위협 모델링 관련 안내서·가이드라인",
    keywords: ["사이버보안", "사이버 보안", "SBOM", "정보보안", "보안 취약점"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-standards",
    group: "기술 기준·안내서",
    jurisdiction: "KR",
    label: "의료기기 기준규격 · 공통기준규격",
    description: "전기·기계적 안전, 전자파, 생물학적 안전 등 기준규격 제·개정 고시",
    keywords: ["기준규격", "공통기준규격", "전기·기계적 안전", "전자파 안전", "생물학적 안전"],
    sources: KR_SOURCES,
  },
  {
    id: "kr-guidance",
    group: "기술 기준·안내서",
    jurisdiction: "KR",
    label: "식약처 의료기기 안내서·지침 전반",
    description: "민원인 안내서, 공무원 지침서, 가이드라인 신규 발간·개정",
    keywords: ["안내서", "가이드라인", "지침", "민원인 안내서", "의료기기"],
    sources: ["mfds_rss:data0013"],
  },

  // ───────────── 미국 (FDA) ─────────────
  {
    id: "us-510k",
    group: "시판전 인허가",
    jurisdiction: "US",
    label: "510(k) 시판전 신고 (21 CFR 807 Subpart E)",
    description: "510(k) 제출 요건, eSTAR, 실질적 동등성 가이던스",
    keywords: ["510(k)", "premarket notification", "eSTAR", "substantial equivalence", "part 807"],
    sources: US_SOURCES,
  },
  {
    id: "us-pma",
    group: "시판전 인허가",
    jurisdiction: "US",
    label: "PMA 시판전 승인 (21 CFR 814)",
    description: "Class III 기기 PMA 요건, 패널 심사, 연차보고",
    keywords: ["PMA", "premarket approval", "part 814", "class III"],
    sources: US_SOURCES,
  },
  {
    id: "us-denovo",
    group: "시판전 인허가",
    jurisdiction: "US",
    label: "De Novo 분류 요청 (21 CFR 860)",
    description: "신규 기기 분류 절차 및 특별 통제(special controls) 제정",
    keywords: ["de novo", "classification", "special controls", "part 860", "reclassification"],
    sources: US_SOURCES,
  },
  {
    id: "us-qmsr",
    group: "품질시스템",
    jurisdiction: "US",
    label: "QMSR 품질경영시스템 규정 (21 CFR 820)",
    description: "ISO 13485 통합 QMSR(2026.2 시행) 및 후속 가이던스",
    keywords: ["QMSR", "quality management system regulation", "part 820", "quality system regulation", "QSR"],
    sources: US_SOURCES,
  },
  {
    id: "us-udi",
    group: "시판후 관리",
    jurisdiction: "US",
    label: "UDI · GUDID (21 CFR 830)",
    description: "고유기기식별자 표시, GUDID 등록 요건",
    keywords: ["UDI", "unique device identification", "GUDID", "part 830"],
    sources: US_SOURCES,
  },
  {
    id: "us-mdr",
    group: "시판후 관리",
    jurisdiction: "US",
    label: "MDR 의료기기 보고 (21 CFR 803) · 리콜 (Part 806/810)",
    description: "이상사례 보고(eMDR), 시정·제거 보고, 리콜 절차",
    keywords: ["medical device reporting", "MDR", "part 803", "recall", "part 806", "corrections and removals", "eMDR"],
    sources: US_SOURCES,
  },
  {
    id: "us-cyber",
    group: "기술 가이던스",
    jurisdiction: "US",
    label: "사이버보안 (FD&C Act 524B, Cyber Devices)",
    description: "Premarket cybersecurity 가이던스, SBOM, 취약점 관리",
    keywords: ["cybersecurity", "cyber device", "524B", "SBOM", "vulnerability"],
    sources: US_SOURCES,
  },
  {
    id: "us-software-ai",
    group: "기술 가이던스",
    jurisdiction: "US",
    label: "소프트웨어 · AI/ML 기기 (SaMD, PCCP)",
    description: "Software functions, AI-enabled device, Predetermined Change Control Plan 가이던스",
    keywords: ["software as a medical device", "SaMD", "artificial intelligence", "machine learning", "AI-enabled", "PCCP", "predetermined change control", "device software functions"],
    sources: US_SOURCES,
  },
  {
    id: "us-labeling",
    group: "표시·광고",
    jurisdiction: "US",
    label: "표시기재 (21 CFR 801) · 심볼 사용",
    description: "라벨링 요건, 심볼 사용, 전자 라벨링",
    keywords: ["labeling", "part 801", "symbols", "electronic labeling"],
    sources: US_SOURCES,
  },
  {
    id: "us-ivd",
    group: "시판전 인허가",
    jurisdiction: "US",
    label: "IVD · LDT 규제 (21 CFR 809)",
    description: "체외진단 제품 및 실험실개발검사(LDT) 관련 규칙·가이던스",
    keywords: ["in vitro diagnostic", "IVD", "laboratory developed test", "LDT", "part 809"],
    sources: US_SOURCES,
  },
  {
    id: "us-recognized-standards",
    group: "기술 가이던스",
    jurisdiction: "US",
    label: "FDA 인정 합의규격 (Recognized Consensus Standards)",
    description: "FDA가 인정하는 규격 목록의 추가·철회·버전 변경 (Federal Register 고시)",
    keywords: ["recognized consensus standards", "recognition list", "consensus standards"],
    sources: [...US_SOURCES, "page_watch:fda_recognized_standards"],
  },

  // ───────────── EU ─────────────
  {
    id: "eu-mdr",
    group: "규정",
    jurisdiction: "EU",
    label: "EU MDR 2017/745",
    description: "의료기기 규정 본문 개정, 전환기간 연장, 시행규정(Implementing Regulation)",
    keywords: ["2017/745", "MDR", "medical devices regulation", "implementing regulation", "transitional"],
    sources: EU_SOURCES,
  },
  {
    id: "eu-ivdr",
    group: "규정",
    jurisdiction: "EU",
    label: "EU IVDR 2017/746",
    description: "체외진단의료기기 규정 개정 및 전환 조치",
    keywords: ["2017/746", "IVDR", "in vitro diagnostic"],
    sources: EU_SOURCES,
  },
  {
    id: "eu-mdcg",
    group: "가이던스",
    jurisdiction: "EU",
    label: "MDCG 가이던스 문서",
    description: "Medical Device Coordination Group 신규·개정 가이던스 (분류, 임상평가, PMS, UDI, 소프트웨어 등)",
    keywords: ["MDCG", "guidance", "Q&A"],
    sources: EU_SOURCES,
  },
  {
    id: "eu-harmonised",
    group: "규격",
    jurisdiction: "EU",
    label: "조화규격 (Harmonised Standards) 목록",
    description: "OJEU에 게재되는 MDR/IVDR 조화규격 시행결정(Implementing Decision) 변경",
    keywords: ["harmonised standards", "harmonized standards", "implementing decision", "OJEU", "EN ISO", "EN IEC"],
    sources: EU_SOURCES,
  },
  {
    id: "eu-eudamed",
    group: "시판후 관리",
    jurisdiction: "EU",
    label: "EUDAMED · UDI · 등록 의무",
    description: "EUDAMED 모듈 의무화 일정, UDI-DI 등록, 경제운영자 등록",
    keywords: ["EUDAMED", "UDI", "actor registration", "Basic UDI-DI"],
    sources: EU_SOURCES,
  },
  {
    id: "eu-notified-body",
    group: "인증기관",
    jurisdiction: "EU",
    label: "인증기관(Notified Body) · 적합성 평가",
    description: "NB 지정 현황, 적합성 평가 절차, 감사·인증서 관련 변경",
    keywords: ["notified body", "notified bodies", "conformity assessment", "NANDO", "certificate"],
    sources: EU_SOURCES,
  },
  {
    id: "eu-ai-act",
    group: "규정",
    jurisdiction: "EU",
    label: "EU AI Act 의료기기 적용",
    description: "고위험 AI 시스템으로서의 의료기기 요구사항 및 MDR 연계 가이던스",
    keywords: ["AI Act", "artificial intelligence act", "high-risk AI", "2024/1689"],
    sources: EU_SOURCES,
  },

  // ───────────── ISO / IEC ─────────────
  {
    id: "iso-13485",
    group: "품질경영",
    jurisdiction: "INTL",
    label: "ISO 13485 의료기기 품질경영시스템",
    description: "QMS 요구사항. 개정 검토(Systematic Review) 및 신판 발행 동향",
    keywords: ["ISO 13485", "13485"],
    sources: ISO_SOURCES,
  },
  {
    id: "iso-14971",
    group: "위험관리",
    jurisdiction: "INTL",
    label: "ISO 14971 · ISO/TR 24971 위험관리",
    description: "위험관리 프로세스 및 적용 지침",
    keywords: ["ISO 14971", "14971", "24971", "risk management"],
    sources: ISO_SOURCES,
  },
  {
    id: "iso-10993",
    group: "생물학적 안전",
    jurisdiction: "INTL",
    label: "ISO 10993 시리즈 생물학적 안전성 평가",
    description: "10993-1(평가·시험), -5(세포독성), -10(피부감작), -17(독성학적 위험평가), -18(화학적 특성) 등",
    keywords: ["ISO 10993", "10993", "biocompatibility", "biological evaluation"],
    sources: ISO_SOURCES,
  },
  {
    id: "iec-60601-1",
    group: "전기안전",
    jurisdiction: "INTL",
    label: "IEC 60601-1 의료용 전기기기 기본안전·필수성능",
    description: "일반 요구사항 및 Amendment, 4판 개정 작업 동향",
    keywords: ["IEC 60601-1", "60601-1", "basic safety", "essential performance"],
    sources: ISO_SOURCES,
  },
  {
    id: "iec-60601-1-2",
    group: "전기안전",
    jurisdiction: "INTL",
    label: "IEC 60601-1-2 전자파 장해(EMC)",
    description: "전자파 적합성 부속규격",
    keywords: ["IEC 60601-1-2", "60601-1-2", "electromagnetic", "EMC"],
    sources: ISO_SOURCES,
  },
  {
    id: "iec-60601-1-x",
    group: "전기안전",
    jurisdiction: "INTL",
    label: "IEC 60601-1-x 부속규격 · 60601-2-x 개별규격",
    description: "-1-6(사용적합성), -1-8(알람), -1-11(가정용), -1-12(응급) 및 품목별 개별규격",
    keywords: ["IEC 60601-1-6", "60601-1-8", "60601-1-11", "60601-1-12", "IEC 60601-2", "60601-2-", "IEC 80601-2"],
    sources: ISO_SOURCES,
  },
  {
    id: "iec-62304",
    group: "소프트웨어",
    jurisdiction: "INTL",
    label: "IEC 62304 의료기기 소프트웨어 수명주기",
    description: "소프트웨어 개발·유지보수 프로세스. 2판 개정 동향",
    keywords: ["IEC 62304", "62304", "software life cycle", "software lifecycle"],
    sources: ISO_SOURCES,
  },
  {
    id: "iec-62366-1",
    group: "사용적합성",
    jurisdiction: "INTL",
    label: "IEC 62366-1 사용적합성 공학",
    description: "Usability engineering 적용 및 IEC/TR 62366-2",
    keywords: ["IEC 62366", "62366", "usability engineering", "usability"],
    sources: ISO_SOURCES,
  },
  {
    id: "iec-81001-5-1",
    group: "소프트웨어",
    jurisdiction: "INTL",
    label: "IEC 81001-5-1 · AAMI TIR57 사이버보안 수명주기",
    description: "건강 소프트웨어 보안 활동 요구사항, 위협 모델링",
    keywords: ["81001-5-1", "IEC 81001", "TIR57", "TIR97", "security life cycle"],
    sources: ISO_SOURCES,
  },
  {
    id: "iso-15223-1",
    group: "표시·정보",
    jurisdiction: "INTL",
    label: "ISO 15223-1 · ISO 20417 라벨 심볼 · 제조자 제공 정보",
    description: "라벨링 심볼 및 제조자 정보 제공 요구사항",
    keywords: ["ISO 15223", "15223-1", "ISO 20417", "20417", "symbols"],
    sources: ISO_SOURCES,
  },
  {
    id: "iso-11607",
    group: "멸균·포장",
    jurisdiction: "INTL",
    label: "ISO 11607 · ISO 11135/11137/17665 멸균 및 포장",
    description: "최종 멸균 의료기기 포장, EO/방사선/습열 멸균 밸리데이션",
    keywords: ["ISO 11607", "11607", "ISO 11135", "11135", "ISO 11137", "11137", "ISO 17665", "17665", "sterilization", "sterile barrier"],
    sources: ISO_SOURCES,
  },
  {
    id: "iso-17664",
    group: "멸균·포장",
    jurisdiction: "INTL",
    label: "ISO 17664 재처리(Reprocessing) 정보",
    description: "재사용 의료기기의 세척·소독·멸균 정보 제공",
    keywords: ["ISO 17664", "17664", "reprocessing"],
    sources: ISO_SOURCES,
  },
  {
    id: "iso-14155",
    group: "임상",
    jurisdiction: "INTL",
    label: "ISO 14155 임상시험 GCP · ISO 20916 (IVD)",
    description: "의료기기 임상시험 관리기준 및 체외진단 임상성능연구",
    keywords: ["ISO 14155", "14155", "ISO 20916", "20916", "clinical investigation"],
    sources: ISO_SOURCES,
  },
  {
    id: "iso-tr-20416",
    group: "시판후 관리",
    jurisdiction: "INTL",
    label: "ISO/TR 20416 시판후 감시 · ISO 13485 연계",
    description: "PMS 프로세스 지침",
    keywords: ["20416", "post-market surveillance", "PMS"],
    sources: ISO_SOURCES,
  },
];

export const CATALOG_BY_ID: Record<string, CatalogItem> = Object.fromEntries(
  CATALOG.map((c) => [c.id, c]),
);

export function groupedCatalog() {
  const byJurisdiction: Record<Jurisdiction, Record<string, CatalogItem[]>> = {
    KR: {},
    US: {},
    EU: {},
    INTL: {},
  };
  for (const item of CATALOG) {
    (byJurisdiction[item.jurisdiction][item.group] ??= []).push(item);
  }
  return byJurisdiction;
}

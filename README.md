# MBCo. 외부 작업자 출입등록 및 안전관리

Next.js App Router · React · TypeScript · Tailwind CSS · 로컬 SQLite / 운영 Supabase PostgreSQL.
접수 완료는 출입 또는 작업허가 승인이 아닙니다.

## 바로 실행

Node.js **24 LTS**가 필요합니다. 현재 폴더에는 소스, 설치된 의존성, 로컬 개발용 .env.local이 준비되어 있습니다.

```powershell
npm run dev
```

- 방문자: http://localhost:3000
- 관리자: http://localhost:3000/admin 또는 우측 상단 관리자 버튼
- 개발 초기 비밀번호: **1111** (숫자 키패드 또는 직접 입력)
- 종료: 실행 터미널에서 Ctrl+C
- 서버가 이미 실행 중이면 주소를 그대로 열면 됩니다.
- 기본 DB에는 가상 등록자나 임의의 교육영상을 넣지 않습니다.

새 컴퓨터/새 체크아웃:

```powershell
# 사내 인증서를 사용하는 경우. 인증서 검증은 유지됩니다.
$env:NODE_USE_SYSTEM_CA = '1'
npm ci
Copy-Item .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 출력된 값을 .env.local의 DATA_ENCRYPTION_KEY에 입력
npm run dev
```

기존 .env.local이 있으면 덮어쓰지 마세요. DATA_ENCRYPTION_KEY 분실/변경 시 기존 정보를 복호화할 수 없습니다. 키는 DB와 별도의 비공개 위치에 백업하세요.
`LOCAL_SQLITE_DEV=true`인 로컬 개발에서만 SQLite 파일을 생성하거나 사용합니다. Vercel에서는 `DATABASE_URL`이 필수이며 SQLite로 자동 대체하지 않습니다.

## 구현된 기능

- 기본정보 → 안전교육/서약 → 개인정보 동의 → 전자서명 → 완료
- 날짜, 기타 사유, 교육일, 동의/서약, 서명을 서버에서 검증. 작업자 연락처는 수집하지 않음
- Canvas 직접 서명/초기화, 관리자 전용 서명 조회
- 등록된 모든 영상 페이지의 열람 기록을 확인한 후 방문자가 1시간 이수 서약에 직접 체크해야 개인정보 동의 단계로 이동. 페이지 열람·재생 종료 / 본인 이수 확인 / 관리자 근거 확인은 분리하며 자동 이수 판정 없음
- 미이수 상태를 그대로 접수하며 작업 전 교육과 담당자 확인 필요 안내
- 요청키·트랜잭션 기반 동시 중복 제출 방지, 접수번호만 공개 응답
- scrypt 비밀번호 해시, 난수 세션, HttpOnly/SameSite 쿠키, DB 기반 요청 제한
- 관리자 세션 최대 8시간, 30분 유휴 만료. 비밀번호 변경 시 전체 세션 폐기
- 운영 모드에서 초기 비밀번호 변경 전 관리자 데이터 접근 차단
- KPI, 최근 12개월 차트, 목적별 인원/비율, 등록일·업체·검색 필터, 페이지 이동
- 상세/수정/삭제, 변경 사유, 동시 수정 충돌 방지, 교육 확인, 감사로그
- 최초 기본정보·동의문·서약문·서명 원본 보존. 수정 후에도 최초 내용 조회 가능
- CSV 및 실제 XLSX 다운로드. 스프레드시트 수식 삽입 방지
- YouTube 등록/수정/비노출/소프트 삭제/순서 변경, URL 및 oEmbed 검증
- 개인정보·서명·감사로그 상세 AES-256-GCM 암호화
- 브라우저 localStorage/sessionStorage 미사용
- 보유기간 정리 스크립트, 독립 DB를 사용하는 실제 HTTP 통합 테스트

## 검증 방법

```powershell
npm run typecheck
npm run build
npm test
npm audit
```

통합 테스트는 **빌드 후** 실행합니다. 3107 포트에 독립된 운영 모드 서버를 실행하고 임시 SQLite DB를 사용합니다. 개발 DB와 비밀번호를 변경하지 않으며 테스트 서버는 종료됩니다. 임시 DB에는 가상 테스트 데이터만 저장됩니다.

자동 검증: 비인증 개인정보/내보내기 차단, Origin, 초기 비밀번호 변경 강제, 세션 폐기, 동의 거부/빈 서명, 동시 중복, 타 방문자 요청키 재사용, 암호화, 필터/CSV/XLSX, 수정 충돌, 교육확인, 영상 열람 분리, 삭제/감사로그, 로그인 제한.

수동 테스트:

1. 가상 기본정보를 입력하고 필수항목, 작업기간 역전, 기타 사유를 확인합니다.
2. 미이수 또는 실제 테스트 교육일을 선택합니다. 열람이 이수로 자동 변경되지 않아야 합니다.
3. 개인정보 동의하지 않음 선택 시 진행/제출이 제한되어야 합니다.
4. 빈 서명을 제출해 본 뒤 직접 서명하고 등록 완료 화면을 확인합니다. 접수번호는 관리자 조회에서 확인합니다.
5. 관리자 1111로 로그인하여 상세/서명/수정/삭제/감사로그/다운로드를 확인합니다.
6. 실제 공개 교육영상 URL을 추가하고 영상 페이지에서 열람합니다.
7. 관리자 비밀번호 변경과 재로그인, 이전 세션 폐기를 확인합니다.

## 환경변수

| 변수                   | 설명                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| APP_ORIGIN             | 변경 API에서 정확하게 허용할 Origin. 기본 http://localhost:3000                       |
| DATABASE_URL           | Supabase Transaction Pooler PostgreSQL URI. Vercel 서버 전용 비밀값                   |
| DATABASE_SSL_CA_BASE64 | Supabase Database Settings에서 받은 CA 인증서의 Base64. 서버의 TLS 인증서 검증에 사용 |
| DATABASE_PATH          | 로컬 개발·이전용 SQLite 파일 경로. Vercel에서 사용하지 않음                           |
| LOCAL_SQLITE_DEV       | 로컬 개발에서만 SQLite 사용을 명시적으로 허용                                         |
| DB_MIGRATION_TARGET    | 이전 대상 확인값. DATABASE_URL의 `host[:port]/database`와 일치해야 함                 |
| DATA_ENCRYPTION_KEY    | 32바이트 hex. 클라이언트 노출 금지. 누락 시 DB 기능 실패                              |
| INITIAL_ADMIN_PASSWORD | 새 DB에서만 최초 관리자 생성 시 사용. 운영은 강한 숫자 PIN 필요                       |
| COOKIE_SECURE          | HTTPS 운영은 true 필수, 로컬 HTTP는 false                                             |
| TRUST_PROXY            | 기본 false. 신뢰 프록시가 X-Forwarded-For를 덮어쓰는 경우만 true                      |

로그인은 식별키당 15분에 10회, 전체 15분에 100회 제한입니다. TRUST_PROXY=false이면 공유 제한을 사용합니다. 운영은 프록시 IP 정책과 WAF/요청 제한을 설정하세요. 비밀번호 변경은 15분에 5회 제한입니다.

## QR 및 모바일 접속

최종 서비스 URL을 QR에 넣으면 방문자가 등록 화면에 접속합니다. **localhost QR은 휴대폰에서 사용할 수 없습니다.** 같은 네트워크 테스트는 PC 사설 IP를 사용하고 APP_ORIGIN도 해당 주소(예: http://192.168.0.10:3000)로 변경한 뒤 재시작하세요. PC 역시 같은 주소로 접속해야 Origin 검사가 통과합니다. 회사 정책에 따라 방화벽 접근 허용이 필요할 수 있습니다. 정식 QR은 고정 HTTPS 도메인으로 생성하세요. QR 배포와 네트워크 개방은 자동 수행하지 않았습니다.

## DB 구조

운영 PostgreSQL 스키마: `scripts/schema.sql`. 로컬 SQLite 스키마: `lib/db.ts`.

| 테이블        | 용도                                                           |
| ------------- | -------------------------------------------------------------- |
| admins        | 비밀번호 해시, ADMIN 역할, 초기 변경 상태                      |
| sessions      | 세션 토큰 해시, 만료/유휴 시각                                 |
| visitors      | 익명 토큰 해시, 2시간 만료                                     |
| registrations | ID/접수번호/요청키/요청 HMAC/날짜/암호화된 현재 정보와 원본    |
| videos        | 제목, YouTube ID, 노출 순서/상태, 소프트 삭제                  |
| view_events   | 익명 영상 페이지 열람·재생 시작·재생 종료 시각. 이수 판정 없음 |
| rate_limits   | DB 요청 제한                                                   |
| audit         | 작업, 수행자, 대상, 시각, 암호화된 상세 사유                   |

운영은 PostgreSQL 트랜잭션과 요청키 고유 제약을 사용합니다. 작업일/집계는 한국 시간, 시각은 UTC 저장입니다. 회사명/성명 검색은 서버 메모리에서 복호화 후 필터링하므로 대규모 운영은 DB 검색 구조 확장이 필요합니다. 현재 단일 ADMIN 계정입니다. 관리자의 개인별 책임 추적은 개별 계정/SSO 확장이 필요합니다.

## Supabase 이전과 Vercel 배포

1. Supabase 프로젝트에서 PostgreSQL **Transaction Pooler** 연결 문자열을 준비합니다. 이 값은 서버의 `DATABASE_URL`에만 둡니다. 브라우저용 Supabase 키는 필요하지 않습니다.
2. 로컬 SQLite를 운영 데이터로 옮길 때는 기존 `DATA_ENCRYPTION_KEY`를 유지하고 `npm run db:backup-sqlite`와 `npm run db:migrate-sqlite`로 백업·읽기 검사를 먼저 수행합니다. 백업은 `data/backups`에 보관하며 Git에 올리지 않습니다.
3. `DB_MIGRATION_TARGET`에 연결 문자열의 정확한 `host[:port]/database`를 지정합니다. `npm run db:init -- --apply --schema-only`로 빈 앱 테이블을 생성한 다음 `npm run db:migrate-sqlite -- --apply`로 옮깁니다. 대상 테이블에 데이터가 있으면 스크립트가 중단되므로 중복 이전을 하지 않습니다. 이전 전후 테이블별 건수와 관리자 복호화 조회를 대조합니다.
4. GitHub 저장소를 Vercel의 Next.js 프로젝트에 연결합니다. Production 환경에 `DATABASE_URL`, Supabase Database Settings의 SSL 인증서를 Base64로 인코딩한 `DATABASE_SSL_CA_BASE64`, 기존 `DATA_ENCRYPTION_KEY`, `COOKIE_SECURE=true`를 서버 변수로 넣습니다. 최초 관리자 계정을 새로 만들 때만 강한 `INITIAL_ADMIN_PASSWORD`를 설정합니다. `APP_ORIGIN`은 Vercel에서 필요하지 않으며 실제 요청 도메인을 검증합니다.
5. 새 Production 배포 후 비로그인 방문자 화면과 관리자 인증, 테스트 등록·조회·수정·재로그인·재배포 후 재조회를 확인합니다. 운영 등록 전 실제 영상과 개인정보 보유정책도 확인합니다.

앱에는 파일 업로드 기능이 없으므로 Supabase Storage 버킷을 만들지 않습니다. 출입등록, 서명, 영상 기록, 관리자 설정, 세션, 초안, 감사로그는 모두 PostgreSQL 테이블에 저장합니다. 테이블은 공개 역할의 직접 접근을 철회하고 RLS를 활성화합니다. 앱의 서버 API가 관리자 인증과 권한을 검사합니다.

## 보유기간 정리

‘종료일로부터 1년’은 **운영 전 확정할 정책값**입니다. 법률 적합성 검토 완료를 의미하지 않습니다. 1년 경과 다음 날부터 삭제 대상이며, 2월 29일의 다음 해 기준일은 2월 말일입니다.

```powershell
# 삭제 없이 건수 확인
npm run data:purge
# 확정된 정책에 따라 실제 삭제
npm run data:purge -- --apply
```

실제 삭제 시 만료 세션/요청제한, 1일 지난 원시 영상열람 이벤트, 366일 지난 감사로그도 정리합니다. 등록에 포함된 열람 스냅샷은 등록정보 보유기간을 따릅니다. 감사 사유에 개인정보를 불필요하게 입력하지 마세요. 작업 스케줄러/cron은 운영자가 설정해야 하며 자동 등록하지 않았습니다. 백업도 같은 정책에 따라 별도로 정리해야 합니다.

## 운영 전 설정 및 범위

1. 담당자가 실제 교육영상, 개인정보 목적/항목/보유기간, 안전서약문을 확정합니다.
2. 고정 HTTPS 도메인, COOKIE_SECURE=true 및 신뢰 프록시를 설정합니다.
3. Supabase DB/암호키, 접근권한, 백업·복구를 준비합니다.
4. 초기 비밀번호를 변경합니다. 운영 모드에서는 변경 전 관리 기능이 차단됩니다.
5. 자동 보유기간 정리, 백업 삭제, 장애 모니터링을 설정합니다.
6. 영상 공개·임베드 가능 여부와 교육 적합성을 확인합니다. oEmbed 확인은 내용 적합성과 실제 시청 완료를 보증하지 않습니다.
7. 실제 휴대폰에서 날짜 선택, 터치 서명, 영상 재생, 현장 네트워크를 확인합니다.

```powershell
npm ci
npm run build
npm start
```

Vercel Node.js 서버리스에서는 PostgreSQL을 사용합니다. Edge 런타임과 정적 내보내기는 지원하지 않습니다.

직접 서명은 동의문/시각/최초 정보와 함께 보존하며, 공인 전자서명 인증 서비스 연동은 포함하지 않습니다. 실제 교육 확인은 교육대장 등 근거를 확인해 관리자가 기록합니다.

## 참고

- [Next.js 공식 설치 안내](https://nextjs.org/docs/app/getting-started/installation)
- [Node.js SQLite 공식 문서](https://nodejs.org/api/sqlite.html)
- 기능 기준: PRD.md / 개발 지침: AGENTS.md

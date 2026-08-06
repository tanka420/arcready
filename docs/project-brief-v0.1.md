# ArcReady Project Brief v0.1

**Trạng thái:** Bản định hướng trước audit
**Repository:** https://github.com/tanka420/arcready
**Phiên bản hiện tại:** v0.3.0
**Ngày lập:** 20/07/2026
**Chủ sở hữu dự án:** tanka420
**Mục đích tài liệu:** Cung cấp nguồn sự thật chung cho quá trình đánh giá và chuyển đổi ArcReady thành một Arc Porting & Compatibility Linter.

---

## 1. Tóm tắt quyết định

ArcReady hiện là một static CI quality gate dành cho các integration liên quan đến Arc wallet, bridge và App Kit. Sản phẩm đã có CLI, npm package, GitHub Action, rule registry, config, reporter, tests và fixtures.

Định hướng mới là chuyển ArcReady thành:

> **Công cụ phân tích repository giúp developer phát hiện, hiểu và sửa các giả định không tương thích khi chuyển smart contract, dApp, wallet, bridge hoặc infrastructure từ Ethereum/EVM sang Arc.**

ArcReady sẽ không chỉ tìm các chuỗi đáng ngờ trong source code. Sản phẩm cần tiến tới phân tích có cấu trúc và có ngữ nghĩa, cung cấp finding chính xác tại file và dòng code, giải thích tác động, đưa ra hướng sửa và dẫn tới tài liệu Arc chính thức.

Quyết định hiện tại:

- Giữ repository và tên ArcReady.
- Tận dụng hạ tầng CLI, npm, GitHub Action, testing và reporting hiện có khi còn phù hợp.
- Cho phép breaking changes vì sản phẩm chưa đạt phiên bản 1.0.
- Được phép thay đổi toàn bộ rule, schema, README, scoring, config, CLI và cấu trúc nội bộ.
- Không viết lại toàn bộ repository trong một lần.
- Không triển khai runtime verification trong các milestone đầu.
- Bước đầu tiên là audit-only để kiểm tra các giả định của tài liệu này với code thực tế.

---

## 2. Bối cảnh

Arc là một EVM-compatible blockchain nhưng có các đặc điểm riêng có thể khiến ứng dụng hoặc smart contract được chuyển từ Ethereum và các EVM chain khác hoạt động sai, gây hiểu nhầm hoặc duy trì những logic không cần thiết.

Các nhóm khác biệt có khả năng ảnh hưởng đến quá trình porting gồm:

- USDC là native gas token.
- Native USDC và ERC-20 USDC có cách biểu diễn decimal khác nhau.
- Ứng dụng có thể đưa ra giả định sai về `msg.value`, native balances và ERC-20 amounts.
- Arc có deterministic finality và không cần nhiều confirmation.
- Một số logic reorg handling của Ethereum không còn cần thiết.
- `PREVRANDAO` không nên được dùng theo giả định Ethereum thông thường.
- Blob transaction assumptions có thể không phù hợp.
- Block có tốc độ cao, nên timestamp không phải lúc nào cũng phù hợp làm khóa sắp xếp duy nhất.
- Wallet và indexer phải xử lý đúng mô hình native USDC và các transfer events.
- Bridge và CCTP có các chain/domain/configuration riêng.
- App Kit và các dịch vụ Circle có identifier, capability và integration requirements riêng.

ArcReady có cơ hội trở thành một developer tool tập trung vào các khác biệt này.

---

## 3. Trạng thái sản phẩm hiện tại

Các thông tin dưới đây là giả định đã được kiểm tra sơ bộ và phải được Codex xác minh lại trong Milestone 0.

### 3.1 Công nghệ và phân phối

ArcReady hiện được xây dựng bằng:

- TypeScript.
- Node.js 22 trở lên.
- pnpm workspace/monorepo.
- npm package `arcready`.
- GitHub composite Action.
- Vitest.
- ESLint.
- tsup.

### 3.2 Giao diện hiện tại

CLI hiện có các command chính:

```bash
arcready init
arcready scan
arcready help
```

Các định dạng report hiện có:

- Terminal.
- JSON.
- Markdown.
- HTML.

GitHub Action có thể:

- Chạy ArcReady scan.
- Ghi Markdown vào GitHub Step Summary.
- Upload report artifacts.
- Fail workflow theo mức severity.

### 3.3 Phạm vi rule hiện tại

Ba preset hiện tại:

- `wallet`
- `bridge`
- `app-kit`

Rule hiện tập trung vào:

- Arc chain metadata.
- Native USDC display.
- ETH/gwei gas labels.
- Confirmation count.
- PREVRANDAO assumptions.
- Blob transaction assumptions.
- CCTP domain.
- Wrapped USDC assumptions.
- Relayer gas token.
- Attestation 404 handling.
- App Kit identifiers và một số guardrail/UX recommendation.

### 3.4 Cách phân tích hiện tại

Phần lớn rule hiện dùng:

- Regex.
- Line-level text matching.
- Keyword presence hoặc absence.
- Ghép nội dung nhiều file để phát hiện project type.
- Heuristic dựa trên package dependencies và source text.

### 3.5 Hạn chế đã biết

- Chưa có TypeScript AST analysis.
- Chưa có Solidity AST analysis.
- Chưa có import/symbol resolution.
- Chưa có source location chính xác cho finding.
- Chưa có line, column và code snippet.
- Chưa có confidence level.
- Chưa có finding fingerprint.
- Chưa có SARIF.
- Chưa có baseline/suppression workflow.
- Chưa phân biệt rõ compatibility errors và product/UX advice.
- Project detection còn phụ thuộc nhiều vào keyword.
- Scoring 0–100 hiện mang tính đơn giản và có thể gây hiểu nhầm.
- Chưa hỗ trợ tốt Foundry, Hardhat và Solidity repositories.
- Chưa có runtime RPC, deployment hoặc onchain verification.
- Config có thể chứa các trường chưa được pipeline sử dụng.

---

## 4. Vấn đề cần giải quyết

Developer port một project EVM sang Arc hiện có thể gặp ba nhóm vấn đề.

### 4.1 Lỗi tương thích trực tiếp

Ví dụ:

- Dùng ETH làm native currency trong Arc chain metadata.
- Sử dụng decimal không đúng giữa native USDC và ERC-20 USDC.
- Truyền amount sai đơn vị vào `msg.value`.
- Chờ nhiều confirmation không cần thiết.
- Dùng CCTP domain không đúng.
- Sử dụng wrapped USDC ở phía Arc.
- Dùng transaction type hoặc opcode assumption không phù hợp.

### 4.2 Logic hoạt động nhưng không phù hợp với Arc

Ví dụ:

- Giữ reorg-handling pipeline phức tạp.
- Dùng block timestamp làm cursor duy nhất.
- Hiển thị native USDC và ERC-20 USDC như hai tài sản độc lập.
- Dùng Ethereum gas terminology trong UI, variables hoặc operational runbook.
- Thiết kế indexer theo mô hình Ethereum mặc dù Arc có finality và event behavior khác.

### 4.3 Recommendation không phải lỗi tương thích

Ví dụ:

- App Kit capability guard.
- RPC recommendation.
- UX giải thích fee.
- Bridge minimum amount copy.
- Delegate handling recommendation.

ArcReady phải phân biệt rõ ba nhóm này, thay vì đưa tất cả vào cùng một hệ severity và scoring.

---

## 5. Product vision

### 5.1 Tuyên bố sản phẩm

> **ArcReady is an Arc porting and compatibility linter that identifies known Arc-specific migration risks across smart contracts, application code, wallet integrations, bridge flows, configuration, and infrastructure.**

### 5.2 Giá trị chính

ArcReady cần giúp developer trả lời:

1. Repository này có những phần nào liên quan đến Arc?
2. Code hoặc configuration nào vẫn đang mang giả định của Ethereum hoặc EVM chain khác?
3. Giả định đó có thể gây ra lỗi gì trên Arc?
4. File và dòng nào cần được thay đổi?
5. Cách sửa an toàn là gì?
6. Nhận định này dựa trên tài liệu Arc nào?
7. Finding là lỗi chắc chắn, khả năng cao hay chỉ là recommendation?

### 5.3 Định vị

ArcReady không phải:

- Generic Web3 linter.
- Solidity security auditor.
- Smart-contract formal verifier.
- Circle SDK validator chính thức.
- Runtime test framework.
- Monitoring platform.
- Compliance product.
- SaaS dashboard.

ArcReady là:

> Repository-level static compatibility analyzer dành riêng cho quá trình chuyển EVM project sang Arc.

---

## 6. Người dùng mục tiêu

### 6.1 Solidity developer

Nhu cầu:

- Chuyển contract Ethereum sang Arc.
- Phát hiện opcode, native token hoặc decimal assumptions.
- Xác định phần test cần chạy lại.
- Nhận hướng dẫn có nguồn chính thức.

### 6.2 dApp developer

Nhu cầu:

- Chuyển frontend/backend sang Arc.
- Cấu hình đúng chain ID, RPC, explorer và native currency.
- Không dùng ETH gas assumptions.
- Xử lý đúng transaction finality và balances.

### 6.3 Wallet developer

Nhu cầu:

- Hiển thị native USDC đúng.
- Không hiển thị hai balance trùng nhau.
- Xử lý fee và finality đúng.
- Theo dõi event phù hợp.

### 6.4 Bridge/CCTP developer

Nhu cầu:

- Dùng đúng Arc CCTP domain.
- Dùng canonical USDC.
- Xử lý attestation polling đúng.
- Cấu hình relayer và confirmation đúng.

### 6.5 Infrastructure/indexer developer

Nhu cầu:

- Không giả định reorg.
- Dùng block number thay vì timestamp làm ordering key chính.
- Index đúng native value transfer và USDC events.
- Loại bỏ logic Ethereum không cần thiết.

### 6.6 Hackathon và community builder

Nhu cầu:

- Kiểm tra nhanh project trước khi demo.
- Có CI report rõ ràng.
- Nhận hướng dẫn sửa có thể thực hiện ngay.
- Tránh lỗi cấu hình Arc phổ biến.

---

## 7. Phạm vi sản phẩm mục tiêu

### 7.1 Các loại file cần hỗ trợ

Theo từng giai đoạn:

- TypeScript.
- JavaScript.
- Solidity.
- JSON.
- JSONC.
- YAML.
- Foundry configuration.
- Hardhat configuration.
- Package manifests.
- Chain metadata.
- Indexer configuration.
- GitHub Actions và deployment configuration khi có liên quan trực tiếp.

### 7.2 Các nhóm phân tích

- Repository inventory.
- Framework detection.
- Arc applicability detection.
- Dependency detection.
- Structured configuration analysis.
- TypeScript/JavaScript semantic analysis.
- Solidity compatibility analysis.
- Wallet integration analysis.
- CCTP/bridge analysis.
- Indexer/infrastructure analysis.
- App Kit advice dưới dạng optional pack.

### 7.3 Finding mục tiêu

Mỗi finding cần có tối thiểu:

- Rule ID.
- Tiêu đề.
- Category.
- Severity.
- Confidence.
- Rule maturity.
- File.
- Dòng và cột.
- Evidence snippet.
- Giải thích vấn đề.
- Tác động tiềm năng.
- Suggested fix.
- Tài liệu chính thức.
- Documentation version hoặc thời điểm xác minh.
- Fingerprint ổn định.
- Autofix metadata nếu có.

Ví dụ:

```text
ARC-NATIVE-001 — Incorrect native currency metadata

src/chains/arc.ts:18:22

Arc is configured with ETH as its native currency.
Arc uses USDC as its native gas token.

Detected:
nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }

Suggested change:
Use Arc-compatible USDC metadata and verify that wallet display
logic does not confuse native 18-decimal values with the 6-decimal
ERC-20 interface.

Confidence: High
Severity: Blocker
Rule maturity: Stable
```

---

## 8. Rule philosophy

### 8.1 Arc-specific only

Mỗi rule mặc định phải phát hiện vấn đề đặc thù của Arc hoặc quá trình porting sang Arc.

Không thêm generic rules như:

- Reentrancy.
- Missing access control.
- Generic Solidity style.
- Generic TypeScript best practices.
- Generic React performance.

Các vấn đề đó thuộc công cụ khác.

### 8.2 Evidence-based

Mỗi stable rule phải có:

- Tài liệu Arc/Circle chính thức.
- Mô tả chính xác điều kiện áp dụng.
- Positive fixture.
- Negative fixture.
- Ít nhất một realistic fixture.
- Test chống false positive.
- Rule owner hoặc provenance metadata.
- Ngày gần nhất kiểm tra tài liệu.

### 8.3 Precision over breadth

Ưu tiên:

> 10 rule có độ chính xác cao hơn 50 rule dựa trên keyword mơ hồ.

Không thêm rule chỉ để tăng số lượng.

### 8.4 Phân loại rule

Đề xuất ba mức:

#### Stable compatibility

- Có bằng chứng rõ.
- Confidence cao.
- Có thể fail CI.
- Được kiểm thử trên corpus thực tế.

#### Experimental compatibility

- Có cơ sở nhưng cần thêm dữ liệu.
- Không fail CI mặc định.
- Phải gắn nhãn experimental.

#### Advice

- Recommendation hoặc UX guidance.
- Không được mô tả như lỗi tương thích.
- Opt-in hoặc warning-only.

### 8.5 Không compatibility guarantee

ArcReady phải ghi rõ:

> ArcReady identifies known Arc porting risks based on documented Arc behavior. It does not guarantee compatibility and does not replace testing, security review, or deployment validation.

---

## 9. Phần được ưu tiên giữ lại

Giữ nếu audit không phát hiện lý do kỹ thuật mạnh để thay:

- Tên ArcReady.
- Repository hiện tại.
- npm package.
- GitHub Action.
- MIT license.
- pnpm workspace.
- Build/test/lint infrastructure.
- CLI distribution.
- Reporter abstraction.
- Rule registry concept.
- Config validation concept.
- Fixture testing concept.
- Release history.

Không bắt buộc giữ nguyên implementation.

---

## 10. Phần được phép thay đổi hoặc loại bỏ

Được phép thay toàn bộ:

- README.
- Product description.
- Rule IDs.
- Rule implementations.
- Rule metadata.
- Presets.
- Config schema.
- Finding schema.
- Scoring.
- Project detection.
- CLI commands.
- Public package API.
- Reporter format.
- Directory structure.
- Test fixtures.
- GitHub Action inputs.
- Package boundaries.
- Versioning strategy.

Breaking changes phải:

- Có lý do.
- Có migration note.
- Được thực hiện theo milestone.
- Không trộn với các thay đổi không liên quan.
- Có regression test.

---

## 11. Non-goals trước phiên bản 1.0

Chưa triển khai:

- SaaS.
- Hosted dashboard.
- Database service.
- User authentication.
- Telemetry bắt buộc.
- AI-generated fixes.
- Smart contract riêng.
- Token.
- Runtime RPC checks trong default scan.
- Contract deployment validation.
- Bridge runtime simulation.
- CCTP transaction execution.
- Wallet secret handling.
- Testnet faucet automation.
- Security audit replacement.
- Compliance guarantee.
- Mainnet monitoring.

Runtime verification chỉ được xem xét sau khi static linter được xác thực.

---

## 12. Nguyên tắc kiến trúc

### 12.1 Không big-bang rewrite

Không thay config, CLI, rule engine, parser, reporters và toàn bộ rules trong cùng một PR.

### 12.2 Hybrid analysis

Không bắt buộc mọi rule đều dùng AST.

Sử dụng:

- TypeScript AST cho code semantics.
- Solidity AST hoặc Slither integration cho Solidity.
- JSON/JSONC parser cho structured config.
- YAML parser khi cần.
- Regex cho user-facing copy hoặc fallback có kiểm soát.

### 12.3 Parse once

Mỗi file nên được đọc và parse một lần trong một scan, sau đó chia sẻ qua analysis context.

### 12.4 Arc applicability

Không áp dụng Arc rule cho generic code nếu chưa có bằng chứng code đó được dùng với Arc.

Các tín hiệu applicability có thể gồm:

- Arc chain ID.
- `Arc_Testnet`.
- Arc RPC.
- Arc explorer.
- Arc-specific contract addresses.
- Arc route configuration.
- Arc-named module.
- Arc environment configuration.
- Call graph hoặc imported config liên kết tới Arc.

### 12.5 Deterministic default scan

Default static scan phải:

- Không cần internet.
- Không cần RPC.
- Không cần private key.
- Không gửi telemetry.
- Cho kết quả có thể lặp lại.
- Phù hợp CI.

---

## 13. Kiến trúc mục tiêu sơ bộ

```text
Repository Scanner
├── File inventory
├── Workspace/package detection
├── Framework detection
├── Arc applicability map
├── Parser registry
│   ├── TypeScript/JavaScript
│   ├── Solidity
│   ├── JSON/JSONC
│   └── YAML/config
├── Shared analysis context
├── Rule packs
│   ├── core-compatibility
│   ├── wallet
│   ├── bridge-cctp
│   ├── solidity
│   ├── indexer-infrastructure
│   └── app-kit-advice
├── Finding normalization
├── Baseline/suppression
└── Reporters
    ├── terminal
    ├── JSON
    ├── Markdown
    ├── HTML
    └── SARIF
```

Đây là kiến trúc định hướng, không phải quyết định implementation cuối cùng. Codex phải đánh giá tính phù hợp với code hiện tại.

---

## 14. Nhóm rule ưu tiên

Danh sách dưới đây là backlog định hướng, không phải yêu cầu triển khai ngay.

### Nhóm A — Chain và native currency

- Arc chain ID.
- RPC/explorer metadata.
- Native currency là USDC.
- ETH/gwei gas labels.
- Relayer funding bằng ETH.
- Hardcoded ETH gas variables hoặc operational assumptions.

### Nhóm B — Native/ERC-20 dual-decimal

- Native balance được format bằng 6 decimals.
- ERC-20 balance được format bằng 18 decimals.
- So sánh native và ERC-20 amount không normalize.
- `msg.value` nhận amount đã parse theo 6 decimals.
- Native transfer dùng `parseUnits(..., 6)`.
- Wallet hiển thị duplicate balances.
- Backend accounting trộn hai representation.

### Nhóm C — Finality và block behavior

- Confirmation count lớn hơn 1.
- Logic chờ N block.
- UI hiển thị multi-confirmation.
- Reorg rollback handling được bật cho Arc.
- Timestamp được dùng làm unique cursor.
- Uncle/reorg assumptions không cần thiết.
- Finality logic được sao chép trực tiếp từ Ethereum.

### Nhóm D — Unsupported assumptions

- `block.prevrandao`.
- `mixHash`.
- EIP-4844/blob transaction fields.
- Transaction type 3.
- Unsupported RPC hoặc execution assumption đã được Arc docs xác nhận.

### Nhóm E — Wallet/indexer events

- Duplicate native/ERC-20 balance display.
- Bỏ sót unified transfer behavior.
- Index sai event.
- Không xử lý native value movement theo Arc guidance.
- Dùng Ethereum-only indexing assumptions.

### Nhóm F — Bridge/CCTP

- CCTP domain sai.
- Wrapped USDC ở phía Arc.
- Attestation 404 bị xem là fatal.
- Relayer dùng sai gas token.
- Confirmation quá nhiều.
- Sai chain identifier hoặc route config.

### Nhóm G — App Kit advice

- Capability guard.
- Explicit RPC recommendation.
- Delegate handling.
- Fee explanation.
- Minimum amount handling.

Nhóm G không được mặc định coi là blocker.

---

## 15. Scoring và trạng thái

Scoring 0–100 hiện tại phải được đánh giá lại.

Định hướng ưu tiên là bỏ readiness score đơn giản và thay bằng:

```text
Compatibility status: FAIL

Blockers: 2
Required changes: 3
Recommendations: 4

Rule coverage:
- Wallet: scanned
- Bridge: scanned
- Solidity: not scanned
- Indexer: not detected

Confidence:
- High: 4
- Medium: 1
- Low: 0
```

Có thể giữ score nếu audit chứng minh có giá trị, nhưng score phải xét đến:

- Severity.
- Confidence.
- Applicability.
- Rule maturity.
- Coverage.
- Duplicate grouping.
- Suppression.
- Unsupported file types.

Không được tạo cảm giác chứng nhận compatibility.

---

## 16. CLI mục tiêu

Các command định hướng:

```bash
arcready init
arcready scan
arcready rules
arcready explain <rule-id>
arcready baseline
arcready help
```

Các option mục tiêu:

```bash
arcready scan --profile contract
arcready scan --profile wallet
arcready scan --profile bridge
arcready scan --format sarif
arcready scan --config arcready.config.json
arcready scan --fail-on blocker
```

Các command chưa ưu tiên:

```bash
arcready fix
arcready verify
```

---

## 17. Success criteria

Trước khi xem ArcReady là Arc Porting Linter ổn định:

### Chất lượng rule

- Mỗi stable rule có official documentation reference.
- Có positive, negative và realistic fixtures.
- Có false-positive regression tests.
- Có source location chính xác.
- Có confidence và maturity.
- Không dựa hoàn toàn vào absence-of-keyword khi được đánh dấu stable.

### Chất lượng sản phẩm

- Default scan không cần network hoặc secrets.
- GitHub Action hoạt động trên repository bên ngoài.
- SARIF hợp lệ và hiển thị đúng location.
- Report phân biệt blocker, required change và advice.
- CLI có exit behavior ổn định.
- Có migration guide từ pre-porting-linter versions.
- README không mô tả chức năng chưa tồn tại.

### Chất lượng thực tế

- Chạy trên official Arc sample repositories.
- Chạy trên một corpus community repositories.
- Có intentionally broken fixtures.
- False positives được đo và ghi nhận.
- Các limitation được công khai.
- Scan time phù hợp với CI trên repository quy mô vừa.

---

## 18. Roadmap định hướng

### Milestone 0 — Audit-only

Mục tiêu:

- Xác minh trạng thái thực tế.
- Chạy toàn bộ build/test/lint/fixtures.
- Lập architecture map.
- Đánh giá mức tái sử dụng.
- Xác định migration risks.
- Chưa sửa code.

### Milestone 1 — Product and schema reset

Mục tiêu:

- Khóa Product Spec v1.
- Phân loại lại rules.
- Thiết kế Finding v2.
- Thiết kế Rule metadata v2.
- Thiết kế Config v2.
- Quyết định scoring.
- Viết migration plan.

### Milestone 2 — Finding foundation and SARIF

Mục tiêu:

- File, line, column.
- Evidence snippet.
- Confidence.
- Maturity.
- Fingerprint.
- SARIF.
- Baseline/suppression cơ bản.

### Milestone 3 — Structured configuration analysis

Mục tiêu:

- JSON/JSONC.
- Chain metadata.
- Hardhat configuration.
- Viem/Wagmi chain definitions.
- Arc chain ID.
- Native USDC metadata.
- CCTP domain.
- RPC và explorer config.

### Milestone 4 — TypeScript/JavaScript semantic analysis

Mục tiêu:

- TypeScript AST.
- Import resolution cơ bản.
- Transaction object analysis.
- Confirmation logic.
- Native gas assumptions.
- App Kit identifier.
- CCTP handling.

### Milestone 5 — Solidity compatibility pack

Mục tiêu:

- Solidity parser.
- `PREVRANDAO`.
- `msg.value`.
- Dual-decimal assumptions.
- Native token assumptions.
- Foundry/Hardhat fixtures.

### Milestone 6 — Indexer and infrastructure pack

Mục tiêu:

- Reorg handling.
- Confirmation assumptions.
- Timestamp ordering.
- Transfer event indexing.
- Block-number ordering.

### Milestone 7 — Real-project corpus

Mục tiêu:

- Official samples.
- Community repositories.
- Broken forks.
- False-positive measurement.
- Stable/experimental classification.

### Milestone 8 — Developer experience

Mục tiêu:

- `rules`.
- `explain`.
- Baseline.
- Safe autofix.
- Documentation.
- Có thể cân nhắc editor integration.

### Milestone 9 — Runtime validation decision

Chỉ thực hiện nếu được xác thực là cần thiết.

Có thể triển khai thành:

- `arcready verify`
- hoặc package riêng `@arcready/runtime`

---

## 19. Quy tắc triển khai

- Một milestone không đồng nghĩa một PR.
- PR phải nhỏ và có mục tiêu rõ.
- Không xóa implementation cũ trước khi có replacement hoặc migration.
- Không làm nhiều breaking changes không liên quan trong cùng PR.
- Mọi thay đổi public API phải có test.
- Mọi stable rule phải có documentation provenance.
- Không thêm runtime dependency vào default static scan.
- Không thêm SaaS hoặc hosted infrastructure.
- Không đổi package name khi chưa có quyết định riêng.
- Không quảng bá compatibility guarantee.
- Không tự động áp dụng autofix có khả năng thay đổi behavior.

---

## 20. Quyền quyết định

### Chủ dự án quyết định

- Product positioning.
- Scope.
- Roadmap.
- Breaking changes lớn.
- Package naming.
- Runtime direction.
- Release.
- Merge.

### Codex có quyền

- Phản biện Project Brief bằng bằng chứng kỹ thuật.
- Đề xuất kiến trúc khác.
- Đề xuất thay hoặc bỏ thành phần.
- Xác định technical debt.
- Đề xuất migration order.
- Thực hiện thay đổi sau khi được duyệt.

### Codex không được tự quyết định

- Chuyển ArcReady thành SaaS.
- Thêm telemetry.
- Thêm dashboard.
- Thêm token hoặc smart contract.
- Thêm runtime vào default scan.
- Thay toàn bộ repository trong một PR.
- Viết lại product scope không có sự đồng ý của chủ dự án.

---

## 21. Các câu hỏi phải giải quyết sau audit

1. Rule engine hiện tại có đủ khả năng mở rộng thành Analysis Engine v2 không?
2. Nên tiến hóa package hiện tại hay tạo package core mới trong monorepo?
3. Finding v2 có thể thêm theo backward-compatible path không?
4. Config v2 cần migration hay nên tạo schema hoàn toàn mới?
5. Scoring hiện tại nên bỏ, deprecate hay thay?
6. Reporter abstraction hiện tại có phù hợp SARIF không?
7. Project detection nên thay hoàn toàn hay mở rộng?
8. Có bao nhiêu rule hiện tại nên giữ về mặt khái niệm?
9. Rule nào hiện có nguy cơ cung cấp guidance sai hoặc đã lỗi thời?
10. AST/parser dependencies nào phù hợp nhất với phạm vi solo developer?
11. Public API hiện tại có đáng duy trì không?
12. Runtime config hiện có nên xóa, deprecate hay giữ cho tương lai?
13. Milestone nào cần thay đổi sau khi xem code thực tế?
14. Slice implementation đầu tiên sau audit nên là gì?

---

## 22. Trạng thái của tài liệu

Đây là **Project Brief v0.1**, không phải specification cuối cùng.

Sau Milestone 0:

- Các giả định sai phải được sửa.
- Các quyết định chưa đủ bằng chứng phải được đánh dấu.
- Roadmap phải được điều chỉnh.
- Product Brief sẽ được nâng thành Product Spec hoặc Project Brief v0.2.
- Chỉ sau đó mới bắt đầu thay đổi code.

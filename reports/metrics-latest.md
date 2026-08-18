# PM Agent metrics

时间范围：2026-08-01T00:00:00.000Z 至 2026-08-18T12:20:54.240Z
指标定义版本：goal-standard-1.2
评测数据版本：golden-1.0

| 指标 | 值 | 样本 | 目标 | 状态 |
| --- | ---: | ---: | ---: | --- |
| taskSuccessRate | 0.3333333333333333 | 3 | >= 0.8 | fail |
| sourceIngestCompleteness | - | 0 | >= 0.99 | insufficient_data |
| factCitationCoverage | 0 | 1 | >= 0.9 | fail |
| unsupportedClaimRate | - | 0 | <= 0.05 | insufficient_data |
| attachmentParseSuccess | - | 0 | >= 0.99 | insufficient_data |
| artifactGenerationSuccess | 1 | 1 | >= 0.98 | pass |
| standardTaskP50Latency | 96.71 | 1 | <= 180 | pass |
| budgetCompliance | - | 0 | >= 1 | insufficient_data |
| approvalLeakRate | - | 0 | <= 0 | insufficient_data |
| progressFreshness | - | 0 | <= 2 | insufficient_data |
| evaluationPassRate | 1 | 22 | >= 0.9 | pass |

## 数据完整性告警

- 存在缺少输入快照哈希的历史运行。

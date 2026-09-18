# 文档索引

[English](README.md) | [中文文档](README.zh-CN.md)

三份正文。根目录 [README](../README.zh-CN.md) 是宿主落地页：使用场景（安装、初始化、短篇/长篇、中途改元信息、章节、导出）加上完整 Kit API 目录。可跑通示意仍在 [`examples/`](../examples/)。

| 文档 | 用途 |
| --- | --- |
| [指南](guide.zh-CN.md) | **怎么用。** Kit 优先（推荐）。安装 / 拷进仓库。LLM 适配器。可复制的 Engine / Session 流程。 |
| [API](api.zh-CN.md) | **契约。** `.` / `./worker` / `./llm` / `./session` / `./kit` 的稳定导出与类型。Session 方法契约、错误、S0–S6、协议。 |
| [架构](architecture.zh-CN.md) | **实现。** Ports、`route`、store 布局、Worker / Session / Kit 协议、busy 生命周期、打包。 |
| [冒烟 vs 宿主 E2E](smoke.zh-CN.md) | **本仓库测什么**（README 场景冒烟 + Playwright worker）以及《写作工作台》仍要自己做的 **宿主 E2E**。 |

阅读路径：根 README（使用场景 + Kit API 目录）→ 指南（怎么用）→ API（契约）→ 架构（实现）。冒烟覆盖 vs 宿主 E2E：[冒烟](smoke.zh-CN.md)。

每页都有英文对应文件（无 `.zh-CN` 后缀）。

# 文档索引

[English](README.md) | [中文文档](README.zh-CN.md)

宿主「怎么用」在 **指南**。契约在 **API** / **Session**。实现细节在 **架构**。可跑通的示意仍在 [`examples/`](../examples/)。

## 用法

| 文档 | 用途 |
| --- | --- |
| [宿主指南](guide.zh-CN.md) | 安装（拷进仓库 + 相对路径导入 `dist/`，或 registry）以及可复制的宿主流程 |
| [LLM 适配器](llm-adapters.zh-CN.md) | 可选 `novel-engine/llm` 工厂、映射、BFF 安全 |

根目录 [README](../README.zh-CN.md) 是产品入口与场景枢纽，不再重复实现细节。

## 参考

| 文档 | 用途 |
| --- | --- |
| [公开 API](api.zh-CN.md) | 稳定导出、类型、常量（`.` / `./worker` / `./llm` / `./session`） |
| [Session API](session.zh-CN.md) | `novel-engine/session` 方法契约、错误、S0–S6、协议 |

## 实现

| 文档 | 用途 |
| --- | --- |
| [架构](architecture.zh-CN.md) | Ports & Adapters、`route`、store 布局、指纹/审查、Worker 协议、busy 生命周期、打包/`exports` |

## 语言

每页都有英文对应文件（无 `.zh-CN` 后缀）。

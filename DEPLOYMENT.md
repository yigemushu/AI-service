# 线上部署准备清单

## 必填环境变量

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-mini
OPENAI_FAST_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=18000
OPENAI_MAX_OUTPUT_TOKENS=800
```

不要把真实 Key 写入代码、README、截图或聊天记录。生产环境请在部署平台的 Environment Variables 中配置。

## 发布前检查

```powershell
npm run lint
npm run build
```

检查内容：

- `.env.local` 没有被 Git 跟踪。
- 前端代码没有硬编码 API Key。
- `/api/analyze` 仍由后端读取 `OPENAI_API_KEY`。
- 外测时明确说明：当前版本只生成回复草稿，不会自动发送消息。

## 外测数据说明

当前数据保存在浏览器 `localStorage`，适合 MVP 外测和演示。清浏览器缓存会丢失本地订单、知识库、评分和反馈记录。正式商用前建议接数据库和用户账号。

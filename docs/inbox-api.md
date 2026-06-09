# 统一消息入口 /api/inbox

这个接口用于把外部平台消息送进 AI 客服接单工作台。后续浏览器插件、安卓助手、iPhone 快捷入口、官方平台接口都可以接同一个入口。

## 接收消息

请求：

```http
POST /api/inbox
Content-Type: application/json
```

请求体：

```json
{
  "customerName": "闲鱼买家A",
  "platform": "闲鱼",
  "sourceChannel": "浏览器插件",
  "businessType": "xianyu",
  "rawMessage": "最低多少？今天能发吗？",
  "sourceUrl": "https://www.goofish.com/"
}
```

字段说明：

- `rawMessage`：必填，客户原始消息。
- `businessType`：可选，`sam`、`xianyu`、`local`、`trade`，不填默认 `xianyu`。
- `platform`：可选，例如 `闲鱼`、`微信`、`Facebook`。
- `sourceChannel`：可选，例如 `浏览器插件`、`安卓助手`、`iPhone快捷入口`、`官方接口`、`Webhook`。
- `sourceUrl`：可选，原平台聊天链接。

返回：

```json
{
  "ok": true,
  "message": {
    "id": "msg_...",
    "status": "未处理"
  }
}
```

## 获取外部消息

请求：

```http
GET /api/inbox
```

网站消息中心点击“同步外部消息”时，会读取这个接口并合并到本地待处理列表。

## Webhook Token

可以在服务器环境变量里设置：

```env
INBOX_WEBHOOK_TOKEN=
```

如果设置了这个值，外部工具提交消息时需要带上：

```http
Authorization: Bearer your_token_here
```

或：

```http
x-inbox-token: your_token_here
```

不要把真实 token 写进 GitHub，也不要发到聊天里。

## 当前限制

当前版本先使用服务器本地 `data/inbox-messages.json` 保存外部消息，适合内测和单服务器部署。后续如果要多人、多设备、正式商用，建议换成数据库。

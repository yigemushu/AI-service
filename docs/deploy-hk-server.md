# 香港轻量服务器部署指南

本文档用于把 AI 客服订单助手部署到香港轻量服务器，并通过 PM2 + Nginx 对外提供 HTTPS 服务。

## 1. 服务器准备

推荐配置：

- 地域：香港
- 系统：Ubuntu 22.04 LTS 或 Ubuntu 24.04 LTS
- Node.js：20 LTS 或 22 LTS，必须满足 Next.js 当前要求 `>=20.9.0`
- 内存：外测阶段 1C2G 起步，正式使用建议 2C4G

开放端口：

- 22：SSH
- 80：HTTP
- 443：HTTPS

## 2. 安装基础环境

```bash
sudo apt update
sudo apt install -y git curl nginx

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

## 3. 拉取项目

```bash
cd /var/www
sudo git clone https://github.com/yigemushu/AI-service.git
sudo chown -R $USER:$USER /var/www/AI-service
cd /var/www/AI-service
git checkout main
```

外测阶段也可以先部署 `dev` 分支：

```bash
git checkout dev
```

## 4. 配置环境变量

在服务器项目根目录创建 `.env.local`。这个文件不要提交到 Git。

```bash
nano .env.local
```

示例：

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your_real_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_FAST_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=18000
OPENAI_MAX_OUTPUT_TOKENS=800
```

如果使用 OpenAI-compatible 服务：

```bash
AI_PROVIDER=openai-compatible
OPENAI_API_KEY=your_provider_api_key_here
OPENAI_BASE_URL=https://your-provider.example.com/v1
OPENAI_MODEL=your-model-name
OPENAI_FAST_MODEL=your-fast-model-name
```

注意：

- 不要使用 `NEXT_PUBLIC_OPENAI_API_KEY`
- 不要把 `.env.local` 上传到 GitHub
- 不要在聊天、文档或截图中暴露真实 API Key

## 5. 安装依赖并构建

```bash
npm ci
npm run lint
npm run build
```

本项目包含动态接口：

- `/api/analyze`：AI 分析接口
- `/api/health`：健康检查接口

因此不能部署成纯静态站点。

## 6. 使用 PM2 启动

```bash
sudo npm install -g pm2
pm2 start npm --name ai-service -- start
pm2 save
pm2 startup
```

确认服务：

```bash
pm2 status
curl http://127.0.0.1:3000/api/health
```

健康检查正常时会返回：

```json
{
  "ok": true,
  "service": "ai-service-workbench"
}
```

## 7. 配置 Nginx 反向代理

创建配置：

```bash
sudo nano /etc/nginx/sites-available/ai-service
```

写入：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/ai-service /etc/nginx/sites-enabled/ai-service
sudo nginx -t
sudo systemctl reload nginx
```

## 8. 配置 HTTPS

域名解析到服务器公网 IP 后，安装证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 9. 后续更新流程

所有代码改动都应该先在本地或协作者电脑上开发，通过 GitHub 同步到服务器。不要在服务器上直接修改项目代码，否则下一次 `git pull` 很容易产生冲突或覆盖。

推荐流程：

1. 在开发分支 `dev` 完成功能开发和测试。
2. 确认 `dev` 通过 `npm run lint` 和 `npm run build`。
3. 将 `dev` 合并到 `main`。
4. 推送 `main` 到 GitHub。
5. 登录香港轻量服务器。
6. 进入项目目录并更新部署。

服务器上执行：

```bash
cd /var/www/AI-service
git pull origin main
npm ci
npm run build
pm2 restart ai-service
```

更新后检查：

```bash
pm2 status
pm2 logs ai-service
curl http://localhost:3000/api/health
```

如果更新失败，可以先回滚到上一个稳定 commit：

```bash
git log --oneline -5
git checkout 上一个commit
npm ci
npm run build
pm2 restart ai-service
```

回滚后如果需要重新回到线上分支：

```bash
git checkout main
git pull origin main
```

## 10. 常用排查

查看运行日志：

```bash
pm2 logs ai-service
```

检查健康接口：

```bash
curl https://your-domain.com/api/health
```

检查 OpenAI 环境变量是否存在，不要输出真实值：

```bash
node -e "console.log(Boolean(process.env.OPENAI_API_KEY))"
```

如果 AI 分析失败：

- 确认 `.env.local` 存在
- 确认 `OPENAI_API_KEY` 有效
- 确认服务器可以访问 `OPENAI_BASE_URL`
- 确认 `AI_PROVIDER` 是 `openai` 或 `openai-compatible`
- 查看 `pm2 logs ai-service`

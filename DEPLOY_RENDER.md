# Render Free 部署

本项目需要 Node.js 后端、文件上传和 Python 数据分析，建议用 Render Web Service 的 Docker 部署。

## 步骤

1. 把本目录推送到 GitHub 仓库。
2. 在 Render 新建 Blueprint 或 Web Service，选择这个仓库。
3. Render 会读取 `render.yaml` 并使用 `Dockerfile` 构建。
4. 在 Render 环境变量中设置：
   - `SILICON_API_KEY`：可选；不设置时，用户必须在页面填写自己的 API Key。
   - `ANALYSIS_TIMEOUT_MS`：默认 `90000`。
5. 部署完成后访问 Render 分配的 HTTPS 地址。

## 注意

- `.dockerignore` 已排除 `.env`，本地测试 Key 不会进入镜像。
- Render 免费服务会在空闲后休眠，首次访问可能需要等待冷启动。
- 免费服务适合演示和答辩，不适合高并发或长时间公开服务。

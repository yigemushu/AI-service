# AI-service

这是一个用于内容项目协作的仓库。你可以把文章、脚本、选题、素材说明和结构化数据放在这里，通过 GitHub 和朋友同步。

## 目录

- `content/`：文章、脚本、选题、提示词、发布文案等文本内容。
- `assets/`：图片、音频、视频等素材文件。
- `data/`：表格、JSON、CSV 等结构化数据。
- `notes/`：会议记录、灵感、待办和过程笔记。

## 日常同步

开始工作前先拉取朋友的最新内容：

```powershell
git pull
```

写完内容后提交并同步：

```powershell
git add .
git commit -m "Update content"
git push
```

## 建议

- 文本内容优先用 Markdown：文件名示例 `2026-05-27-topic.md`。
- 大文件素材尽量按项目或日期建文件夹。
- 多人同时编辑同一个文件时，先 `git pull`，再开始修改。

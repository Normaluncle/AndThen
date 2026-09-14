# 首页还原验收 · 2026-09-14

范围仅 UI_14/01 首页。其余页面等待用户验收后再继续。

基线：`codex/verified-cloud-20260913`，HEAD `847e596`。原有未提交的 `.dockerignore` 和 `README.preview.md` 保留。

## 实现与素材

- `demo/src/Home.jsx`：首页与首页导航，可选中文本、搜索、分类、故事预览、介绍弹层。
- `demo/src/home.css`：仅首页的桌面和移动布局。
- `demo/src/home-data.js`：设计稿三则故事、日期、统计；全部 `provenance: test_fixture`，只供本地演示模式，不能触发真实回访。
- `demo/src/home-data.test.js`：筛选和演示/真实操作边界测试。
- `demo/src/main.jsx`：仅发现页使用上述组件；其他页面继续使用原组件。
- `demo/public/home/reference.png`：原始 `assets/design/UI_14/01_发现页_首页.png` 的逐字节副本。以 CSS 区域显示图片，未将整张页面当作网页。无额外生图消耗。

图片坐标为原图 1536×1024 下的 x/y/w/h：

| 资源 | 坐标 | 使用位置 |
|---|---|---|
| Logo 问号 | 69/114/26/30 | 首页导航 |
| 演示头像 | 1001/113/31/31 | 首页导航 |
| 桌面主视觉 | 585/174/460/202 | 主视觉右侧 |
| 手机主视觉 | 1150/366/326/108 | 搜索下方 |
| 桌面职场封面 | 63/488/168/133 | 第一张故事卡 |
| 桌面学习封面 | 63/660/168/133 | 第二张故事卡 |
| 桌面情感封面 | 63/829/168/132 | 第三张故事卡 |
| 手机三张封面 | 1142/(547,665,781)/86/86 | 手机故事卡 |
| 吉祥物 | 941/803/122/69 | 右栏寄语 |

线性图标集中在 `HomeIcon`，可替换为用户后续提供的正式 icon。原稿是生成 PNG，中文字体没有附带字库，网页使用 Microsoft YaHei / PingFang SC / Noto Sans SC；字形和抗锯齿仍需用户视觉验收，不能宣称像素差为零。

## Docker

核实已有两套独立栈：

- `andthen`：API 8080，测试数据库 55432，原有 worker。
- `andthen-v12-demo`：前端 5174、API 8082、独立数据库、worker 和 memory。

本次只重建并替换 `andthen-v12-demo-demo-1`。没有新增栈，没有删除容器数据、数据库卷或历史工作。

复现：`docker compose -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml build demo`，然后相同 compose 参数执行 `up -d --no-deps demo`。

## 验证

- `pnpm typecheck`：通过。
- `pnpm test`：235 通过，1 原有 memory-live 跳过；包含 OpenAPI 验证。
- `node --test demo/src/*.test.js`：20 通过。
- `pnpm --dir demo build`、Docker 前端构建：通过。
- 浏览器：桌面和手机视口对照；分类“学习”仅剩一张、搜索“辞职”仅剩一张；故事按钮打开明确标识的设计稿预览；控制台未见 error/warn。

技能已读：web-development、ui-design（固定参考稿覆盖其自由设计建议）、docker-ops、computer-use。未改后端接口或数据库，未提交代码。

待办：用户验收首页。其他页面及 Docker 合并不属于本次首页交付，暂未进行。

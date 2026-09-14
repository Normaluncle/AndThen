# UI_14 剩余页面还原记录 · 2026-09-14

分支：`codex/verified-cloud-20260913`。本次没有提交 commit。

预览：http://127.0.0.1:5174/?screen=01 。页脚页面选择器按 01–15 排序；`?screen=02` 到 `?screen=15` 可直接打开对应页面。未知编号回退首页。

## 页面与文件

| 稿号 | 页面 | 实现 |
|---|---|---|
|02|故事详情与关注理由|demo/src/design/Story.jsx|
|03|我的关注|demo/src/design/Following.jsx|
|04|通知|demo/src/design/Notifications.jsx|
|05|作者工作台|demo/src/design/Workbench.jsx|
|06|AI 回访采访|demo/src/design/Interview.jsx|
|07|确认与发布|demo/src/design/Publish.jsx|
|08|公开后来|demo/src/design/Reading.jsx|
|09|个人资料、授权与隐私|demo/src/design/Account.jsx|
|10|内部管理后台|demo/src/design/Admin.jsx|
|11|作者邀请与参与确认|demo/src/design/Invite.jsx|
|12|链接导入与来源核验|demo/src/design/Import.jsx|
|13|桌面六种空态、手机四种示例及状态切换|demo/src/design/States.jsx|
|14|Modal、Drawer、Bottom Sheet、全屏面板、Toast|demo/src/design/Overlays.jsx|
|15|17 组组件与设计规范|demo/src/design/Components.jsx|

共用文件：`DesignApp.jsx`、`shared.jsx`、`design.css`、`logic.js`、`state.js`、`state.test.js`（均在 demo/src/design）。入口调整在 demo/src/main.jsx；旧按钮样式的作用范围在 demo/src/style.css 中收窄；Home.jsx 添加页面导航连接、后台导航和通用线性图标。

## 图片

使用用户提供的原始 PNG，未生成替代插画。14 份原图与对应 public/design 文件的 SHA256 全部一致。照片、头像、插画通过原图坐标裁切显示；文字、卡片、导航、表单和弹窗为实际 HTML。组件规范中的页面缩略图使用稿内缩略图。完整名称、源路径、目标路径、尺寸和 SHA256 见 ui14-assets-20260914.json。

图标集中由 HomeIcon 输出 SVG，便于后续替换用户提供的正式图标。当前线条与系统字体并非原设计源文件，因此尚不能声明逐像素完全一致。

## 验证证据

- `pnpm --dir demo build`：通过，最终 CSS index-C7qQytAJ.css / JS index-BfLOcsnr.js。
- `pnpm typecheck`：通过。
- `pnpm test`：53 个文件通过，235 项通过，1 个真实 memory 服务测试按既有配置跳过。包含 OpenAPI、数据库与业务集成测试。
- `node --test demo/src/*.test.js demo/src/design/*.test.js`：27 项通过。
- Codex 内置浏览器：逐页查看 02–15 桌面与手机实际截图；01–15 在 360、390、768、1440 宽度附近进行 60 组 DOM 溢出及损坏图片检查，结果 failures=[]。浏览器 viewport 切换有一帧延迟，记录以实际 innerWidth 为准；最后修改的 03/13/15 再次复验，无横向溢出或损坏图片。
- 关注页四张卡片：标题与状态按钮矩形无交叠。
- 邀请 → 第 2 问回答 → 跳过余下 3 问 → 草稿 → 确认 → 阅读页：输入文字在草稿及阅读页各出现一次。
- 个人资料全屏面板：连续输入不丢失焦点；保存、再次打开、Escape 关闭、焦点回到触发按钮均验证。
- 后台搜索“读研”得到 1 行，年份 2022 得到 2 行。
- 最终 Docker 构建后仅重建 andthen-v12-demo 的 demo 服务。5174 正常；两个既有项目的 API/worker/db/memory 仍运行且健康，运行时长未因本次前端更新重置。

## 演示与现有业务

本次实现是设计稿演示，provenance=test_fixture；故事、头像与统计属于样例。演示状态仅保留在当前页面会话内，刷新会复位。邀请、知乎核验、AI、发布和后台服务状态均不代表真实外部执行。已有真实账号与 API 页面保留在 `/?mode=live#account`。这次没有完成新视觉层与全部真实业务的整合。

两个 Docker 项目是既有运行环境，这次未新建第三套，未删除容器项目、卷、分支或其他 agent 工作。`.dockerignore` 与 README.preview.md 的既有工作保留。

## 已读技能与交付边界

已读：web-development、ui-design、computer-use、docker-ops；backend-contracts 用于保持既有服务边界。本次未改 schema、迁移、业务路由或 worker。

所有稿号均有实现，无运行阻塞；图标和字体仍需用正式源资产完成最终精确校准，尚未通过用户逐页视觉验收。以上测试证明布局/交互工作及无溢出，不等同于逐像素差异为零。

## 第二轮精修

以现有 worktree 和原稿重新核对后，修正了如下可见差异：

- 02 关联故事的三张封面改用 02 原稿各自区域，消除重复封面；故事信息使用日历、书本、盾牌图标。
- 06 暂停、跳过、侧栏说明改为对应 SVG；07 编辑与可见性图标统一；08 来龙去脉侧栏补上图标。
- 09 链接、资料库、锁、隐私、下载、删除与退出图标纠正；10/11 导航与参与规则图标纠正。
- 手机 03/04/05/09/13 底栏改成稿中较小的圆形写作按钮与线性图标，“消息”入口直达 04。
- 手机 02/06/07/08 增加返回入口；首页原有底栏保留。
- 图标路径抽到 demo/src/icon-paths.js，可独立替换，新增 icon-paths.test.js 验证调用名称存在及关键图标不再误用同一路径。

本轮验证：pnpm typecheck 通过；前端 29 项测试通过；Vite 构建通过。浏览器验证 09 手机实际图标、06 暂停弹窗、02 三张关联封面；点击 02 返回到 01、09 底栏消息到 04 均通过。最终镜像重新构建并仅更新既有 demo 服务，产物 index-t8uWrElO.css / index-CCjwdvxd.js。

仍未证明整套稿的逐像素一致；整体目标继续保留。已读技能沿用上一轮（web-development、ui-design、computer-use、docker-ops、backend-contracts）。

## 第三轮：04 / 05 稿件差异

- 04：手机“读研”通知不再被 CSS 隐藏，按稿放入“本周”；手机显示 4 条，桌面保留 5 条及原分组。新增 notification-data.js / notification-data.test.js，统一初始未读集合、未读筛选和概览计数，默认已读的历史通知不再误计。补上通知页蓝色铃铛与红点、手机底栏通知数量。
- 05：恢复第一张卡片中的辞职摘要，手机第三张卡片使用原稿描边按钮；侧栏人物、书写、文档和锁图标与语义对应。
- 浏览器已查看 04/05 手机截图：04“今天”2 条、“本周”2 条，未读筛选3条；05第三按钮背景透明，页面无横向溢出。
- 本轮类型检查、前端测试和镜像构建通过；仅更新现有 demo 服务。最终资源 index-iZDHBrrX.css / index-NaQDEpAt.js。
- 已读技能沿用前述清单；尚未将整体 1:1 目标标记完成。

## 第四轮：06–08 作者流程

- 06 手机进度显示为“2 / 5”，采访说明增加原稿边框。
- 07 合并原回答前两段，让手机“当时”卡片完整显示辞职内容；时钟与成长图标按稿校准；私密入口居中。
- 08 默认手机样例使用原稿精简段落，桌面仍保留完整样例；用户编辑形成的内容不走样例节选逻辑。
- 浏览器确认 07 辞职内容存在；08 三段精简文本和 06 手机进度正确，无横向溢出。
- 前端33项测试通过，类型检查和构建通过；现有 demo 镜像更新。资源 index-hlm3cifh.css / index-D50lUBia.js。
- 已读技能仍为前述清单。整体逐像素核验尚未完成，目标继续。

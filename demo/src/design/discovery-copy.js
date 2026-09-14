/**
 * Copy for the auto-discovery sidebar.
 *
 * The same component renders this block locally and on the public server, but it
 * is a different thing in each environment: a local-only preview while
 * `DISCOVERY_AI_ENABLED` is off, and the real AI-filtered official-candidate
 * feed once it is on (`localDiscoveryEnabled` short-circuits on that flag, so it
 * no longer requires a localhost host). Calling a public feed "本地验证" and
 * promising it never reaches the public web is what made the deployed page look
 * like local-only scaffolding.
 */
export function discoveryAside(aiEnabled) {
  return {
    title: aiEnabled ? '自动发现 · 官方候选' : '自动发现 · 本地验证',
    body: '定时从知乎官方搜索发现候选，按经历与时间线索筛选。当前显示官方摘要，尚未经过作者确认或 AI 回访。',
    note: aiEnabled
      ? '候选只展示官方摘要，未经作者确认前不作为已发布内容。'
      : '每 30 秒刷新候选列表；不会发布到公网。',
  };
}

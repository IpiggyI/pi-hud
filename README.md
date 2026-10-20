# pi-hud

[claude-hud](https://github.com/jarrodwatts/claude-hud) 风格的 [pi](https://pi.dev) 两行页脚。

```text
[DeepSeek-V4.1-Flash • high | qoder] │ ezhou git:(main*) │ 15s · 260 tok/s
上下文 ▰▱▱▱▱▱▱▱▱▱ 3% 30k/1.0M │ ↑30k ↓547 缓存 99% │ $0.284 │ MCP: 1 server enabled
```

- 第一行：模型、思考级别、供应商，项目目录名（只显示最后一层）、Git 分支与状态，任务耗时与最近一次回复的生成速度。
- 第二行：上下文占用、会话累计 token、最近一次回复的缓存命中率、累计费用，以及其他扩展写入的状态（去掉原有颜色和图标）。

## 安装

```bash
pi install git:github.com/IpiggyI/pi-hud
```

然后在 pi 中执行 `/reload`。

pi-hud 会替换整个页脚。其他替换页脚的扩展（如 `pi-cometix-footer`）同时启用时只有一个生效，可在 `~/.pi/agent/settings.json` 中禁用它的扩展：

```json
{ "source": "npm:pi-cometix-footer", "extensions": [] }
```

## 修改

没有设置菜单。颜色在 `render.ts` 开头的 `COLORS`，布局在 `renderLines`。改完执行 `/reload`。

```bash
npm test
```

测试需要 Node.js 22.18 或更高版本（直接运行 TypeScript）。

## 许可证

MIT。事件与会话用量的处理方式参考了 [pi-cometix-footer](https://github.com/Xichun123/pi-cometix-footer)（MIT）。

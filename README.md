# Structured Desktop

Structured Desktop 是一个 Electron 桌面壳，复用 [Structured Web](https://web.structured.app/) 的真实页面、登录状态和 Structured Cloud 数据。它提供普通窗口和可交互的无标题栏 Widget 模式，桌面本地 UI 负责窗口、页面入口、设置、位置与退出操作。

## 开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run start          # 启动已构建应用
npm run typecheck      # TypeScript 检查
npm test               # 单元测试
npm run build:linux    # Linux .deb + AppImage（当前平台）
npm run build:win      # Windows x64 NSIS 配置（建议 Windows CI 构建）
```

首次运行会打开 Structured 官方网页。邮箱验证码、登录 Cookie、任务和同步都由 Structured 官方站点处理；应用不会保存验证码或自行实现私有 API。登录数据保存在 Electron `persist:structured-cloud` Session 中。

## 窗口与平台行为

- 普通模式使用系统标题栏、任务栏入口和可调整大小的窗口。
- Widget 模式以 56 DIP 圆球停靠在屏幕左右边缘；收起时圆球向边缘滑出一半并略微变暗，鼠标悬停时滑回完整显示，拖动后吸附到最近边缘。点击圆球打开圆角任务窗口，点击窗口外部收回圆球；Structured 页面在后台保持渲染，展开时不重新加载。
- Widget 模式使用无边框窗口和 `skipTaskbar`。Linux 任务栏隐藏是否生效由 GNOME/X11 窗口管理器决定。
- 在原生 Wayland 中，应用不会虚报精确窗口定位能力；如需 XWayland 定位，可手动以 `--ozone-platform=x11` 启动。应用不会修改系统会话配置。
- 位置和尺寸采用 DIP，按显示器工作区夹紧，显示器断开后回退到当前主显示器。
- 设置面板始终提供“退出应用”，并配有 Tray 菜单作为恢复入口（GNOME 是否显示托盘由 Shell/扩展决定）。

## 安全边界

Structured 页面与本地控制层使用不同 WebContentsView；远程页面启用 `sandbox`、`contextIsolation`、关闭 Node 集成，仅允许 `web.structured.app` 导航。设置写入用户数据目录并采用临时文件原子替换。

## Windows 发布

`.github/workflows/windows.yml` 会在 Windows runner 上运行 typecheck、测试并生成 NSIS 安装包。Linux 环境下的交叉构建只能证明打包配置可解析，不能替代 Windows 实机验证。

## 已知构建状态

Linux 与 Windows 安装包由 GitHub Actions 按版本标签构建并上传到 Releases。Windows NSIS 需要 Windows runner；Linux `.deb` 与 AppImage 由 Ubuntu runner 生成。

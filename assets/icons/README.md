# TabMod — 扩展图标

需要生成以下尺寸的 PNG 图标文件：

| 文件名 | 尺寸 | 用途 |
|--------|------|------|
| `icon16.png` | 16×16 | 浏览器工具栏、右键菜单 |
| `icon48.png` | 48×48 | 扩展管理页面 |
| `icon128.png` | 128×128 | Chrome Web Store 列表 |

建议用 Figma 导出或使用在线工具从 SVG 源文件生成。

## 设计规范

- 主色：#1A73E8 (Google Blue)
- 图形：简化标签页图标（重叠矩形或文件夹形态）
- 风格：Material Design 风格，扁平化
- 背景：透明（png）

SVG 源文件参考（icon128 版本）：
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="16" y="28" width="96" height="72" rx="8" fill="#1A73E8" opacity="0.9"/>
  <rect x="24" y="28" width="32" height="36" rx="6" fill="#FFFFFF" opacity="0.2"/>
  <rect x="40" y="52" width="56" height="4" rx="2" fill="#FFFFFF" opacity="0.5"/>
  <rect x="40" y="62" width="40" height="4" rx="2" fill="#FFFFFF" opacity="0.3"/>
  <rect x="40" y="72" width="48" height="4" rx="2" fill="#FFFFFF" opacity="0.3"/>
</svg>
```

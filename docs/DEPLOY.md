# TabMod 官网 + 隐私政策 · 部署说明

这两页是 CWS 详情页缺失的两项要素：**Homepage URL** 和 **Privacy policy URL**。都指向本目录。

## 文件

```
docs/
├── index.html                     落地页（Homepage URL 指向它）
├── privacy.html                   隐私政策（Privacy policy URL 指向它）
└── assets/
    ├── icon128.png
    ├── screenshot-1-main.png      ← 5 张截图，均为 1280×800
    ├── screenshot-2-saveall.png
    ├── screenshot-3-search.png
    ├── screenshot-4-sync.png
    └── screenshot-5-features.png
```

## 部署（GitHub Pages，5 步）

```
1. 本目录已在仓库 jdongxiao/tabmod 内，提交并推送：
     cd <仓库根>
     git add docs/
     git commit -m "Add landing page and privacy policy for Chrome Web Store"
     git push

2. 打开 https://github.com/jdongxiao/tabmod/settings/pages
3. Source 选 "Deploy from a branch"
   Branch 选 main，Folder 选 /docs  → Save
4. 等 1-2 分钟，得到两个地址：
     Homepage      https://jdongxiao.github.io/tabmod/
     Privacy       https://jdongxiao.github.io/tabmod/privacy.html
5. 回到 Chrome Web Store 开发者后台 → Store listing，把这两个地址分别填进
   Homepage URL 和 Privacy policy URL
```

**注意**：免费版 GitHub Pages 要求仓库为 public。若该仓库是私有的，二选一：
- 把仓库改为 public（会公开扩展源码）
- 新建一个 public 仓库（如 `tabmod-site`），只放本 `docs/` 内容

## CWS 后台要填的字段（照抄）

| 字段 | 值 |
|---|---|
| Homepage URL | `https://jdongxiao.github.io/tabmod/` |
| Privacy policy URL | `https://jdongxiao.github.io/tabmod/privacy.html` |
| Category | `Productivity`（现在错放在 Tools） |
| Short description | 见整改清单附录 A（128 字符，已验合规） |
| Detailed description | 见整改清单附录 A |

## ⚠️ 提交前必须先解决的两件事

1. ~~**邮箱域名 `tabmod.app` 未注册**~~ → **已解决（2026-10-08）**
   联系方式已统一替换为 `jdongxiao@gmail.com`（`privacy.html` 内 3 处）。
   若日后注册 `tabmod.app`，再换回 `privacy@tabmod.app` 更专业。

2. **Pro 付费尚未做**（扩展里点 Upgrade 只弹 "Pro coming soon"）
   因此落地页**没有**写购买链接和价格——写 "$29.99 立即购买" 会指向不存在的流程，属于虚假宣传。
   Pro 上线后再补 pricing 区块和 Lemon Squeezy 链接。

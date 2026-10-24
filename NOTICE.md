# NOTICE — 来源、授权与注意事项

这个项目**不是从零写的**。它建立在 [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks)
之上，那个项目原来没有许可证文件 —— 2026-10-24 上游补上了 MIT。
**本仓库同样是 MIT**，两段版权的归属写在下面。

---

## 1. 上游项目

| 项 | 内容 |
|---|---|
| 项目 | [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks) |
| 作者 | drewdi（`Copyright (c) 2026 drewdi`） |
| 描述 | ascii shark components in typescript |
| 技术 | TypeScript，零运行时依赖 |
| 许可证 | **MIT**，自 [`a0074c1 add MIT license`](https://github.com/stackedlol/ascii-sharks/commit/a0074c16a106f0abc665fe9712ca445f8f98ad8e)（2026-10-24）起 |
| issue #1 | [Missing license](https://github.com/stackedlol/ascii-sharks/issues/1) 仍 open，但作者已在 2026-10-24 回复 **"Added MIT license"** |

### 从上游继承的部分

- `src/world.ts` —— 鱼群 boids 求解器、Couzin 分区、恐慌传播、鲨鱼 follow-the-leader 脊柱、饥饿与捕食逻辑、无散度海流；
- `src/species.ts` —— 五种鱼的行为参数表；
- `src/renderer.ts` —— 逐格光栅化、亚像素抗锯齿、字形密度与明暗的反向映射、尾迹扩散；
- `src/shapes.ts` —— 八种鲨鱼的外形函数与鳍/鳃/眼的位置参数；
- `src/math.ts` —— clamp、角度差、整数哈希、海流场。

上游是把鲨鱼外形内联在 `renderer.ts` 里的，本仓库把外形函数拆到 `shapes.ts`，
所以「移植」在这里指**代码搬家 + 改写为 ESM/TS + 在上面加东西**，不是逐字复制。

### 本项目的原创部分

- 虎鲸外形（`orcaHalfWidth`、`flukes`、`paddle`、`patch`、`saddle`）与它在渲染器里的采样；
- DSH 客户端插件的全部接线（`entry.ts`、`surface.tsx`、`settings-row.tsx`、`store.ts`、`index.ts`）；
- 明暗主题适配、整体透明度、鲸类尾拍、离屏/可见性/减动效生命周期；
- `engine.ts` 的宿主生命周期包装（上游同名文件只有 ~135 行裸循环，这里是 264 行的可嵌入版本）；
- 构建产物与预览页（`scripts/`、`preview/`）。

---

## 2. 授权

**MIT。** 见 [LICENSE](LICENSE)。那一个文件里并列两条版权行：

| 部分 | 版权 | 许可 |
|---|---|---|
| 移植的引擎（`world.ts` / `renderer.ts` / `shapes.ts` / `species.ts` / `math.ts`） | drewdi，**外加本仓库的移植与增补** | MIT |
| 本仓库原创（虎鲸外形、DSH 接线、主题适配、生命周期、构建脚本） | OG Hong | MIT |

`LICENSE` 里只有标准 MIT 正文，不含额外说明 —— GitHub 的许可证识别器要跟模板
逐句比对，正文里插一段解释就会被判成 `Other / NOASSERTION`。分工与来源全部记在这
份 NOTICE 与源码文件头里。

两份都要求保留版权声明与许可全文 —— 所以：

- **自己用、本地跑、读代码** —— 随意；
- **复用到自己项目** —— 可以，带上 `LICENSE`；
- **商用** —— 可以，带上 `LICENSE`；
- **重新分发** —— 可以，带上 `LICENSE` 与这份 `NOTICE.md`。

分发编译产物时注意：`lib/client.js` 是 esbuild 压过的单文件 bundle，
源码里的注释不会留在里面。`scripts/build-client.mjs` 会在文件头写入一段
MIT 版权 banner，用来满足「copies or substantial portions of the Software」
那一句；**去掉那个 banner 再分发就是违反 MIT**。

### 时间线（为什么曾经是「无许可证」）

| 日期 | 事件 |
|---|---|
| 2026-10-20 前后 | 移植开始；上游无 LICENSE，issue #1 只有两条「投 MIT」的评论 |
| 2026-10-21 | 在 issue #1 留言请求授权，说明移植范围；本仓库当时**主动撤掉 MIT**，改为「不授予任何权利」，因为给一个上游未授权的移植挂 MIT 是误导 |
| 2026-10-24 16:05Z | 上游提交 `add MIT license` |
| 2026-10-24 16:09Z | 上游作者在 issue #1 回复 "Added MIT license" |
| 本次 | 本仓库恢复 MIT，`NOTICE`/`README`/文件头/包元数据/构建 banner 全部跟随 |

那段「无许可证」的历史不是错误，是当时唯一诚实的写法。上游一给出授权，
这个理由就消失了，所以现在改回来。

---

## 3. 与 DSH 的关系

本插件依赖 DeepSeek Harness 的客户端插件契约，但**没有**打包任何 `@deepseek-ai/*` 运行时代码 —— 全部声明为 external / link。

DSH 自身的许可证见其官方仓库。本插件不改变、也不代表 DSH 的授权条款。

### 兼容性

针对 DSH `0.2.1-rc.2` 开发与验证。它依赖三个**非公开契约**的细节，DSH 升级时可能失效：

| 依赖点 | 说明 | 失效表现 |
|---|---|---|
| `[data-phase="hero"]` | 通过 DOM 属性判断「当前是否新建会话页」 | 海洋不出现，或出现在会话里 |
| `body[data-ds-dark-theme]` | 通过属性判断明暗主题 | 配色反了 |
| `window.__ModuleLoader__.load()` 的形状 | 客户端半区的加载信封 | 整个插件不加载 |

这三处都在 `src/surface.tsx` 与 `scripts/build-client.mjs` 里，附有注释说明。

---

## 4. 数据与隐私

- 插件**不联网**。没有网络请求、没有遥测、没有外部字体。
- 配置存在浏览器 `localStorage`，键 `dsh-ascii-sharks:v2`。不写入 Host 设置文档，不上传。
- canvas 是 `aria-hidden="true"` 的纯装饰，不进入无障碍树。

---

## 5. 性能注意

- 固定 1/60 步长，单帧最多补 4 步；离屏、切标签页、`prefers-reduced-motion` 时停止。
- 设备像素比封顶 2。
- 实测：hero 相位稳定 60fps，JS 堆约 31MB。
- 鱼群数量按画布面积计算（`clamp(面积/4400, 85, 340)`）；**超宽屏**会到上限 340 条，CPU 占用明显高于普通窗口。

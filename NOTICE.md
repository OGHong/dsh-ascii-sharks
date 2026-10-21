# NOTICE — 来源、授权与注意事项

这个项目**不是从零写的**。它建立在一个别人的开源项目之上，而那个项目缺少许可证文件。
在分发、修改、商用之前，请把这份文件读完。**本仓库没有许可证。**

---

## 1. 上游项目

| 项 | 内容 |
|---|---|
| 项目 | [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks) |
| 描述 | ascii shark components in typescript |
| 技术 | TypeScript，零运行时依赖 |
| 上游状态（查证于 2026-10） | **无 LICENSE 文件**；issue [#1 "Missing license"](https://github.com/stackedlol/ascii-sharks/issues/1) 处于 open 状态，两条评论均请求 MIT |

### 从上游继承的部分

以下**不是**本项目的原创工作，版权属于上游作者：

- `src/world.ts` —— 鱼群 boids 求解器、Couzin 分区、恐慌传播、鲨鱼 follow-the-leader 脊柱、饥饿与捕食逻辑、无散度海流；
- `src/species.ts` —— 五种鱼的行为参数表；
- `src/renderer.ts` —— 逐格光栅化、亚像素抗锯齿、字形密度与明暗的反向映射、尾迹扩散；
- `src/shapes.ts` —— 八种鲨鱼的外形函数与鳍/鳃/眼的位置参数；
- `src/math.ts` —— clamp、角度差、整数哈希、海流场。

### 本项目的原创部分

- 虎鲸外形（`orcaHalfWidth`、`flukes`、`paddle`、`patch`、`saddle`）与它在渲染器里的采样；
- DSH 客户端插件的全部接线（`entry.ts`、`surface.tsx`、`settings-row.tsx`、`store.ts`、`index.ts`）；
- 明暗主题适配、整体透明度、鲸类尾拍、离屏/可见性/减动效生命周期；
- 构建产物与预览页（`scripts/`、`preview/`）。

---

## 2. 授权现状：**没有许可证**

**本仓库不授予任何许可。** 没有 LICENSE 文件，没有 MIT，没有「随便用」。

原因很简单：既然移植进来的那部分代码本身没有授权，那么给整个仓库挂一个开源许可证就是在撒谎 —— 一个 MIT 标签会让人以为「这些代码可以自由使用」，而实际上上游那部分你不能从我这里获得任何权利。

### 各部分的实际情况

| 部分 | 版权 | 你可以做什么 |
|---|---|---|
| 移植的引擎（`world.ts` / `renderer.ts` / `shapes.ts` / `species.ts` / `math.ts`） | 上游作者，**未授权** | 严格说：除查看学习外，没有明确许可 |
| 本项目原创（虎鲸外形、DSH 接线、主题适配等） | 本仓库作者 | 也未授权。想用请联系我 |

### 实际影响

- **自己用、本地跑、读代码学习** —— 没人会来找你，这也是本仓库的定位；
- **复用到自己项目** —— 移植部分你需要自己去找上游作者要授权，我这边给不了你；
- **商业使用** —— 不要。两部分都没授权。
- **重新分发本仓库** —— 请连同 `NOTICE.md` 一起，并且不要声称它是开源的。

### 想让它可以被合法使用，三条路

1. 去 [上游 issue #1](https://github.com/stackedlol/ascii-sharks/issues/1) 请求明确许可证（社区已有两条同样的请求）；
2. 直接联系上游作者 `stackedlol` 取得书面授权；
3. 按同样的算法思路重写受影响的文件（boids、Couzin 分区、follow-the-leader 都是公开发表的学术方法，不受版权保护；受保护的是具体代码表达）。重写之后，那部分就归重写者。

在此之前，**请把本仓库视为「学习与个人使用」用途**。

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

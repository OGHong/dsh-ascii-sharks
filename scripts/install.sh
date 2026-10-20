#!/bin/sh
# 一键装好 dsh-ascii-sharks：构建 lib/ 并接进一个 dsh profile。
#
#   sh scripts/install.sh                 # 接进 desktop profile（默认）
#   sh scripts/install.sh --profile=web   # 指定 profile
#   sh scripts/install.sh --dry-run       # 只打印要做什么，不改任何文件
#   sh scripts/install.sh --uninstall     # 从 profile 里摘掉（保留源码）
#
# 做三件事，都可重复执行：
#   1. npm install && npm run verify —— 产出 lib/index.js（Host 半区）与
#      lib/client.js（浏览器半区，单文件 bundle）；
#   2. package.json 里加 link: 依赖 + 加进 dsh.profile.bundles；
#   3. 建 node_modules 符号链接。
#
# 之后必须重启一次 DeepSeek Harness：宿主启动时才扫描插件清单。
set -eu

DRY_RUN=0
UNINSTALL=0
PROFILE_NAME=""
while [ $# -gt 0 ]; do
	case "$1" in
		--dry-run) DRY_RUN=1 ;;
		--uninstall) UNINSTALL=1 ;;
		--profile) PROFILE_NAME="${2:-}"; shift ;;
		--profile=*) PROFILE_NAME="${1#*=}" ;;
		-h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "未知参数：$1（-h 看用法）" >&2; exit 2 ;;
	esac
	shift
done

DIR=$(cd "$(dirname "$0")/.." && pwd)
PKG=dsh-ascii-sharks
printf '插件目录: %s\n' "$DIR"
[ "$DRY_RUN" = 1 ] && printf '模式: --dry-run（只打印，不改任何文件）\n'

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
if [ -z "$PROFILE_NAME" ]; then
	for cand in "$DSH_HOME"/profiles/*/; do
		[ -f "$cand/package.json" ] || continue
		if grep -q "\"$PKG\"" "$cand/package.json" 2>/dev/null; then
			PROFILE_NAME=$(basename "$cand"); break
		fi
	done
	[ -n "$PROFILE_NAME" ] || PROFILE_NAME=desktop
fi
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
[ -f "$PROFILE_DIR/package.json" ] || { echo "⚠ 找不到 $PROFILE_DIR/package.json（用 --profile=<名字> 指定）" >&2; exit 1; }
echo "profile: $PROFILE_NAME ($PROFILE_DIR)"
echo

if [ "$UNINSTALL" = 0 ]; then
	printf '1) 构建\n'
	if [ "$DRY_RUN" = 1 ]; then
		echo "   [dry-run] npm install && npm run verify"
	elif ! command -v npm >/dev/null 2>&1; then
		echo "   ⚠ 没有 npm —— 需要 Node 22.6+" >&2; exit 1
	elif (cd "$DIR" && npm install --no-audit --no-fund >/dev/null 2>&1 && npm run verify >/dev/null 2>&1); then
		echo "   构建完成（lib/index.js + lib/client.js）"
	else
		echo "   ⚠ 构建失败 —— 先手动跑 npm run verify 看报错" >&2; exit 1
	fi
fi

printf '\n2) 接进 profile\n'
if [ "$DRY_RUN" = 1 ]; then
	if [ "$UNINSTALL" = 1 ]; then
		echo "   [dry-run] 会从 package.json 摘掉 dependencies.$PKG 与 dsh.profile.bundles 里的这一项"
		echo "   [dry-run] 会删掉 $PROFILE_DIR/node_modules/$PKG"
	else
		echo "   [dry-run] dependencies.$PKG = link:$DIR"
		echo "   [dry-run] dsh.profile.bundles += $PKG"
		echo "   [dry-run] 符号链接 $PROFILE_DIR/node_modules/$PKG -> $DIR"
	fi
	exit 0
fi

python3 - "$PROFILE_DIR" "$DIR" "$PKG" "$UNINSTALL" <<'PY'
import json, os, shutil, sys, time
from pathlib import Path

profile, plugin, pkg_name, uninstall = Path(sys.argv[1]), Path(sys.argv[2]).resolve(), sys.argv[3], sys.argv[4] == "1"
pkg_path = profile / "package.json"
pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
changed = []

if uninstall:
    if pkg.get("dependencies", {}).pop(pkg_name, None) is not None:
        changed.append("dependencies")
    bundles = pkg.get("dsh", {}).get("profile", {}).get("bundles", [])
    if pkg_name in bundles:
        bundles.remove(pkg_name)
        changed.append("dsh.profile.bundles")
else:
    if pkg.setdefault("dependencies", {}).get(pkg_name) != f"link:{plugin}":
        pkg["dependencies"][pkg_name] = f"link:{plugin}"
        changed.append("dependencies")
    bundles = pkg.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
    if pkg_name not in bundles:
        bundles.append(pkg_name)
        changed.append("dsh.profile.bundles")

if changed:
    backup = pkg_path.with_name(f"package.json.bak-ascii-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(pkg_path, backup)
    pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"   写入 package.json（{'、'.join(changed)}），备份 {backup.name}")
else:
    print("   package.json 已是目标状态，跳过")

link = profile / "node_modules" / pkg_name
if uninstall:
    if link.is_symlink() or link.exists():
        if link.is_symlink():
            link.unlink()
        else:
            shutil.rmtree(link)
        print(f"   已移除 {link}")
    else:
        print("   符号链接本来就不存在")
else:
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() and os.path.realpath(link) == os.path.realpath(plugin):
        print("   符号链接已就绪")
    elif link.exists() and not link.is_symlink():
        print(f"   ⚠ {link} 已存在且不是符号链接，没动它 —— 请手动确认", file=sys.stderr)
    else:
        if link.is_symlink():
            link.unlink()
        link.symlink_to(plugin)
        print(f"   已建符号链接 node_modules/{pkg_name} -> {plugin}")
PY

cat <<'TXT'

还差一件事：重启 DeepSeek Harness —— 宿主启动时才扫描插件清单（浏览器半区同理）。
重启后：新建会话页的背景就是这片 ASCII 海；设置 → 通用设置 里有「ASCII 海洋」那一行。

摘除：sh scripts/install.sh --uninstall，再重启。
TXT

#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "使用方式：new-project <專案名稱>" >&2
  exit 2
fi

name="$1"
case "$name" in
  *[!a-zA-Z0-9._-]*|'') echo "專案名稱只能包含英文字母、數字、句點、底線與連字號。" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$root/project-template"
target="$root/projects/$name"

if [ -e "$target" ]; then
  echo "安全停止：拒絕覆寫已存在的路徑：$target" >&2
  exit 1
fi

mkdir -p "$root/projects"
cp -a "$template" "$target"
cp "$root/project-template.gitignore" "$target/.gitignore"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sed -i "s/__PROJECT_NAME__/$name/g; s/__CREATED_AT__/$created_at/g" "$target/.ai/PROJECT_STATE.json" "$target/.ai/TASK_GRAPH.json"
git -C "$target" init -q -b main
git -C "$target" config user.name "Page Studio Autodev"
git -C "$target" config user.email "autodev@page-studio.local"
git -C "$target" add -A
git -C "$target" commit -q -m "chore: 建立 Page Studio 專案基準"
echo "【建立完成】已建立隔離專案：$target"
echo "【Git 基準】已建立 main 分支與初始 commit；自動化身份僅套用於此 repository。"
echo "【下一步】進入專案後執行：page-autodev start $name"

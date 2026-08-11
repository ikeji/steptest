#!/bin/sh
# node_modules の実体を ~/.cache/blockcad-steptest/ に置き、プロジェクトからは
# シンボリックリンクで参照する (~/work 以下は定期バックアップされるので、
# 重い生成物を置かないため)。
# npm install はシンボリックリンクの node_modules を実体ディレクトリに
# 置き換えてしまうので、install 後にこのスクリプトで戻す。
set -e
cd "$(dirname "$0")/.."
CACHE="$HOME/.cache/blockcad-steptest"

if [ -L node_modules ]; then
  echo "node_modules はすでにシンボリックリンクです"
else
  mkdir -p "$CACHE"
  rm -rf "$CACHE/node_modules"
  mv node_modules "$CACHE/node_modules"
  ln -s "$CACHE/node_modules" node_modules
  echo "node_modules を $CACHE に移してリンクを張りました"
fi

if [ ! -e dist ]; then
  mkdir -p "$CACHE/dist"
  ln -s "$CACHE/dist" dist
  echo "dist のリンクを張りました"
fi

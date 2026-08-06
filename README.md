# BlockCAD

Blockly のブロックで形状を組み立て、OCCT (opencascade.js) で B-Rep モデリングする Web ベース CAD のプロトタイプ。

## 仕組み

```
Blockly ブロック
  → JavaScript コード生成 (replicad API 呼び出し)
  → Web Worker 内で OCCT (WASM) が実行
  → メッシュを three.js で表示
```

- **UI**: Blockly (日本語ロケール)。ワークスペースは localStorage に自動保存。ツールボックス (ブロック一覧) はデフォルト非表示で、ツールバーの「ブロック一覧」ボタンで出し入れ。
- **カーネル**: [replicad](https://replicad.xyz/) — opencascade.js の高水準ラッパー。STEP/STL 書き出しに対応。
- **表示**: three.js + replicad-threejs-helper。Z-up の CAD 座標系。
- **実行**: ブロック変更から 300ms デバウンスで自動再計算。重い OCCT 処理はすべて Worker 内。
- **プロジェクトファイル**: 「開く / 保存 / 名前を付けて保存」(Ctrl+O / Ctrl+S / Ctrl+Shift+S) でワークスペースを JSON ファイルに読み書き。Chrome 系は File System Access API で同じファイルに上書き保存、非対応ブラウザはダウンロード/アップロードにフォールバック。
- **アクションメニュー**: 3D ビュー右上のコンテキストメニュー。未選択時は形状 (直方体/円柱/球) を追加でき、形状を選択中は選択している形状を変形 (移動/回転/拡大縮小/フィレット/面取り) ブロックで包む。追加・ラップ後は対象が自動選択されるので、そのままギズモや連続ラップで編集を続けられる。
- **移動・回転ギズモ**: 移動ブロックを選択すると XYZ 矢印、回転ブロックを選択すると選択中の軸の回転リング (TransformControls) が 3D ビューに出て、ドラッグでブロックの数値を直接編集できる (移動 0.1 / 角度 1° 単位に丸め)。数値の入力に式が入っている場合はギズモは出ない。
- **replicad コード表示**: 「コード」ボタンで、いま 3D ビューに描画しているものと同じ生成コードを replicad スクリプト形式 (`const main = (replicad) => {...}`) で下部パネルに表示。コピーしてそのまま replicad で使える。
- **選択プレビュー**: ブロックを選択するとその形状だけを 3D 表示する(数値などを選択した場合は親をたどって最初の形状ブロックを表示)。選択解除で全体表示に戻る。STL/STEP 書き出しは常に全体が対象。

## 開発

```sh
npm run dev        # 開発サーバー
npm run build      # 本番ビルド (dist/)
npm run typecheck  # tsc --noEmit
node smoke.mjs     # ヘッドレスブラウザでの動作確認 (dev サーバーをポート5199で起動しておく)
```

## GitHub Pages へのデプロイ

ビルド成果物は `gh-pages` ブランチに入れる (`vite.config.ts` の `base: "./"` でサブパス配信に対応済み)。

```sh
npm run build
git worktree add --orphan -b gh-pages /tmp/gh-pages   # 初回のみ。2回目以降は -b を外して既存ブランチをチェックアウト
cp -r dist/. /tmp/gh-pages/ && touch /tmp/gh-pages/.nojekyll
git -C /tmp/gh-pages add -A && git -C /tmp/gh-pages commit -m "Deploy"
git worktree remove /tmp/gh-pages
git push origin main gh-pages
```

GitHub リポジトリの Settings → Pages で「Deploy from a branch」→ `gh-pages` / `/ (root)` を選ぶ。

## ファイル構成

- `src/blocks.ts` — CAD ブロック定義 + JS コードジェネレータ + ツールボックス
- `src/cad-worker.ts` — OCCT 初期化、生成コードの実行、メッシュ化、STL/STEP 書き出し
- `src/viewer.ts` — three.js ビューア
- `src/main.ts` — 配線 (Blockly ⇔ Worker ⇔ ビューア)

## ブロック一覧

- 形状: 直方体 / 円柱 / 球
- 変形: 移動 / 回転 (軸選択) / 拡大縮小
- 組み合わせ: 合体 (fuse) / 削る (cut) / 共通部分 (intersect) / フィレット / 面取り
- 出力: 表示する (これに繋いだ形状が 3D ビューに出る)
- Blockly 標準の数値・演算・くり返し・変数ブロックも使えるので、ループでの繰り返し配置が可能

## 今後のアイデア

- 2D スケッチ → 押し出し / 回転体 (replicad の draw API)
- エッジ選択付きフィレット (現状は全エッジ)
- 平面上への配置・ミラー・パターン複製ブロック

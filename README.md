# BlockCAD

Blockly のブロックで形状を組み立て、OCCT (opencascade.js) で B-Rep モデリングする Web ベース CAD のプロトタイプ。

## 仕組み

```
Blockly ブロック
  → JavaScript コード生成 (replicad API 呼び出し)
  → Web Worker 内で OCCT (WASM) が実行
  → メッシュを three.js で表示
```

- **UI**: Blockly (日本語ロケール)。ワークスペースは localStorage に自動保存。
- **カーネル**: [replicad](https://replicad.xyz/) — opencascade.js の高水準ラッパー。STEP/STL 書き出しに対応。
- **表示**: three.js + replicad-threejs-helper。Z-up の CAD 座標系。
- **実行**: ブロック変更から 300ms デバウンスで自動再計算。重い OCCT 処理はすべて Worker 内。

## 開発

```sh
npm run dev        # 開発サーバー
npm run build      # 本番ビルド (dist/)
npm run typecheck  # tsc --noEmit
node smoke.mjs     # ヘッドレスブラウザでの動作確認 (dev サーバーをポート5199で起動しておく)
```

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
- 生成された replicad コードの表示パネル

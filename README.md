# Meme Editor for Vencord

Discord の画像添付を右クリックして、簡易 meme 編集画面を開く Vencord userplugin です。

## できること

- 画像付きメッセージの右クリックメニューから Meme Editor を開く
- 任意テキストを追加
- 絵文字を追加
- サーバー内ユーザーのアイコンを追加
- レイヤーの移動、拡大縮小、回転、削除
- 編集結果を PNG として保存

## 導入

このフォルダの中身を Vencord の userplugins に配置してください。

例:

```text
Vencord/src/userplugins/memeEditor/
  index.tsx
  style.css
  README.md
```

その後 Vencord を再ビルドし、設定画面から `Meme Editor` を有効化します。

```bash
pnpm build
```

## 使い方

画像が添付されたメッセージを右クリックし、`Meme Editor` を選びます。編集後は `Download PNG` で保存できます。

## 注意

Discord/Vencord の内部 API は更新で変わることがあります。右クリックメニューが出ない場合は、Vencord 側の ContextMenu API 変更に合わせた調整が必要です。

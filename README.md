<img width="1527" height="1141" alt="sample1" src="https://github.com/user-attachments/assets/9229d810-def3-4a81-beb4-fddae7881223" />

# Meme Editor for Vencord

以前Discordに存在した機能で、画像にユーザーのアイコンを加えるといった画像編集ができるRemixを再現したVencordプラグインです。  

## できること

- 画像付きメッセージの右クリックメニューから編集画面を開ける
- テキストを追加
- 絵文字を追加
- ユーザーのアイコンを追加
- レイヤーの移動、拡大縮小、回転、削除
- 編集結果をそのまま送信

## 導入
自らVencordにこのフォルダーを加えてビルドし直す必要があります。  
1. [Vencord](https://docs.vencord.dev/installing/) を参照して環境を整えます。  
2. ./src/userpluginsフォルダを作成します。  
3. Vencord-Meme-Editorを展開し、そのフォルダーを userplugins に配置してください。  
例:

```text
Vencord/src/userplugins/Vencord-Meme-Editor/
  index.tsx
  style.css
  README.md
  etc...
```

4. その後 Vencord をビルドし、設定画面から `Meme Editor` を有効化します。

```bash
pnpm build
```

## 使い方

画像が添付されたメッセージを右クリックし、`Meme Editor` をクリックして編集画面を開きます。編集後は `Paste to Chat` で送信準備ができます。

## 注意

Discord/Vencord の内部 API は更新で変わることがあります。右クリックメニューが出ない場合は、Vencord 側の ContextMenu API 変更に合わせた調整が必要です。

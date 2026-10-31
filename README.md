# design-canvas

English | [日本語](#日本語)

An agent skill that puts your React app's real components on a pannable, zoomable canvas, so you can explore and compare UI directions side by side by talking to your coding agent.

https://github.com/user-attachments/assets/8636c331-2bf3-43d8-a18c-4dda4f490137

Instead of asking the agent to build a canvas from scratch for every project, the skill installs a ready-made, tested canvas shell and fits it to your app. The agent only writes the items you want to compare.

## What you get

- **Real components, no backend.** Items render your app's own components with synthetic data, styles, and themes.
- **Talk about what you see.** Click an item's name to copy it. Hold ⌥/Alt and click any element to copy a reference such as `Pricing card · compact › button “Upgrade”`, then paste it into the conversation.
- **Annotate many things, paste once.** Press A or the Annotate button, click elements, and write a note on each. Copy them all as one numbered message for the agent; each pin clears itself once the agent has changed its item.
- **Real viewports.** Mark an item `viewport: true` and it renders in a frame of its own width, so breakpoints and media queries behave as on a real phone or desktop.
- **Your themes.** Light and dark (or any themes the app has) switch from the toolbar, across every item.
- **Stays on the canvas.** Links, form submits, and router calls inside previews never navigate away; they show where they would have gone.
- **One item alone.** Open any item in its own tab at its real size, ready for a screenshot or a design-tool import.
- **A quiet workspace.** Drag items by their name, pan, zoom, fit all, and reload without losing the layout.

## Requirements

- macOS (the installer uses bash, rsync, and perl).
- A React app. Next.js and Vite apps are detected and fitted automatically, including Tailwind and shadcn/ui.
- Vite in the app, or permission for the agent to add it as a dev dependency. Next.js apps that build Tailwind with Turbopack also need `@tailwindcss/vite`.

## Install

```sh
npx skills add charlie5188/design-canvas
```

Then ask your agent, for example:

- "Make a canvas comparing three layouts for the pricing card."
- "Add a version of the inbox with grouped notifications next to the current one."
- "Show the settings page on a phone and on desktop."

## How it works

- `skills/design-canvas/shell/`: the canvas itself, in React. It is copied into each canvas and never rebuilt by the agent.
- `skills/design-canvas/kits/react-vite/`: a Vite page that sits beside your app, reuses its aliases, styles, environment, and Vite plugins, and swaps Next.js-only modules for stand-ins.
- `skills/design-canvas/scripts/install.sh`: copies the shell and kit into `<app>/design-canvas/<name>/` and detects what it can.
- `skills/design-canvas/references/making-a-kit.md`: the checklist the agent follows to finish fitting your app, and how to save that fit as a private kit in `~/.agents/design-canvas-kits/` so the next install needs none.

Canvases are prototypes. Commit one only when you want to share it.

## Limits

- The shell is React. For other frameworks, the agent ports it using `shell/TESTING.md` as the acceptance list.
- Server components, server actions, and anything that needs a server secret cannot render on the canvas; preview the client component beneath them instead.
- Inside `viewport` frames, middle-button pan and touch pinch do not reach the canvas.

## Credits

The canvas rules are adapted from [`create-canvas`](https://github.com/ibelick/ui-skills) by Julien Thibeaut (MIT).

## License

MIT. See [LICENSE](LICENSE).

---

## 日本語

React アプリの実際のコンポーネントを、パン・ズームできるキャンバスに並べるエージェントスキルです。コーディングエージェントと会話しながら、UI の方向性を並べて検討・比較できます。

プロジェクトごとにキャンバスをゼロから作らせる代わりに、このスキルはテスト済みのキャンバス本体をインストールし、アプリに合わせて設定します。エージェントが書くのは、比較したいアイテムだけです。

### できること

- **本物のコンポーネント、バックエンドなし。** アイテムはアプリ自身のコンポーネントを、合成データとアプリのスタイル・テーマで表示します。
- **見ているものをそのまま会話に。** アイテム名をクリックすると名前をコピーできます。⌥/Alt を押しながら要素をクリックすると、`Pricing card · compact › button “Upgrade”` のような参照をコピーでき、そのまま会話に貼り付けられます。
- **まとめて注釈して、一度で貼り付け。** A キーか Annotate ボタンで注釈モードにし、要素をクリックしてそれぞれにメモを書きます。すべてを番号付きの 1 つのメッセージとしてコピーしてエージェントに渡せます。エージェントがそのアイテムを変更すると、ピンは自動で消えます。
- **本物のビューポート。** アイテムに `viewport: true` を指定すると、そのアイテムの幅を持つフレーム内で表示されます。ブレークポイントやメディアクエリが、実際のスマートフォンやデスクトップと同じように動きます。
- **アプリのテーマ。** ライト・ダーク（またはアプリが持つ任意のテーマ）をツールバーから切り替えられ、すべてのアイテムに反映されます。
- **キャンバスから離れない。** プレビュー内のリンク、フォーム送信、ルーター呼び出しでページが遷移することはありません。遷移先は通知で表示されます。
- **アイテム単体で開く。** どのアイテムも実寸のまま別タブで開けます。スクリーンショットやデザインツールへの取り込みにそのまま使えます。
- **静かな作業スペース。** 名前をドラッグしてアイテムを移動し、パン、ズーム、全体表示ができます。再読み込みしてもレイアウトは保たれます。

### 必要なもの

- macOS（インストーラーは bash、rsync、perl を使います）
- React アプリ。Next.js と Vite のアプリは、Tailwind や shadcn/ui も含めて自動で検出・設定されます。
- アプリに Vite が入っていること。入っていない場合は、エージェントが開発依存として追加してよいか確認します。Turbopack で Tailwind をビルドしている Next.js アプリには、`@tailwindcss/vite` も必要です。

### インストール

```sh
npx skills add charlie5188/design-canvas
```

あとはエージェントに、たとえばこう頼みます。

- 「料金カードのレイアウトを 3 案比較するキャンバスを作って」
- 「通知をグループ化した受信箱を、今のものの隣に追加して」
- 「設定ページをスマートフォンとデスクトップで並べて見せて」

### しくみ

- `skills/design-canvas/shell/`：React で書かれたキャンバス本体です。各キャンバスにコピーされ、エージェントが作り直すことはありません。
- `skills/design-canvas/kits/react-vite/`：アプリの隣に置かれる Vite のページです。アプリのエイリアス、スタイル、環境変数、Vite プラグインを再利用し、Next.js 専用のモジュールは代替品に置き換えます。
- `skills/design-canvas/scripts/install.sh`：本体とキットを `<app>/design-canvas/<name>/` にコピーし、検出できるものを自動で設定します。
- `skills/design-canvas/references/making-a-kit.md`：アプリへの設定を仕上げるためにエージェントが使うチェックリストです。仕上がった設定を `~/.agents/design-canvas-kits/` にプライベートキットとして保存し、次回からは設定なしでインストールする方法も書かれています。

キャンバスはプロトタイプです。共有したいときだけコミットしてください。

### 制限

- 本体は React です。ほかのフレームワークでは、エージェントが `shell/TESTING.md` を受け入れ基準として移植します。
- サーバーコンポーネント、サーバーアクション、サーバー側の秘密情報が必要なものは、キャンバス上で表示できません。代わりに、その下にあるクライアントコンポーネントをプレビューしてください。
- `viewport` フレームの上では、中ボタンでのパンとタッチのピンチ操作がキャンバスに届きません。

### クレジット

キャンバスのルールは、Julien Thibeaut 氏の [`create-canvas`](https://github.com/ibelick/ui-skills)（MIT）をもとにしています。

### ライセンス

MIT。[LICENSE](LICENSE) を参照してください。

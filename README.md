# design-canvas

English | [日本語](#日本語)

An agent skill that puts your React app's real components on a pannable, zoomable canvas, so you can explore and compare UI directions side by side by talking to your coding agent.

https://github.com/user-attachments/assets/17c66881-b26b-49ba-a14a-8474f4fbd824

Instead of asking the agent to build a canvas from scratch for every project, the skill installs a ready-made, tested canvas shell and fits it to your app. The agent only writes the items you want to compare.

## What you get

- **Real components, no backend.** Items render your app's own components with synthetic data, styles, and themes.
- **Know what can ship.** The agent builds versions from your components' props first, so they are product code already. A version that needs a new component says so on the canvas. When you ask to ship one, the agent moves it into the product and checks it in your running app.
- **Talk about what you see.** Click an item's name to copy it. Hold ⌥/Alt and click any element to copy a reference such as `Pricing card · compact › button “Upgrade”`, then paste it into the conversation.
- **Request many changes, send once.** Press A or the Request change button, then click an element, drag across an area, or click an item's name for the whole item, and write a note on each. Click a section's title to write one note about everything in it, such as "make one flow from these screens"; the message lists its items in the order you laid them out. Double-click a text to rewrite it where it sits; the new words stay on screen, underlined, so you can judge several rewrites together, and the edit becomes a note that says the old and new words. Send them all to the agent as one numbered message, straight from the canvas; each item and section in the message shows an "Agent working" tag, with a beam running around its border, until the agent finishes, and each pin clears itself once the agent has changed its item. Agents that can't listen in the background, such as ones without background commands, get the same message by copy and paste.
- **Explain it to whoever opens the file.** Add a sticker note anywhere on the canvas, or draw a folder-style section around the versions you set aside and give it a title. Move them, resize them, and edit their text like objects on any canvas. Each change waits as a dashed "Not applied yet" ghost, goes to the agent with your other annotations when you press Apply, and becomes part of the shared file once the agent has written it in. Moving an item works the same way, since the shared file uses the positions in your code.
- **New versions beside the original.** Each note asks for a new version by default, so the agent keeps the original and adds the change next to it, and you compare both. Uncheck it to change the item in place.
- **A trash you can undo.** Move a version you don't want to the trash. The trash shows small live previews, and one click puts an item back where it was. Its code stays until you ask the agent to remove it.
- **Real viewports.** Mark an item `viewport: true` and it renders in a frame of its own width, so breakpoints and media queries behave as on a real phone or desktop.
- **Your themes.** Light and dark (or any themes the app has) switch from the top right, across every item.
- **Stays on the canvas.** Links, form submits, and router calls inside previews never navigate away; they show where they would have gone.
- **One item alone.** Open any item in its own tab at its real size, ready for a screenshot or a design-tool import.
- **Share as one file.** Click Share at the top right, or ask the agent, to get one HTML file that anyone can open with a double-click, with no server or setup. Drag the file into Figma to get a code layer you can play full screen. Notes and sections come with it; annotations and sending to the agent stay out of the shared file.
- **A quiet workspace.** Drag items by their name, and they snap into line with the others. Pan, zoom, fit all, and reload without losing the layout. Figma's zoom keys work too: hold Z and click or drag, Shift + 0, 1, and 2.

## Compared with Claude Design, Paper, and Figma

[Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs), [Paper](https://paper.design), and [Figma's code layers](https://www.figma.com/blog/code-on-the-figma-canvas/) also bring AI and code onto a design canvas. They are design tools: the work lives in their files, you can edit it by hand, and changes reach your code through a handoff, a sync, or a push.

design-canvas has no design file. The canvas renders your app's real components from your repo, your coding agent writes each direction as code there, and the direction you keep is already in place.

| | design-canvas | Claude Design | Paper | Figma code layers (beta) |
|---|---|---|---|---|
| The work lives in | Your repo | Claude Design | Paper | Figma |
| The canvas shows | Your app's components, run by your dev server | Designs generated with your design system | HTML/CSS designs | React code that runs in Figma |
| Changes reach your code | Already there | Handoff to Claude Code | Your agent syncs through Paper's MCP server | Push to your repo |
| Edit by hand | No: describe changes to your agent | Yes | Yes | Yes |
| Edit together live | No: it runs on your machine | Yes | Yes | Yes |
| What you pay | Nothing extra: open source, uses your coding agent | Included in paid Claude plans (Pro, Max, Team, Enterprise), within a usage limit; extra usage is paid | [Free plan; Pro is $16 per editor per month billed yearly, $20 monthly](https://paper.design/pricing) | [Per-seat plans](https://www.figma.com/pricing/); code layers use [Figma AI credits](https://help.figma.com/hc/en-us/articles/33459875669015-How-Figma-AI-credits-work) |
| Limits on agent access | None: your agent edits your repo directly | The usage limit applies; work moves to Claude Code by handoff | MCP: 100 tool calls a week on Free, 1M a week on Pro | [MCP](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/): 20 tool calls a month on Starter or with a View or Collab seat; 200 a day with a Full or Dev seat (600 on Enterprise) |

Prices and limits are as of November 2026 and change often. Check each link for current terms.

**Use design-canvas** to compare clearly different directions for a product you already have, side by side with real components, real data, real screen widths, and your themes. The one you choose is already code.

**Use a design tool** to adjust details by hand, to start an idea that has no code yet, or to work in one file with your team.

## Requirements

- macOS (the installer uses bash, rsync, and perl).
- A React app. Next.js and Vite apps are detected and fitted automatically, including Tailwind and shadcn/ui.
- Vite in the app, or permission for the agent to add it as a dev dependency. Next.js apps that build Tailwind with Turbopack also need `@tailwindcss/vite`.

## Install

```sh
npx skills add charlie5188/design-canvas --skill '*'
```

This installs two skills. `design-canvas` builds the canvas. `design-directions` helps the agent make directions that are clearly different from each other, after it looks at how other products, and their help docs, solve the same job. The canvas works without it, but its directions are more likely to look alike.

Then ask your agent, for example:

- "Make a canvas comparing three layouts for the pricing card."
- "Add a version of the inbox with grouped notifications next to the current one."
- "Show the settings page on a phone and on desktop."

## Share a canvas

Click Share (the share icon) at the top right of the canvas, or ask the agent to share the canvas. You get one HTML file, `<canvas-name>-<date>.html`.

- **Open it.** Double-click the file. It runs in any browser, with no setup, server, or agent.
- **Send it.** Share it like any file, in Slack, email, or Drive.
- **Put it in Figma.** Drag the file onto a Figma canvas. It becomes a code layer: press play to use it, or play it full screen.
- **Put it in Notion.** Drag the file into a Notion page. It becomes an embedded web page that people can use right in the page.

The file is a snapshot, so share again after changes. It holds every item's data, so keep items on made-up data. Annotations and sending to the agent are not in the file.

## How it works

- `skills/design-canvas/shell/`: the canvas itself, in React. It is copied into each canvas and never rebuilt by the agent.
- `skills/design-canvas/kits/react-vite/`: a Vite page that sits beside your app, reuses its aliases, styles, environment, and Vite plugins, and swaps Next.js-only modules for stand-ins.
- `skills/design-canvas/scripts/install.sh`: copies the shell and kit into `<app>/design-canvas/<name>/` and detects what it can.
- `skills/design-canvas/scripts/update.sh`: brings an existing canvas's shell up to date with the skill. The agent runs it when it picks up a canvas, so older canvases get new features. Your items and kit settings stay as they are.
- `skills/design-canvas/scripts/share.sh`: builds a canvas into one self-contained HTML file in `<canvas>/shared/`, with every script, style, image, and font inside it, including files from the app's public folder. The toolbar's Share button builds the same file through the dev server and downloads it.
- `skills/design-canvas/scripts/check-version.sh`: when a canvas is installed or updated, reads the skill's version number from this repository on GitHub, and the agent tells you when a newer version is out. Set `DESIGN_CANVAS_NO_UPDATE_CHECK=1` to turn it off.
- `skills/design-canvas/references/making-a-kit.md`: the checklist the agent follows to finish fitting your app, and how to save that fit as a private kit in `~/.agents/design-canvas-kits/` so the next install needs none.
- `skills/design-directions/SKILL.md`: how the agent plans directions before it builds them. It looks at how a few real products solve the same job, keeps the product's design system fixed, gives each direction one bet in its structure, and reworks any two that look alike. Your own instructions about directions come first.

Canvases are prototypes. Commit one only when teammates need to change it; to let people try it, share it as a file.

## Limits

- The shell is React. For other frameworks, the agent ports it using `shell/TESTING.md` as the acceptance list.
- Server components, server actions, and anything that needs a server secret cannot render on the canvas; preview the client component beneath them instead.
- Inside `viewport` frames, middle-button pan and touch pinch do not reach the canvas.
- A shared file is a snapshot of the canvas. Files loaded by a path built at runtime, such as `/avatars/${id}.png`, are not inside it; import them in the item instead.

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
- **そのままリリースできる案がわかる。** エージェントはまず既存コンポーネントの props で案を作るので、その案はそのままプロダクトのコードです。新しいコンポーネントが必要な案は、キャンバス上にそう表示されます。案をプロダクトに入れるよう頼むと、エージェントが組み込み、実際のアプリで確認します。
- **見ているものをそのまま会話に。** アイテム名をクリックすると名前をコピーできます。⌥/Alt を押しながら要素をクリックすると、`Pricing card · compact › button “Upgrade”` のような参照をコピーでき、そのまま会話に貼り付けられます。
- **まとめて注釈して、一度で送信。** A キーか Request change ボタンで注釈モードにし、要素をクリックするか、範囲をドラッグで囲むか、アイテム名をクリックしてアイテム全体を選び、それぞれにメモを書きます。セクションのタイトルをクリックすると、中のアイテムすべてについて 1 つのメモを書けます（例：「この画面をつないで 1 つのフローにして」）。メッセージには、中のアイテムが並べた順に入ります。テキストをダブルクリックすると、その場で文言を書き換えられます。新しい文言は下線付きで画面に残るので、複数の書き換えをまとめて確かめられます。書き換えは、元の文言と新しい文言を示すメモになります。すべてを番号付きの 1 つのメッセージとして、キャンバスから直接エージェントに送れます。エージェントが作業を終えるまで、メッセージに含まれるアイテムとセクションには「Agent working」のタグが付き、枠に沿って光のビームが回ります。エージェントがそのアイテムを変更すると、ピンは自動で消えます。バックグラウンドで待機できないエージェント（バックグラウンドコマンドがないものなど）には、同じメッセージをコピーして貼り付けます。
- **開いた人に説明を添える。** 付箋のノートをキャンバスのどこにでも置いたり、見送った案をフォルダ型のセクションで囲んでタイトルを付けたりできます。移動、サイズ変更、文字の編集もできます。エージェントが反映するまでは「Not applied yet」の破線のゴーストとして残り、Apply を押すと他の注釈と一緒に送られます。エージェントが書き込むと、共有ファイルの一部になります。アイテムを動かした場合も同じです。共有ファイルはコード内の位置を使うためです。
- **新しい案は元の案の隣に。** 注釈は初期設定で新しい案を求めます。エージェントは元の案を残したまま変更を隣に追加するので、2 つを見比べられます。チェックを外すと、そのアイテム自体を変更します。
- **元に戻せるゴミ箱。** いらない案はゴミ箱に移せます。ゴミ箱では小さなライブプレビューが表示され、クリックすると元の位置に戻ります。コードは、エージェントに削除を頼むまで残ります。
- **本物のビューポート。** アイテムに `viewport: true` を指定すると、そのアイテムの幅を持つフレーム内で表示されます。ブレークポイントやメディアクエリが、実際のスマートフォンやデスクトップと同じように動きます。
- **アプリのテーマ。** ライト・ダーク（またはアプリが持つ任意のテーマ）を右上から切り替えられ、すべてのアイテムに反映されます。
- **キャンバスから離れない。** プレビュー内のリンク、フォーム送信、ルーター呼び出しでページが遷移することはありません。遷移先は通知で表示されます。
- **アイテム単体で開く。** どのアイテムも実寸のまま別タブで開けます。スクリーンショットやデザインツールへの取り込みにそのまま使えます。
- **1 つのファイルで共有。** 右上の Share をクリックするか、エージェントに頼むと、1 つの HTML ファイルができます。サーバーや準備は不要で、誰でもダブルクリックで開けます。Figma にドラッグすると、フルスクリーンで操作できるコードレイヤーになります。ノートとセクションは共有ファイルに含まれます。注釈とエージェントへの送信は含まれません。
- **静かな作業スペース。** 名前をドラッグしてアイテムを移動すると、ほかのアイテムと揃う位置に吸着します。パン、ズーム、全体表示もできます。再読み込みしてもレイアウトは保たれます。Figma と同じズーム操作も使えます（Z を押しながらクリックまたはドラッグ、Shift + 0・1・2）。

### Claude Design、Paper、Figma との違い

[Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs)、[Paper](https://paper.design)、[Figma のコードレイヤー](https://www.figma.com/blog/code-on-the-figma-canvas/)も、AI とコードをデザインキャンバスに取り込んでいます。これらはデザインツールです。作業はそれぞれのファイルの中にあり、手で編集でき、変更は受け渡し、同期、プッシュのいずれかでコードに届きます。

design-canvas にはデザインファイルがありません。キャンバスはリポジトリにあるアプリの実際のコンポーネントを表示し、コーディングエージェントが各方向性をそこにコードとして書きます。選んだ方向性は、最初からコードとして入っています。

| | design-canvas | Claude Design | Paper | Figma のコードレイヤー（ベータ） |
|---|---|---|---|---|
| 作業の置き場所 | あなたのリポジトリ | Claude Design | Paper | Figma |
| キャンバスに表示されるもの | 自分の開発サーバーで動く、アプリのコンポーネント | デザインシステムに沿って生成されたデザイン | HTML/CSS のデザイン | Figma の中で動く React のコード |
| 変更がコードに届く方法 | 最初からコードにある | Claude Code への受け渡し | エージェントが Paper の MCP サーバーで同期 | リポジトリへのプッシュ |
| 手で編集 | できない（エージェントに変更を伝える） | できる | できる | できる |
| チームで同時に編集 | できない（自分のマシンで動く） | できる | できる | できる |
| 費用 | 追加費用なし（オープンソース、今使っているコーディングエージェントを使う） | 有料の Claude プラン（Pro、Max、Team、Enterprise）に含まれ、利用量の上限あり。超える分は有料 | [無料プランあり。Pro は編集者 1 人あたり月 16 ドル（年払い）、月払いは 20 ドル](https://paper.design/pricing) | [席ごとの料金プラン](https://www.figma.com/pricing/)。コードレイヤーは [Figma AI クレジット](https://help.figma.com/hc/en-us/articles/33459875669015-How-Figma-AI-credits-work)を消費 |
| エージェントからのアクセス制限 | なし（エージェントがリポジトリを直接編集） | 利用量の上限が適用。作業は受け渡しで Claude Code へ | MCP：Free は週 100 回、Pro は週 100 万回のツール呼び出し | [MCP](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)：Starter プラン、または View・Collab 席は月 20 回。Full・Dev 席は 1 日 200 回（Enterprise は 600 回） |

料金と制限は 2026 年 11 月時点のもので、よく変わります。最新の条件は各リンク先で確認してください。

**design-canvas が向いているのは**、すでにあるプロダクトで、はっきり異なる方向性を比べるときです。実際のコンポーネント、実際のデータ、実際の画面幅、アプリのテーマで並べて比べられます。選んだものは、そのままコードとして残ります。

**デザインツールが向いているのは**、細部を手で調整するとき、まだコードがないアイデアを始めるとき、チームで 1 つのファイルを使って作業するときです。

### 必要なもの

- macOS（インストーラーは bash、rsync、perl を使います）
- React アプリ。Next.js と Vite のアプリは、Tailwind や shadcn/ui も含めて自動で検出・設定されます。
- アプリに Vite が入っていること。入っていない場合は、エージェントが開発依存として追加してよいか確認します。Turbopack で Tailwind をビルドしている Next.js アプリには、`@tailwindcss/vite` も必要です。

### インストール

```sh
npx skills add charlie5188/design-canvas --skill '*'
```

2 つのスキルが入ります。`design-canvas` はキャンバスを作ります。`design-directions` は、他の製品やそのヘルプ記事が同じ課題をどう解いているかを調べたうえで、互いにはっきり違う方向性をエージェントが作れるようにします。キャンバスはこれがなくても動きますが、方向性が似たものになりやすくなります。

あとはエージェントに、たとえばこう頼みます。

- 「料金カードのレイアウトを 3 案比較するキャンバスを作って」
- 「通知をグループ化した受信箱を、今のものの隣に追加して」
- 「設定ページをスマートフォンとデスクトップで並べて見せて」

### キャンバスを共有する

キャンバス右上の Share（共有アイコン）をクリックするか、エージェントに共有を頼みます。`<キャンバス名>-<日付>.html` という 1 つの HTML ファイルができます。

- **開く。** ファイルをダブルクリックします。準備、サーバー、エージェントなしで、どのブラウザでも動きます。
- **送る。** Slack、メール、Drive など、普通のファイルと同じように共有できます。
- **Figma に置く。** ファイルを Figma のキャンバスにドラッグすると、コードレイヤーになります。再生ボタンを押すと操作でき、フルスクリーンでも再生できます。
- **Notion に置く。** ファイルを Notion のページにドラッグすると、埋め込みのウェブページになり、ページの中でそのまま操作できます。

ファイルはその時点のスナップショットなので、変更したらもう一度共有してください。すべてのアイテムのデータが含まれるので、アイテムには架空のデータを使ってください。注釈とエージェントへの送信は含まれません。

### しくみ

- `skills/design-canvas/shell/`：React で書かれたキャンバス本体です。各キャンバスにコピーされ、エージェントが作り直すことはありません。
- `skills/design-canvas/kits/react-vite/`：アプリの隣に置かれる Vite のページです。アプリのエイリアス、スタイル、環境変数、Vite プラグインを再利用し、Next.js 専用のモジュールは代替品に置き換えます。
- `skills/design-canvas/scripts/install.sh`：本体とキットを `<app>/design-canvas/<name>/` にコピーし、検出できるものを自動で設定します。
- `skills/design-canvas/scripts/update.sh`：既存のキャンバスの本体を、スキルの最新版に更新します。エージェントが既存のキャンバスを使うときに実行するので、古いキャンバスにも新しい機能が入ります。アイテムとキットの設定はそのまま残ります。
- `skills/design-canvas/scripts/share.sh`：キャンバスを、スクリプト、スタイル、画像、フォント（アプリの public フォルダのファイルも含む）をすべて含む 1 つの HTML ファイルにして、`<canvas>/shared/` に保存します。ツールバーの Share ボタンは、開発サーバーで同じファイルを作ってダウンロードします。
- `skills/design-canvas/scripts/check-version.sh`：キャンバスのインストール時と更新時に、GitHub 上のこのリポジトリからスキルのバージョン番号を読み取ります。新しいバージョンが出ていれば、エージェントが知らせます。オフにするには `DESIGN_CANVAS_NO_UPDATE_CHECK=1` を設定します。
- `skills/design-canvas/references/making-a-kit.md`：アプリへの設定を仕上げるためにエージェントが使うチェックリストです。仕上がった設定を `~/.agents/design-canvas-kits/` にプライベートキットとして保存し、次回からは設定なしでインストールする方法も書かれています。
- `skills/design-directions/SKILL.md`：エージェントが方向性を作る前の進め方です。いくつかの実在する製品が同じ課題をどう解いているかを調べ、製品のデザインシステムは変えずに、各方向性に構造上の賭けを 1 つずつ持たせ、似すぎた 2 つは作り直します。方向性についてのユーザー自身の指示が優先されます。

キャンバスはプロトタイプです。チームメンバーが変更する必要があるときだけコミットしてください。試してもらうだけなら、ファイルとして共有できます。

### 制限

- 本体は React です。ほかのフレームワークでは、エージェントが `shell/TESTING.md` を受け入れ基準として移植します。
- サーバーコンポーネント、サーバーアクション、サーバー側の秘密情報が必要なものは、キャンバス上で表示できません。代わりに、その下にあるクライアントコンポーネントをプレビューしてください。
- `viewport` フレームの上では、中ボタンでのパンとタッチのピンチ操作がキャンバスに届きません。
- 共有ファイルは、その時点のキャンバスのスナップショットです。実行時に組み立てるパス（`/avatars/${id}.png` など）で読み込むファイルは含まれません。アイテム内で import してください。

### クレジット

キャンバスのルールは、Julien Thibeaut 氏の [`create-canvas`](https://github.com/ibelick/ui-skills)（MIT）をもとにしています。

### ライセンス

MIT。[LICENSE](LICENSE) を参照してください。

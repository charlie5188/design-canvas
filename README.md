# design-canvas

English | [日本語](#日本語)

An agent skill that puts your React app's real components on a pannable, zoomable canvas, so you can explore and compare UI directions side by side by talking to your coding agent.

https://github.com/user-attachments/assets/cdf83204-7091-470a-b9ef-4243571ff98e

Instead of asking the agent to build a canvas from scratch for every project, the skill installs a ready-made, tested canvas shell and fits it to your app. The agent only writes the items you want to compare.

## What you get

- **Your real components.** Each item is your app's own component, with its styles and themes, and made-up data in place of a backend. Ask for a phone or desktop width, and breakpoints behave as on the device.
- **Ask the agent where you are looking.** Press A, click an element, and write a change or a question. Send it, and the agent makes the change or answers on that pin, where you can reply. To ask about a whole item, use its Ask agent button. Quick requests fill in the note for you: show it at phone width, add its empty, loading, and error states, or show it in the other languages your app has.
- **See the whole flow.** One item can hold all the screens of a flow and the states of each screen. Click the count next to its name to see every screen side by side, live, with arrows that name the control that leads there, such as `click "Pay"`. Switch a screen's state in place, and ask about one screen, one element on it, or the whole flow.
- **Iterate fast, and the canvas keeps the process in order.** A change you ask for becomes a new version next to the original, so you compare both. Press Pick on the version you want, and the others move into a "Set aside" section, with your reasons kept as notes. New directions start as cards with a wireframe sketch, so you can look over several before any code is written, and build or drop each one from its card. A built direction is one screen at first; ask for the whole flow, states, or a phone version only on the ones you want to take further.
- **The one you pick is already code.** The agent builds versions from your components' props first. Ask it to ship one, and it moves that version into the product and checks it in your running app.
- **Share as one file.** Click Share to get one HTML file that opens with a double-click, and that you can put in Figma or Notion. With Claude, you can also share it as a link that people comment on. See [Share a canvas](#share-a-canvas).

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

**Use design-canvas** to compare clearly different directions for a product you already have, side by side with real components, real screen widths, and your themes. The one you choose is already code.

**Use a design tool** to adjust details by hand, to start an idea that has no code yet, or to work in one file with your team.

## Requirements

- macOS (the installer uses bash, rsync, and perl).
- A React app. Next.js and Vite apps are detected and fitted automatically, including Tailwind and shadcn/ui.
- Vite in the app, or permission for the agent to add it as a dev dependency. Next.js apps that build Tailwind with Turbopack also need `@tailwindcss/vite`.

## Install

```sh
npx skills add charlie5188/design-canvas --skill '*'
```

This installs two skills. `design-canvas` builds the canvas. `design-directions` helps the agent show the range of directions a designer would consider. It names the tradeoffs that matter for the screen, such as new user or expert, or AI or person, and makes each direction a different answer to one of them, after it looks at how other products, and their help docs, solve the same job. The canvas works without it, but its directions are more likely to look alike.

Then ask your agent, for example:

- "Make a canvas comparing three layouts for the pricing card."
- "Add a version of the inbox with grouped notifications next to the current one."
- "Show the settings page on a phone and on desktop."
- "Put the whole checkout flow in one item, with the card-declined state."

## Share a canvas

Click Share (the share icon) at the top right of the canvas, choose the whole canvas or one section, and click Download. Or ask the agent to share the canvas. You get one HTML file named for the canvas and the day. Your notes for the agent and the trash never go in.

- **Open it.** Double-click the file. It runs in any browser, with no setup, server, or agent.
- **Send it.** Share it like any file, in Slack, email, or Drive.
- **Put it in Figma.** Drag the file onto a Figma canvas. It becomes a code layer: press play to use it, or play it full screen.
- **Put it in Notion.** Drag the file into a Notion page. It becomes an embedded web page that people can use right in the page.
- **Get comments on a link (Claude).** If your agent is Claude, ask it to "publish the canvas as a link for comments". It publishes the same file as a private Claude Artifact. Share the link from the Artifact's Share menu, and reviewers comment on the page itself. Ask the agent to read the comments, or send a comment to Claude from its thread: the agent makes the change and updates the same link.

The file is a snapshot, so share again after changes. It holds every item's data, so keep items on made-up data. The Ask agent tool and its pins are not in the file.

## How it works

- `skills/design-canvas/shell/`: the canvas itself, in React. It is copied into each canvas and never rebuilt by the agent.
- `skills/design-canvas/kits/react-vite/`: a Vite page that sits beside your app, reuses its aliases, styles, environment, and Vite plugins, and swaps Next.js-only modules for stand-ins.
- `skills/design-canvas/scripts/install.sh`: copies the shell and kit into `<app>/design-canvas/<name>/` and detects what it can.
- `skills/design-canvas/scripts/update.sh`: brings an existing canvas's shell up to date with the skill. The agent runs it when it picks up a canvas, so older canvases get new features. Your items and kit settings stay as they are.
- `skills/design-canvas/scripts/share.sh`: builds a canvas into one self-contained HTML file in `<canvas>/shared/`, with every script, style, image, and font inside it, including files from the app's public folder. The toolbar's Share button builds the same file through the dev server and downloads it.
- `skills/design-canvas/scripts/listen.sh` and `reply.sh`: how your notes reach the agent and its answers come back. While the agent runs `listen.sh` in the background, the canvas's Send button delivers your notes to it, and the agent answers a question on its pin with `reply.sh`. When no agent listens, the button reads Copy, and you paste the notes into your agent. `listen-codex.mjs` does the same for Codex Desktop.
- `skills/design-canvas/scripts/remove.sh`: removes a canvas from the project.
- `skills/design-canvas/scripts/check-version.sh`: when a canvas is installed or updated, reads the skill's version number from this repository on GitHub, and the agent tells you when a newer version is out. Set `DESIGN_CANVAS_NO_UPDATE_CHECK=1` to turn it off.
- `skills/design-canvas/references/making-a-kit.md`: the checklist the agent follows to finish fitting your app, and how to save that fit as a private kit in `~/.agents/design-canvas-kits/` so the next install needs none.
- `skills/design-directions/SKILL.md`: how the agent plans directions before it builds them. It states the job and how to judge a result, chooses the tradeoffs that matter for the screen, and places each direction on one of them. It looks at how a few real products solve the same job, keeps the product's design system fixed, gives each direction one bet in its structure, and reworks any two that look alike. Your own instructions about directions come first.

Canvases are prototypes. Commit one only when teammates need to change it; to let people try it, share it as a file.

## Limits

- The shell is React. For other frameworks, the agent ports it using `shell/TESTING.md` as the acceptance list.
- Server components, server actions, and anything that needs a server secret cannot render on the canvas; preview the client component beneath them instead.
- Inside an item shown at a fixed screen width (a `viewport` item), middle-button pan and touch pinch do not reach the canvas.
- A shared file is a snapshot of the canvas. Files loaded by a path built at runtime, such as `/avatars/${id}.png`, are not inside it; import them in the item instead.
- In a flow, only the path decides which screen shows: query strings and hashes are ignored, `useParams()` is empty, and `window.open` and server redirects are not followed. A step that code makes, such as a router call in a click handler, gets its arrow in the flow view after you make that step once in the item.

## Credits

The canvas rules are adapted from [`create-canvas`](https://github.com/ibelick/ui-skills) by Julien Thibeaut (MIT).

The canvas's icons are from [Tabler Icons](https://tabler.io/icons) (MIT). The license text is in `skills/design-canvas/shell/icons.tsx`.

## License

MIT. See [LICENSE](LICENSE).

---

## 日本語

React アプリの実際のコンポーネントを、パン・ズームできるキャンバスに並べるエージェントスキルです。コーディングエージェントと会話しながら、UI の方向性を並べて検討・比較できます。

プロジェクトごとにキャンバスをゼロから作らせる代わりに、このスキルはテスト済みのキャンバス本体をインストールし、アプリに合わせて設定します。エージェントが書くのは、比較したいアイテムだけです。

### できること

- **本物のコンポーネント。** アイテムはアプリ自身のコンポーネントで、スタイルとテーマもアプリのままです。バックエンドの代わりに架空のデータを使います。スマートフォンやデスクトップの幅を頼むと、ブレークポイントが実機と同じように動きます。
- **見ている場所で、エージェントに頼む・聞く。** A キーを押して要素をクリックし、変更の依頼か質問を書いて送ります。エージェントは変更を加えるか、そのピンの上で答えます。同じピンで返信もできます。アイテム全体について聞くときは、そのアイテムの Ask agent ボタンを使います。クイックリクエストを押すと、スマートフォン幅での表示、空・読み込み中・エラーの状態の追加、アプリにあるほかの言語での表示を頼む文がノートに入ります。
- **フロー全体を見る。** 1 つのアイテムに、フローのすべての画面と、各画面の状態を持たせられます。名前の横の数をクリックすると、すべての画面が実際に動く状態で横に並び、画面どうしは矢印でつながります。矢印には `click "Pay"` のように、その画面へ進むための操作が書かれます。画面の状態はその場で切り替えられ、1 つの画面、画面上の要素、フロー全体のどれについてもエージェントに聞けます。
- **すばやく案を進められ、経過はキャンバスが整理する。** 変更を頼むと、元の案の隣に新しい案が追加され、2 つを見比べられます。採用したい案の Pick を押すと、ほかの案は「Set aside」セクションに移り、会話で伝えた理由はノートとして残ります。新しい方向性は、まずワイヤーフレームのスケッチ付きのカードとして並ぶので、コードを書く前にいくつもの案を見渡し、カードから 1 つずつ作るか外すかを決められます。作った方向性は最初は 1 画面だけです。フロー全体、状態、スマートフォン版は、先へ進めたい案にだけ頼みます。
- **選んだ案は、すでにコード。** エージェントはまず既存コンポーネントの props で案を作ります。プロダクトに入れるよう頼むと、エージェントが組み込み、実際のアプリで確認します。
- **1 つのファイルで共有。** Share をクリックすると、ダブルクリックで開ける 1 つの HTML ファイルができます。Figma や Notion にも置けます。Claude を使っている場合は、コメントできるリンクとしても共有できます。詳しくは[キャンバスを共有する](#キャンバスを共有する)を見てください。

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

**design-canvas が向いているのは**、すでにあるプロダクトで、はっきり異なる方向性を比べるときです。実際のコンポーネント、実際の画面幅、アプリのテーマで並べて比べられます。選んだものは、そのままコードとして残ります。

**デザインツールが向いているのは**、細部を手で調整するとき、まだコードがないアイデアを始めるとき、チームで 1 つのファイルを使って作業するときです。

### 必要なもの

- macOS（インストーラーは bash、rsync、perl を使います）
- React アプリ。Next.js と Vite のアプリは、Tailwind や shadcn/ui も含めて自動で検出・設定されます。
- アプリに Vite が入っていること。入っていない場合は、エージェントが開発依存として追加してよいか確認します。Turbopack で Tailwind をビルドしている Next.js アプリには、`@tailwindcss/vite` も必要です。

### インストール

```sh
npx skills add charlie5188/design-canvas --skill '*'
```

2 つのスキルが入ります。`design-canvas` はキャンバスを作ります。`design-directions` は、デザイナーなら検討する方向性の幅を見せます。初心者か熟練者か、AI か人か、といったその画面で大事なトレードオフを挙げ、他の製品やそのヘルプ記事が同じ課題をどう解いているかを調べたうえで、それぞれのトレードオフに違う答えを出す方向性をエージェントが作れるようにします。キャンバスはこれがなくても動きますが、方向性が似たものになりやすくなります。

あとはエージェントに、たとえばこう頼みます。

- 「料金カードのレイアウトを 3 案比較するキャンバスを作って」
- 「通知をグループ化した受信箱を、今のものの隣に追加して」
- 「設定ページをスマートフォンとデスクトップで並べて見せて」
- 「チェックアウトのフロー全体を 1 つのアイテムにまとめて。カードが拒否された状態も入れて」

### キャンバスを共有する

キャンバス右上の Share（共有アイコン）をクリックし、キャンバス全体か 1 つのセクションを選んで Download をクリックします。エージェントに共有を頼むこともできます。キャンバス名と日付が付いた 1 つの HTML ファイルができ、エージェントに送るノートとゴミ箱の中身は入りません。

- **開く。** ファイルをダブルクリックします。準備、サーバー、エージェントなしで、どのブラウザでも動きます。
- **送る。** Slack、メール、Drive など、普通のファイルと同じように共有できます。
- **Figma に置く。** ファイルを Figma のキャンバスにドラッグすると、コードレイヤーになります。再生ボタンを押すと操作でき、フルスクリーンでも再生できます。
- **Notion に置く。** ファイルを Notion のページにドラッグすると、埋め込みのウェブページになり、ページの中でそのまま操作できます。
- **リンクでコメントをもらう（Claude）。** エージェントが Claude の場合は、「キャンバスをコメント用のリンクとして公開して」と頼みます。同じファイルが非公開の Claude Artifact として公開されます。Artifact の共有メニューからリンクを共有すると、レビューする人がページ上に直接コメントできます。コメントを読むようエージェントに頼むか、コメントのスレッドから Claude に送ると、エージェントが変更を加えて同じリンクを更新します。

ファイルはその時点のスナップショットなので、変更したらもう一度共有してください。すべてのアイテムのデータが含まれるので、アイテムには架空のデータを使ってください。Ask agent ツールとそのピンは含まれません。

### しくみ

- `skills/design-canvas/shell/`：React で書かれたキャンバス本体です。各キャンバスにコピーされ、エージェントが作り直すことはありません。
- `skills/design-canvas/kits/react-vite/`：アプリの隣に置かれる Vite のページです。アプリのエイリアス、スタイル、環境変数、Vite プラグインを再利用し、Next.js 専用のモジュールは代替品に置き換えます。
- `skills/design-canvas/scripts/install.sh`：本体とキットを `<app>/design-canvas/<name>/` にコピーし、検出できるものを自動で設定します。
- `skills/design-canvas/scripts/update.sh`：既存のキャンバスの本体を、スキルの最新版に更新します。エージェントが既存のキャンバスを使うときに実行するので、古いキャンバスにも新しい機能が入ります。アイテムとキットの設定はそのまま残ります。
- `skills/design-canvas/scripts/share.sh`：キャンバスを、スクリプト、スタイル、画像、フォント（アプリの public フォルダのファイルも含む）をすべて含む 1 つの HTML ファイルにして、`<canvas>/shared/` に保存します。ツールバーの Share ボタンは、開発サーバーで同じファイルを作ってダウンロードします。
- `skills/design-canvas/scripts/listen.sh` と `reply.sh`：ノートがエージェントに届き、答えが戻ってくるしくみです。エージェントが `listen.sh` をバックグラウンドで動かしている間は、キャンバスの Send ボタンでノートがエージェントに直接届きます。質問への答えは、エージェントが `reply.sh` でそのピンに書きます。待ち受けているエージェントがいないときは、ボタンが Copy になるので、コピーしたノートをエージェントに貼り付けます。`listen-codex.mjs` は Codex Desktop 用の同じしくみです。
- `skills/design-canvas/scripts/remove.sh`：プロジェクトからキャンバスを取り除きます。
- `skills/design-canvas/scripts/check-version.sh`：キャンバスのインストール時と更新時に、GitHub 上のこのリポジトリからスキルのバージョン番号を読み取ります。新しいバージョンが出ていれば、エージェントが知らせます。オフにするには `DESIGN_CANVAS_NO_UPDATE_CHECK=1` を設定します。
- `skills/design-canvas/references/making-a-kit.md`：アプリへの設定を仕上げるためにエージェントが使うチェックリストです。仕上がった設定を `~/.agents/design-canvas-kits/` にプライベートキットとして保存し、次回からは設定なしでインストールする方法も書かれています。
- `skills/design-directions/SKILL.md`：エージェントが方向性を作る前の進め方です。画面の目的と結果の判断基準をはっきりさせ、その画面で大事なトレードオフを選んで、各方向性をそのどこかに置きます。いくつかの実在する製品が同じ課題をどう解いているかを調べ、製品のデザインシステムは変えずに、各方向性に構造上の賭けを 1 つずつ持たせ、似すぎた 2 つは作り直します。方向性についてのユーザー自身の指示が優先されます。

キャンバスはプロトタイプです。チームメンバーが変更する必要があるときだけコミットしてください。試してもらうだけなら、ファイルとして共有できます。

### 制限

- 本体は React です。ほかのフレームワークでは、エージェントが `shell/TESTING.md` を受け入れ基準として移植します。
- サーバーコンポーネント、サーバーアクション、サーバー側の秘密情報が必要なものは、キャンバス上で表示できません。代わりに、その下にあるクライアントコンポーネントをプレビューしてください。
- 画面幅を固定して表示するアイテム（`viewport` のアイテム）の上では、中ボタンでのパンとタッチのピンチ操作がキャンバスに届きません。
- 共有ファイルは、その時点のキャンバスのスナップショットです。実行時に組み立てるパス（`/avatars/${id}.png` など）で読み込むファイルは含まれません。アイテム内で import してください。
- フローでは、どの画面を表示するかはパスだけで決まります。クエリ文字列とハッシュは無視され、`useParams()` は空になり、`window.open` とサーバー側のリダイレクトはたどりません。クリック時のルーター呼び出しのようにコードで進む画面遷移は、アイテムの中で一度その操作をすると、フロービューに矢印が表示されます。

### クレジット

キャンバスのルールは、Julien Thibeaut 氏の [`create-canvas`](https://github.com/ibelick/ui-skills)（MIT）をもとにしています。

キャンバスのアイコンは [Tabler Icons](https://tabler.io/icons)（MIT）のものです。ライセンスの全文は `skills/design-canvas/shell/icons.tsx` にあります。

### ライセンス

MIT。[LICENSE](LICENSE) を参照してください。

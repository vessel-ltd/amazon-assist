# アイコン

領収書と月別カレンダーを組み合わせた、このプロジェクト用の画像です。Amazonのロゴ・スマイル・公式画像は使っていません。

- 生成元: `receipt-month-source.png`（透過PNG）。内蔵の画像生成ツールで生成し、同じツールで背景の乱れを修正。
- ストア用: `icon128.png`。128×128のキャンバスに96pxの図柄を置き、周囲は透過。
- 拡張用: `extension/icons/receipt-month16.png`、`receipt-month32.png`、`receipt-month48.png`、`receipt-month128.png`。
- 以前のアイコンは別名のまま保持。manifestは新しいアイコンを参照。

PNGのサイズ変換にはPillowを使います。生成元に対する描き直し・色の変更はせず、透明な余白の調整と縮小だけを行います。

```sh
python3 scripts/create-icon-assets.py
```

元画像を変更した場合は書き出し後の16px表示も目視確認します。参考: [Chromeのアイコンガイド](https://developer.chrome.com/docs/webstore/images)。

## 生成プロンプト

内蔵ツールを使用。透明背景を指定。

> Use case: logo-brand. Generate a single polished square app icon for a Japanese Chrome extension that collects a selected month's purchase receipts into one PDF. One large simple white receipt sheet with a clearly serrated bottom edge, integrated with a small recognizable monthly calendar tab with exactly two thick binder rings and a simple three-by-two grid of dots. The receipt is the main silhouette; the calendar is a small overlapping accent. Bold flat geometric forms, minimal detail, clean vector-like raster illustration, front view. Deep teal rounded-square tile behind the white receipt, warm golden-yellow calendar accent, consistent with a calm teal productivity app. Entire rounded tile fills about 88 percent of the square canvas and is centered; use a genuinely transparent margin outside the rounded tile. High contrast and generous strokes that remain legible at 16 px. No letters, no numerals, no text, no watermark, no Amazon logo, no shopping cart, no smile arrow, no gradients, no 3D, no scene or mockup. 1024 by 1024 square production icon.

背景の修正プロンプト（生成した画像を編集対象として指定）:

> Edit this app icon only to clean up defects for production. Preserve the centered rounded teal square tile, white receipt with serrated bottom, small golden-yellow calendar with two white binder rings and six dots, overall proportions and composition. Make the entire teal tile interior a completely uniform flat deep teal color, including the entire area to the right of the receipt. Remove the unwanted black/transparent blotch and all noisy pixels there; no holes, speckles, dithering, glow, gradient or texture anywhere inside the tile. White receipt and yellow calendar should be uniform flat fills with crisp smooth boundaries. Keep the transparent margin outside the rounded-square tile truly transparent. No new symbols, no text, no logo. Preserve transparency outside the tile only.

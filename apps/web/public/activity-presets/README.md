# Activity preset background assets

세 PNG는 사용자가 제공한 1672×941 레퍼런스를 built-in ImageGen의 image edit mode로 정리한 무문자 배경 플레이트다. 모두 1672×941, opaque PNG이며 Deck의 `slide.style.backgroundImage`에서 `stretch`로 사용한다.

## 공통 제외 항목

- text, number, QR code, barcode
- ORBIT logo 또는 다른 wordmark
- passcode dot
- icon, card, frame, divider 등 편집 가능한 UI

위 요소는 Deck text, shape, repository brand asset 또는 runtime element로 다시 구성한다.

## 생성 프롬프트

### `spotlight-background.png`

> Edit this exact 1672×941 (16:9) presentation screenshot into a clean reusable raster BACKGROUND PLATE for an editable slide template. Preserve the original framing, warm off-white luminous paper-like background, extremely subtle ivory/lime ambient glow, soft vignette, and refined minimal corporate mood. Remove and reconstruct the underlying background behind EVERY foreground item: all Korean and English text, every letter and number, QR code and its white card, ORBIT logo/wordmark, passcode dots, pill label, white passcode card, divider, lock icon, helper copy, bottom instruction, and colored accent line. The result must be an empty seamless background only, with generous clean space and no UI components. Do not add any new object. Absolutely no text, no typography, no letters, no numbers, no QR pattern, no barcode, no logo, no icon, no watermark, no card, no frame, no divider, no passcode dots. Keep the exact 16:9 canvas and match the source palette and subtle texture.

### `split-background.png`

> Edit this exact 1672×941 (16:9) presentation screenshot into a clean reusable raster BACKGROUND PLATE for an editable slide template. Preserve the exact vertical split: warm off-white luminous paper-like left field and deep charcoal/navy-black right field, including the source's subtle texture, soft vignette, and restrained lower-left pale lime glow with thin orbital curve and small lime node. Remove and reconstruct the background behind EVERY foreground item: all Korean and English text, every letter and number, QR code and white QR card, passcode dots, passcode label, dark passcode card, and all other UI. The result must contain only the two background fields and the abstract lower-left glow/orbit decoration. Do not add any new object. Absolutely no text, no typography, no letters, no numbers, no QR pattern, no barcode, no logo, no icon, no watermark, no card, no frame, no UI. Keep the exact 16:9 canvas, the split position, palette, and subtle material quality.

### `editorial-background.png`

> Edit this exact 1672×941 (16:9) presentation screenshot into a clean reusable raster BACKGROUND PLATE for an editable slide template. Preserve the original warm off-white luminous paper-like main field, subtle texture and vignette, the large cropped translucent pale-lime orbital halo in the top-right, and the full-width vivid lime/yellow-green bottom band with its original soft glow and material quality. Remove and reconstruct the underlying background behind EVERY foreground item: all Korean and English text, every letter and number, the QR code, both white cards, passcode dots and label, ORBIT logo/wordmark, footer chat and clock icons, separators, and all UI. The result must be an empty seamless background only with the top-right abstract halo and bottom color band. Do not add any new object. Absolutely no text, no typography, no letters, no numbers, no QR pattern, no barcode, no logo, no icon, no watermark, no card, no frame, no divider, no UI. Keep the exact 16:9 canvas and match the source palette, lighting, and restrained premium presentation style.

## 브랜드 자산

`/brand/orbit-logo.png`는 생성 이미지가 아니라 저장소의 `apps/web/src/features/mockups/assets/orbit-logo-selected.png`를 그대로 복제한 public runtime asset이다.

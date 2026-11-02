# pet — 인형 강아지·고양이 (D&C 허브 것을 그대로 복사)

원본은 개인 저장소 `C:\swbins2\tools\macro-hub\web\` 의 `pets.js`·`petwarp.js`·`pets.css`·`pettok.js` 와 `skins\plush\`.
`pettok.js`(펫 × Claude Code 토큰 사용량 판정)는 PC 메신저만 쓴다 — 폰 페이지는 PC 기록에 닿을 길이 없어 넣지 않는다.
그림은 그 PC 에서 AI(SDXL)로 만든 것이라 공개해도 된다(`skin/plush/LICENSE.txt`).
원본이 바뀌면 다시 복사한다:

```
cp C:/swbins2/tools/macro-hub/web/{pets.js,petwarp.js,pets.css,pettok.js} pet/
cp C:/swbins2/tools/macro-hub/web/skins/plush/{*.webp,skin.json,LICENSE.txt} pet/skin/plush/
```

폰 페이지는 GitHub Pages 하위 경로라 `PetSkin.BASE = 'pet/'` 로 그림 경로를 바꿔 쓴다.

# pet — 인형 강아지·고양이 (D&C 허브 것을 그대로 복사)

원본은 개인 저장소 `C:\swbins2\tools\macro-hub\web\` 의 `pets.js`·`petwarp.js`·`pets.css`·`pettok.js` 와 `skins\plush\`.
`pettok.js`(펫 × Claude Code 토큰 사용량 판정)는 PC 메신저만 쓴다 — 폰 페이지는 PC 기록에 닿을 길이 없어 넣지 않는다.
그림은 그 PC 에서 AI(SDXL)로 만든 것이라 공개해도 된다(`skin/plush/LICENSE.txt`).
원본이 바뀌면 다시 복사한다:

```
cp C:/swbins2/tools/macro-hub/web/{pets.js,petwarp.js,pets.css,pettok.js} pet/
cp C:/swbins2/tools/macro-hub/web/skins/plush/{dog-*.webp,cat-*.webp,acc-*.webp,panda.webp,LICENSE.txt} pet/skin/plush/
```

**`*.webp`·`skin.json` 을 통째로 복사하지 말 것.** 원본에는 남의 저작물 캐릭터(맹수·공룡·드래곤이 아닌 `group` 묶음) 그림·항목이
있는데 저작권 때문에 이 공개 저장소엔 넣지 않는다. `wild-*.webp` 는 직접 만든 맹수·공룡·드래곤 34종만 골라 복사하고,
skin.json 은 원본 줄 그대로에서 진짜 캐릭터 품종 블록만 빼서 넣는다(묶음 없는 품종 + 맹수·공룡·드래곤).

폰 페이지는 GitHub Pages 하위 경로라 `PetSkin.BASE = 'pet/'` 로 그림 경로를 바꿔 쓴다.

# Chrome 应用商店上架资料

按 [Chrome 应用商店开发者后台](https://chrome.google.com/webstore/devconsole) 的栏目顺序整理，可以直接复制。

## 0. 打包

```sh
npm run build
npm run crx
```

上传 `build/novelai-zh-tags-版本.zip`（不含公钥的商店版）。商店会给扩展分配新的 ID，和本地「加载已解压的扩展程序」时的 ID 不同。

## 1. 商品详情（Store listing）

名称和摘要来自 manifest（`scripts/crx.mjs` 里的 `EXT_NAME`、`EXT_DESCRIPTION`），上传后自动填好：

- 名称：NovelAI中文化助手
- 摘要：用中文畅玩 NovelAI：输入中文就能找到对应的英文标签，英文标签也附上中文释义，界面和教程都能切换成中文。非官方扩展，与 NovelAI 及其开发商 Anlatan 无关。

**说明（中文）**

```
NovelAI中文化助手，让中文用户用起 NovelAI 更顺手。
本扩展为非官方扩展，与 NovelAI 及其开发商 Anlatan 无关。

✦ 用中文找标签
在生图提示词框里直接打中文，比如「黑丝」「猫耳」「七分身」，就会联想出对应的英文标签，点一下或按回车即可插入。繁体中文也能识别。

✦ 看懂英文标签
输入英文时，NovelAI 自带的联想列表里每一项下面都会多一行中文释义，不用再一个个查词典。

✦ 整个界面换成中文
在左侧菜单最下方的语言选单里选 ZH，或在「用户设置 → 界面 → 界面语言」里选「中文」，按钮、设置、提示以及生图和写作教程都会变成中文。账号里保存的语言仍是英文，不影响你在其他设备上使用。

✦ 自动修正中文标点
中文输入法打出的全角逗号、冒号会自动换成半角，避免几个标签被当成一个。

说明
· 不收集个人信息。约 7.5 万条标签词典随扩展打包，联想和翻译都在本地完成。
· 社区译名：人人都能在 https://novelai.000.moe 用 GitHub 登录后修改标签译名，修改直接提交到 GitHub 仓库，扩展默认每天从 GitHub 更新一次（只下载译名数据，不上传任何内容）。
· 点工具栏图标打开面板，查看版本和词条数，开关中文界面、中文标签和社区译名的自动更新（可选检查间隔）。
· 词典以 ame-la/danbooru-tags-data-zh（MIT）为基础并经过审定，补充检索词含 EhTagTranslation 的人工译名（CC BY-NC-SA 3.0），因此词典部分同样按 CC BY-NC-SA 3.0 提供，不得用于商业用途。
· 源代码和问题反馈：https://github.com/TomorrowX6/NovelAI-CN
```

**说明（English，可作为第二种语言添加）**

```
NovelAI中文化助手 makes NovelAI comfortable to use in Chinese.
This is an unofficial extension, not affiliated with NovelAI or its developer Anlatan.

✦ Find tags in Chinese
Type Chinese in the image prompt box (e.g. 黑丝, 猫耳) and get the matching English Danbooru tags as suggestions; click or press Enter to insert. Traditional Chinese works too.

✦ Understand English tags
When you type in English, every item in NovelAI's own suggestion list gets a line of Chinese explanation.

✦ Chinese interface
Pick ZH in the language selector at the bottom of the side menu, or 中文 in User Settings → Interface. Buttons, settings, tips and the image and story tutorials turn Chinese. Your account keeps English as its saved language, so other devices are unaffected.

✦ Punctuation fix
Full-width commas and colons typed by Chinese input methods are converted to half-width, so tags are separated correctly.

Notes
· Collects no personal data. The ~75,000-entry dictionary is bundled and suggestions and translation run locally.
· Community translations: anyone can edit tag translations at https://novelai.000.moe after signing in with GitHub; edits are committed to the GitHub repository and the extension picks them up once a day by default (it only downloads the translation list and uploads nothing).
· Click the toolbar icon for a popup with the version and entry counts and settings for the Chinese UI, Chinese tags and automatic updates of community translations.
· The dictionary is based on ame-la/danbooru-tags-data-zh (MIT) and includes search terms from EhTagTranslation (CC BY-NC-SA 3.0), so the dictionary is provided under CC BY-NC-SA 3.0 and may not be used commercially.
· Source and issues: https://github.com/TomorrowX6/NovelAI-CN
```

- 类别：艺术与设计（Art & Design）；列表里没有的话选「工具」（Tools）
- 语言：中文（简体）
- 商店图标：扩展包里的 `icons/128.png`，后台会自动取用
- 屏幕截图（1280×800，最多 5 张）：`screenshot-1-ui.png`、`screenshot-2-popup.png`（扩展面板的首页和设置）、`screenshot-3-tags.png`（输入「猫娘」时的中文标签联想）、`screenshot-4-english.png`（输入「cat ea」时英文联想附中文）
- 小型宣传图块（440×280，必填）：`promo-small-440x280.png`
- 顶部宣传图块（1400×560，可选）：`promo-marquee-1400x560.png`
- 官方网址：不填（没有已验证的网站）；首页网址：https://github.com/TomorrowX6/NovelAI-CN ；支持网址：https://github.com/TomorrowX6/NovelAI-CN/issues

## 2. 隐私权（Privacy practices）

**单一用途**

```
为 NovelAI 网站（novelai.net）提供中文支持：用中文联想英文提示词标签、为英文标签显示中文释义，并把网站界面翻译成中文。
Provides Chinese language support for novelai.net: Chinese input for English prompt tags, Chinese explanations for English tags, and a Chinese translation of the site's interface.
```

**主机权限理由**（manifest 里是内容脚本的匹配网址 `https://novelai.net/*`，另有下面的 `storage` 权限）

```
The content scripts run only on https://novelai.net/*, the site this extension localizes. The main script runs at document_start in the page's main world because it has to be in place before NovelAI's own scripts load: it answers NovelAI's tag-suggestion requests for Chinese input from the bundled dictionary (by wrapping the page's fetch) and adds Chinese to NovelAI's built-in UI localization. A second, isolated content script lets the toolbar popup read and change the extension's settings, which are kept in novelai.net's localStorage. Besides novelai.net, the page script only downloads a public text file of community tag translations from the project's GitHub repository (raw.githubusercontent.com), automatically once a day by default (the user can choose 1 hour to 7 days or turn it off) and when the user clicks the update button, without cookies and without sending any user data.
```

**storage 权限理由**

```
The popup keeps a copy of the extension's settings (Chinese UI, Chinese tags, automatic update and its interval) in chrome.storage.local, so they can be shown and changed while no NovelAI tab is open. Changes made that way are applied to novelai.net the next time a NovelAI page loads. Nothing else is stored and nothing leaves the browser.
```

**远程代码**：选「否，我没有使用远程代码」。所有脚本都在扩展包里；从 GitHub 下载的社区译名是文本数据，只当文字显示，不会执行。

**数据使用**：所有数据类型都不勾选（下载社区译名的请求不带任何用户数据），然后勾选下面三项保证声明（不出售给第三方、不用于与单一用途无关的目的、不用于判断信用或借贷）。

**隐私权政策网址**：https://github.com/TomorrowX6/NovelAI-CN/blob/main/PRIVACY.md

## 3. 分发（Distribution）

- 付费：免费
- 公开范围：公开，或「不公开」（只有拿到链接的人能安装）
- 地区：所有地区

## 4. 测试说明（Test instructions，给审核人员看）

```
No account is needed to check the interface translation:
1. Open https://novelai.net/image and close the sign-up dialog.
2. Open the menu (☰, top left). At the bottom, choose "ZH" in the language selector. The interface switches to Chinese.
3. In the menu, click 教程 (Tutorial) to see the translated tutorial.

Tag suggestions need a NovelAI account, because NovelAI does not request suggestions when logged out. After logging in, type 黑丝 in the prompt box: English tag suggestions such as "black thighhighs" appear with Chinese labels. Typing English (e.g. "cat") shows NovelAI's own suggestions with a Chinese line under each item.
```

## 标签联想截图

NovelAI 未登录时不会请求联想，要登录后拍，浏览器窗口内容区调到 1280×800（或截图后缩放到这个尺寸）：

1. 清空提示词框后输入「猫娘」，联想面板出现时截图（已拍：`screenshot-3-tags.png`）。
2. 清空后输入「cat ea」，NovelAI 自带的联想每项下有中文时截图（已拍：`screenshot-4-english.png`）。

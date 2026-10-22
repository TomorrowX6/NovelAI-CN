# 隐私政策 / Privacy Policy

适用于用户脚本「NovelAI 中文标签联想」和 Chrome 扩展「NovelAI中文化助手」。

## 不收集个人信息

- 不收集、不保存、不上传任何个人信息或使用数据，没有统计、分析或广告代码。
- 标签词典和界面译文已经打包在扩展里，联想、翻译都在你的浏览器里完成，运行时不下载任何代码。

## 社区译名

- 打开 NovelAI 页面时，脚本每 3 小时从 `https://novelai.000.moe/api/overrides` 下载一次社区审核过的标签译名。这是一份公开的 JSON 列表，只有英文标签、中文译名和检索词，不是代码；下载后存在浏览器的 localStorage 里。
- 这个请求不带 Cookie、不带来源页面，也不上传任何内容。和访问任何网站一样，平台所在的 Cloudflare 会看到你的 IP 地址，平台本身不记录它。
- 在扩展面板里关掉「中文标签」后不再下载。
- 在 <https://novelai.000.moe> 提交译名是自愿的。平台保存你提交的标签、译名、检索词和说明，以及加盐哈希后的 IP（只用来限制提交频率），不保存 IP 本身。

## 扩展面板

扩展面板里的「中文界面」「中文标签」开关存在 novelai.net 的 localStorage 里，只在你的浏览器中。

## 在 novelai.net 页面上做的事

脚本只在 `https://novelai.net/` 的页面上运行，会：

- 拦截 NovelAI 网页发出的标签联想请求：含中文的输入由本地词典直接回答，不会发出这次请求；其他请求原样交给 NovelAI。
- 在网页上显示中文：替换界面文字、在英文联想下方补充中文释义、把提示词里的全角逗号和冒号换成半角。
- 选择中文界面时，网页向 NovelAI 保存账号设置的请求里，界面语言 `zh` 会改成 `en`（NovelAI 只接受 en 和 jp），并在浏览器的 localStorage 里记下你选的是中文；网页读取账号数据时，再把界面语言换回 `zh`。账号数据的其他内容原样交回网页，不会被保存或改动。

这些请求本来就由 NovelAI 网页发往 NovelAI 的服务器，脚本不会把其中任何内容发往别处，包括社区译名平台。

## 联系

问题和反馈请在 <https://github.com/TomorrowX6/NovelAI-CN/issues> 提出。

---

This policy covers the userscript "NovelAI 中文标签联想" and the Chrome extension "NovelAI中文化助手".

**No personal data is collected.** The extension does not collect, store or transmit any personal or usage data and contains no analytics or advertising code. The tag dictionary and UI translations are bundled, and no code is downloaded at runtime.

**Community translations.** While a NovelAI page is open, the script downloads the community-reviewed tag translations from `https://novelai.000.moe/api/overrides` at most once every 3 hours. It is a public JSON list of English tags, Chinese labels and search terms (data, not code), kept in the browser's localStorage. The request carries no cookies, no referrer and no user data; like any web request it reveals your IP address to Cloudflare, which hosts the service, and the service does not log it. Turning off "中文标签" in the extension popup stops the download. Submitting translations at <https://novelai.000.moe> is voluntary; the service stores the submitted tag, label, search terms and note, plus a salted hash of the IP address for rate limiting, never the IP address itself. The popup's two switches are stored in novelai.net's localStorage in your browser.

**What it does on novelai.net.** It runs only on `https://novelai.net/` pages. It answers NovelAI's tag-suggestion requests for Chinese input from the bundled dictionary (other requests pass through unchanged), shows Chinese text on the page, and converts full-width commas and colons in the prompt. When the Chinese UI is selected, it changes the UI language `zh` to `en` in the settings that the page saves to NovelAI (NovelAI only accepts en and jp) and remembers the choice in the browser's localStorage; when the page loads account data, it changes `en` back to `zh`. The rest of the account data is passed back to the page unchanged and is never stored. These requests are made by the NovelAI page to NovelAI's own servers, and nothing from them is sent anywhere else, including the community translation service.

Contact: <https://github.com/TomorrowX6/NovelAI-CN/issues>

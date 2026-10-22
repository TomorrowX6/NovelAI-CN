# 隐私政策 / Privacy Policy

适用于用户脚本「NovelAI 中文标签联想」和 Chrome 扩展「NovelAI中文化助手」。

## 不收集任何数据

- 不收集、不保存、不上传任何个人信息或使用数据，没有统计、分析或广告代码，也不向开发者或任何第三方发送数据。
- 所有功能都在你的浏览器里完成。标签词典和界面译文已经打包在扩展里，运行时不下载任何代码或数据。

## 在 novelai.net 页面上做的事

脚本只在 `https://novelai.net/` 的页面上运行，会：

- 拦截 NovelAI 网页发出的标签联想请求：含中文的输入由本地词典直接回答，不会发出这次请求；其他请求原样交给 NovelAI。
- 在网页上显示中文：替换界面文字、在英文联想下方补充中文释义、把提示词里的全角逗号和冒号换成半角。
- 选择中文界面时，网页向 NovelAI 保存账号设置的请求里，界面语言 `zh` 会改成 `en`（NovelAI 只接受 en 和 jp），并在浏览器的 localStorage 里记下你选的是中文；网页读取账号数据时，再把界面语言换回 `zh`。账号数据的其他内容原样交回网页，不会被保存或改动。

这些请求本来就由 NovelAI 网页发往 NovelAI 的服务器，脚本不会把其中任何内容发往别处。

## 联系

问题和反馈请在 <https://github.com/TomorrowX6/NovelAI-CN/issues> 提出。

---

This policy covers the userscript "NovelAI 中文标签联想" and the Chrome extension "NovelAI中文化助手".

**No data is collected.** The extension does not collect, store or transmit any personal or usage data, contains no analytics or advertising code, and sends nothing to the developer or any third party. The tag dictionary and UI translations are bundled; no code or data is downloaded at runtime.

**What it does on novelai.net.** It runs only on `https://novelai.net/` pages. It answers NovelAI's tag-suggestion requests for Chinese input from the bundled dictionary (other requests pass through unchanged), shows Chinese text on the page, and converts full-width commas and colons in the prompt. When the Chinese UI is selected, it changes the UI language `zh` to `en` in the settings that the page saves to NovelAI (NovelAI only accepts en and jp) and remembers the choice in the browser's localStorage; when the page loads account data, it changes `en` back to `zh`. The rest of the account data is passed back to the page unchanged and is never stored. These requests are made by the NovelAI page to NovelAI's own servers, and nothing from them is sent anywhere else.

Contact: <https://github.com/TomorrowX6/NovelAI-CN/issues>

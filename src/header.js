// ==UserScript==
// @name         NovelAI 中文标签联想
// @namespace    novelai-zh-tags
// @version      {{version}}
// @description  NovelAI 生图提示词框：输入中文联想英文标签，英文联想结果附中文释义，全角逗号、冒号自动转半角；界面语言可选中文
// @match        https://novelai.net/*
// @updateURL    https://raw.githubusercontent.com/TomorrowX6/NovelAI-Tag/main/dist/novelai-zh-tags.meta.js
// @downloadURL  https://raw.githubusercontent.com/TomorrowX6/NovelAI-Tag/main/dist/novelai-zh-tags.user.js
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// ==/UserScript==

// 内嵌词典来源：ame-la/danbooru-tags-data-zh（MIT）、EhTagTranslation/Database（CC BY-NC-SA 3.0）、
// byzod/a1111-sd-webui-tagcomplete-CN（MIT）、DominikDoom/a1111-sd-webui-tagcomplete（MIT），
// 繁简对照来自 BYVoid/OpenCC（Apache-2.0）。
// 词典含 EhTagTranslation 派生内容，按 CC BY-NC-SA 3.0 提供：转发需署名，不得商用，修改后须以相同许可发布。

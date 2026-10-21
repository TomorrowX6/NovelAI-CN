// ==UserScript==
// @name         NovelAI 中文标签联想
// @namespace    novelai-zh-tags
// @version      {{version}}
// @description  NovelAI 生图提示词框：输入中文联想英文标签，英文联想结果附中文释义，全角逗号自动转半角
// @match        https://novelai.net/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// ==/UserScript==

// 内嵌词典来源：ame-la/danbooru-tags-data-zh（MIT）、EhTagTranslation/Database（CC BY-NC-SA 3.0）、
// byzod/a1111-sd-webui-tagcomplete-CN（MIT）、DominikDoom/a1111-sd-webui-tagcomplete（MIT）。
// 词典含 EhTagTranslation 派生内容，按 CC BY-NC-SA 3.0 提供：转发需署名，不得商用，修改后须以相同许可发布。

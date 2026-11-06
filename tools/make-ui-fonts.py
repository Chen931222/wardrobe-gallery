"""把站上用得到的字做成兩個小字型檔 src/fonts/ui-body-500.woff2、ui-title-700.woff2(2026-11-06)。
放 src 不放 public:打包後檔名帶雜湊,才吃得到 /assets/ 的長快取和 Service Worker。
原因:完整字型切成 100 多個切片,第一次打開要載 20 幾個(慢 4G 字型 7 秒才齊)。小檔一次載完,切片只補罕見字。

  npm run build && python tools/make-ui-fonts.py && npm run build

內文字取自打包後的 JS(註解已經不見,剩下的就是畫面上的字)加上示範衣櫃的品名;標題字取自 tools/ui-title-text.txt 加上品名。
字型是 @fontsource 的 Noto Sans TC 500、Noto Serif TC 700(SIL OFL 1.1,可以裁切,授權頁已列)。改了畫面文字要重跑,沒跑也不會壞:小檔沒有的字走切片。
"""
import glob
import json
import os
import re
import tempfile

from fontTools.merge import Merger
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def demo_names():
    for path in [f"{ROOT}/wardrobe-gallery/data/wardrobe.json", f"{ROOT}/dist/data/wardrobe.json"]:
        if os.path.exists(path):
            data = json.load(open(path, encoding="utf-8"))
            items = data if isinstance(data, list) else data.get("items", [])
            return "".join(str(x.get("name", "")) for x in items)
    return ""


def bundle_text():
    text = ""
    for path in glob.glob(f"{ROOT}/dist/assets/index-*.js"):
        text += open(path, encoding="utf-8").read()
    return "".join(re.findall(r"[ -⁯　-〿㐀-鿿＀-￯]", text))


ASCII = "".join(chr(c) for c in range(0x20, 0x7f)) + "°·…"


def build(family, weight, text, out):
    want = {ord(c) for c in text}
    options = Options()
    options.layout_features = []
    options.hinting = False
    options.desubroutinize = True
    options.notdef_outline = True
    options.name_IDs = [1, 2, 3, 4, 6, 13]   # 13 是授權說明
    paths = []
    missing = set(want)
    with tempfile.TemporaryDirectory() as tmp:
        for i, path in enumerate(sorted(glob.glob(f"{ROOT}/node_modules/@fontsource/{family}/files/*-{weight}-normal.woff2"))):
            if "-latin-ext-" in path or "-vietnamese-" in path or "-cyrillic-" in path:
                continue
            font = TTFont(path)
            have = set(font.getBestCmap())
            hit = have & missing
            if not hit:
                continue
            subsetter = Subsetter(options)
            subsetter.populate(unicodes=sorted(hit))
            subsetter.subset(font)
            font.flavor = None
            target = os.path.join(tmp, f"{i}.ttf")
            font.save(target)
            paths.append(target)
            missing -= hit
        merged = Merger().merge(paths)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        merged.flavor = "woff2"
        merged.save(out)
    print(f"{os.path.basename(out)}: {len(want - missing)} 字, {os.path.getsize(out) // 1024} KB, 找不到 {len(missing)}")


names = demo_names()
title = open(f"{ROOT}/tools/ui-title-text.txt", encoding="utf-8").read()
updates = open(f"{ROOT}/src/updates.js", encoding="utf-8").read()
title += "".join(re.findall(r'^\s*title: "(.*)",', updates, re.M)[:3])   # 更新紀錄只收最新三則,舊的往下捲才看到,走切片
build("noto-sans-tc", 500, ASCII + bundle_text() + names, f"{ROOT}/src/fonts/ui-body-500.woff2")
build("noto-serif-tc", 700, ASCII + title + names, f"{ROOT}/src/fonts/ui-title-700.woff2")

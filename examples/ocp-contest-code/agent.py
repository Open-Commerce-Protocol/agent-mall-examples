"""校雠 Agent — 文献学驱动的文化品版本推荐与下单

演示 OCP 三支柱完整流程：
  Discovery  → 查询 Catalog Node，发现古籍/字帖的所有版本
  Intention  → 理解"给谁买、什么场景、什么预算"，用版本学/碑帖学知识筛选
  Deal       → resolve → mock 下单完成

核心创新：「交易即教育」——每次推荐附带文化注释，买的不只是商品，是知识判断。

运行（先启动 server.py）：
  python agent.py

示例输入：
  帮我选本楚辞给初中孩子读
  我想买论语，预算50以内，大学用
  诗经选一本学术研究的
  字帖入门选哪个
  多宝塔碑进阶临摹
  曹全碑专业收藏
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request

# Windows 终端默认 GBK 编码，¥ 和 ★ 等字符会报错，强制 UTF-8
sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

BASE_URL = "http://localhost:4401"

# ============================================================
#  品类与关键词映射
# ============================================================

PRODUCT_KEYWORDS = {
    "古籍": {
        "楚辞": ["楚辞", "离骚", "九歌", "天问"],
        "论语": ["论语", "孔子", "儒家经典"],
        "诗经": ["诗经", "毛诗", "三百篇"],
        "庄子": ["庄子", "庄周", "南华经", "南华真经"],
        "唐诗三百首": ["唐诗三百首", "唐诗300首", "唐诗"],
    },
    "字帖": {
        "多宝塔碑": ["多宝塔", "多宝塔碑"],
        "曹全碑": ["曹全", "曹全碑"],
        "字帖": ["字帖", "碑帖", "书法", "临帖"],
    },
}

# 古籍受众关键词（顺序决定优先级：先精确后泛化）
BOOK_AUDIENCE_KEYWORDS = {
    "学术": ["学术", "研究", "论文", "硕博", "博士", "硕士"],
    "大学": ["大学", "考研", "考公", "公务员", "通识"],
    "中学": ["初中", "高中", "中学", "青少年", "少年"],
    "少儿": ["小学", "少儿", "孩子", "幼儿", "儿童", "小孩", "启蒙"],
    "大众": ["自己", "日常", "随便", "入门", "大众", "普通"],
}

# 字帖受众关键词
COPYBOOK_AUDIENCE_KEYWORDS = {
    "专业": ["专业", "收藏", "研究"],
    "进阶": ["进阶", "提高", "提升", "有基础", "临摹"],
    "入门": ["入门", "零基础", "初学", "开始学", "描红"],
    "大众": ["自己", "日常", "随便", "大众", "普通", "装饰"],
}

# ============================================================
#  版本学/碑帖学决策标准（DH 核心知识编码）
# ============================================================

AUDIENCE_CRITERIA = {
    # ---- 古籍 ----
    "少儿": {
        "desc": "小学及以下，需要拼音、图画、故事性",
        "min_readability": 5,
        "min_scholarly": 1,
        "preferred_styles": ["彩图普及", "漫画"],
        "reason": "少儿读物以激发兴趣为主，需图注和故事化呈现，不要求底本精审。",
    },
    "中学": {
        "desc": "初高中学生，需要注释通俗但版本可靠",
        "min_readability": 4,
        "min_scholarly": 3,
        "preferred_styles": ["全注全译", "选注选译"],
        "reason": "中学生需白话翻译辅助理解古文，但底本与注释应有基本学术保障，避免误读。",
    },
    "大学": {
        "desc": "大学生通识或专业课，需要学术性与可读性兼顾",
        "min_readability": 3,
        "min_scholarly": 4,
        "preferred_styles": ["全注全译", "选注选译", "学术校注"],
        "reason": "大学生应在可读基础上接触较权威注本，为后续学术阅读打基础。",
    },
    "学术": {
        "desc": "研究者，需要最权威的校勘本与集释本",
        "min_readability": 1,
        "min_scholarly": 5,
        "preferred_styles": ["学术校注"],
        "reason": "学术研究须用公认权威校注本，底本精审、校勘完整是硬性要求。",
    },
    # ---- 字帖 ----
    "入门": {
        "desc": "零基础，需要大字、描红、笔画清晰",
        "min_readability": 5,
        "min_scholarly": 1,
        "preferred_styles": ["楷书描红", "隶书描红"],
        "reason": "零基础者需从描红或大字入手，笔画清晰易摹，不要求拓本精审。",
    },
    "进阶": {
        "desc": "有基础，需要原大或接近原大临摹，拓本精良",
        "min_readability": 3,
        "min_scholarly": 4,
        "preferred_styles": ["楷书临摹", "隶书临摹"],
        "reason": "有基础者应临摹原拓，体会笔法与间架结构，需拓本精良。",
    },
    "专业": {
        "desc": "研究/收藏级，需要最精拓本，保留原石笔意",
        "min_readability": 1,
        "min_scholarly": 5,
        "preferred_styles": ["楷书原拓精印", "隶书原拓精印"],
        "reason": "专业研究与收藏须用最精拓本，保留原石笔意与风化痕迹。",
    },
    # ---- 通用 ----
    "大众": {
        "desc": "普通读者日常使用",
        "min_readability": 4,
        "min_scholarly": 2,
        "preferred_styles": ["全注全译", "选注", "白话翻译", "楷书描红", "隶书描红"],
        "reason": "日常使用以可读性/适临度为主，版本基本可靠即可。",
    },
}


# ============================================================
#  OCP 协议调用
# ============================================================

def ocp_query(keyword: str) -> dict:
    """OCP Discovery: POST /ocp/query"""
    data = json.dumps({"query": keyword}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/ocp/query",
        data=data,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ocp_resolve(entry_id: str) -> dict:
    """OCP Deal: POST /ocp/resolve"""
    data = json.dumps({"entry_id": entry_id}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/ocp/resolve",
        data=data,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ============================================================
#  意图解析
# ============================================================

def parse_intent(user_input: str) -> dict:
    """从自然语言中提取：品类 + 书名/碑帖名 + 受众 + 预算。"""
    text = user_input.lower()

    product_type = None
    work = None

    # 先查字帖关键词（字帖关键词更具体，优先匹配）
    for w, keywords in PRODUCT_KEYWORDS["字帖"].items():
        if any(k in text for k in keywords):
            product_type = "字帖"
            work = w
            break

    # 再查古籍关键词
    if not product_type:
        for w, keywords in PRODUCT_KEYWORDS["古籍"].items():
            if any(k in text for k in keywords):
                product_type = "古籍"
                work = w
                break

    # 根据品类选受众关键词表
    audience_keywords = COPYBOOK_AUDIENCE_KEYWORDS if product_type == "字帖" else BOOK_AUDIENCE_KEYWORDS
    default_audience = "大众"

    audience = default_audience
    for aud, keywords in audience_keywords.items():
        if any(k in text for k in keywords):
            audience = aud
            break

    # 预算
    budget = None
    m = re.search(r"预算\s*(\d+)", text)
    if m:
        budget = float(m.group(1))
    else:
        m = re.search(r"(\d+)\s*元", text)
        if m:
            budget = float(m.group(1))

    return {
        "product_type": product_type,
        "work": work,
        "audience": audience,
        "budget": budget,
        "raw": user_input,
    }


# ============================================================
#  版本学/碑帖学筛选与排序
# ============================================================

def rank_versions(entries: list, audience: str, budget: float | None) -> list:
    """用 DH 知识给版本排序。"""
    criteria = AUDIENCE_CRITERIA.get(audience, AUDIENCE_CRITERIA["大众"])
    scored = []

    for item in entries:
        e = item["entry"]
        attrs = e["attributes"]
        price = attrs["price"]["amount"]
        readability = attrs["readability"]
        scholarly = attrs["scholarly_rating"]
        style = attrs["annotation_style"]
        audience_tag = attrs["target_audience"]

        if budget is not None and price > budget:
            continue
        if readability < criteria["min_readability"]:
            continue
        if scholarly < criteria["min_scholarly"]:
            continue

        score = 0
        if audience_tag == audience:
            score += 100
        if style in criteria["preferred_styles"]:
            score += 30
        score += scholarly * 5

        scored.append((score, e, attrs))

    scored.sort(key=lambda x: -x[0])
    return scored


# ============================================================
#  明盒评估：对每一个发现的版本给出可解释判断
# ============================================================

def assess_versions(entries: list, audience: str, budget: float | None) -> list:
    """明盒评估：对 OCP Catalog Node 发现的『每一个』版本都给出可解释判断。

    与 rank_versions 的关键区别：不丢弃任何版本，而是对全部版本都计算
    score / qualified / verdict / reasons，让 Agent 的筛选推理完全透明（明盒）。
    Agent 只给建议，最终选择由用户做。
    """
    criteria = AUDIENCE_CRITERIA.get(audience, AUDIENCE_CRITERIA["大众"])
    cat = "古籍"
    if entries:
        cat = entries[0]["entry"]["attributes"].get("category", "古籍")
    is_book = cat == "古籍"
    grade_label = "校勘" if is_book else "拓工"

    assessed = []
    for item in entries:
        e = item["entry"]
        attrs = e["attributes"]
        price = attrs["price"]["amount"]
        readability = attrs["readability"]
        scholarly = attrs["scholarly_rating"]
        style = attrs["annotation_style"]
        audience_tag = attrs["target_audience"]

        reasons = []
        qualified = True

        # 预算
        if budget is not None and price > budget:
            qualified = False
            reasons.append({"type": "fail", "text": f"超出预算：¥{price:.1f} ＞ 上限 ¥{budget:.1f}"})
        else:
            if budget is not None:
                reasons.append({"type": "pass", "text": f"预算内：¥{price:.1f} ≤ ¥{budget:.1f}"})
            else:
                reasons.append({"type": "pass", "text": f"价格：¥{price:.1f}"})

        # 可读性 / 适临度
        rl = "可读性" if is_book else "适临度"
        if readability < criteria["min_readability"]:
            qualified = False
            reasons.append({"type": "fail", "text": f"{rl} {readability}★ 低于「{audience}」最低要求 {criteria['min_readability']}★"})
        else:
            reasons.append({"type": "pass", "text": f"{rl}达标：{readability}★（≥{criteria['min_readability']}★）"})

        # 校勘 / 拓工
        if scholarly < criteria["min_scholarly"]:
            qualified = False
            reasons.append({"type": "fail", "text": f"{grade_label}评级 {scholarly}★ 低于最低要求 {criteria['min_scholarly']}★"})
        else:
            reasons.append({"type": "pass", "text": f"{grade_label}评级达标：{scholarly}★（≥{criteria['min_scholarly']}★）"})

        # 评分（解释性）
        score = 0
        if audience_tag == audience:
            score += 100
            reasons.append({"type": "pass", "text": f"精准匹配受众「{audience}」+100"})
        elif audience_tag == "大众":
            score += 40
            reasons.append({"type": "pass", "text": "通用受众，兼容性强 +40"})
        if style in criteria["preferred_styles"]:
            score += 30
            reasons.append({"type": "pass", "text": f"风格契合「{style}」+30"})
        score += scholarly * 5
        reasons.append({"type": "info", "text": f"{grade_label}权重 +{scholarly * 5}（{scholarly}★）"})

        assessed.append({
            "entry": e,
            "attrs": attrs,
            "score": score,
            "qualified": qualified,
            "verdict": None,
            "reasons": reasons,
        })

    # 排序：合格在前（按分数降序），不合格在后——全部保留，明盒展示
    assessed.sort(key=lambda x: (x["qualified"], x["score"]), reverse=True)
    alt = 0
    for a in assessed:
        if a["qualified"]:
            a["verdict"] = "recommend" if alt == 0 else "alternative"
            alt += 1
        else:
            a["verdict"] = "not_recommended"
    return assessed


def print_version_assessment(a: dict, discipline: str, product_type: str):
    """终端版：打印单个版本的明盒评估。"""
    verdict = a["verdict"]
    attrs = a["attrs"]
    e = a["entry"]
    mark = {"recommend": " ★ 推荐", "alternative": "  备选", "not_recommended": "  ⚠ 需谨慎"}[verdict]
    print(f"    {mark}  {e['title']}  (评分 {a['score']})")
    print(f"         出版社: {attrs['brand']} | 价格: ¥{attrs['price']['amount']:.1f}")
    if product_type == "古籍":
        print(f"         底本: {attrs['base_text']} | 注译风格: {attrs['annotation_style']}")
        print(f"         校勘评级: {'★' * attrs['scholarly_rating']} | 可读性: {'★' * attrs['readability']}")
    else:
        print(f"         拓本来源: {attrs['base_text']} | 书体: {attrs['annotation_style']}")
        print(f"         拓工评级: {'★' * attrs['scholarly_rating']} | 适临度: {'★' * attrs['readability']}")
    print(f"         适读/适临: {', '.join(attrs['recommended_for'])}")
    for r in a["reasons"]:
        icon = {"pass": "  ✓", "fail": "  ✗", "info": "  ·"}[r["type"]]
        print(f"         {icon} {r['text']}")
    print()


# ============================================================
#  交易即教育：文化注释生成
# ============================================================

def generate_cultural_annotation(attrs: dict, audience: str, all_entries: list, product_type: str) -> str:
    """为推荐版本生成一段文化注释——这是「交易即教育」的核心。

    注释结构：
    1. 作品背景（这个 work 是什么，为什么重要）
    2. 此版本定位（底本/拓本来源、评级、风格）
    3. 适读/适临理由（为什么匹配这个受众）
    4. 升级路径（日后深入可换什么版本）
    """
    work = attrs["work"]
    base_text = attrs["base_text"]
    style = attrs["annotation_style"]
    scholarly = attrs["scholarly_rating"]
    readability = attrs["readability"]
    brand = attrs["brand"]
    editor = attrs["editor"]
    era = attrs["era"]
    criteria = AUDIENCE_CRITERIA.get(audience, AUDIENCE_CRITERIA["大众"])

    # 同一 work 的所有版本，按 scholarly 降序，用于生成升级路径
    same_work = sorted(
        [
            {"title": item["entry"]["title"], **item["entry"]["attributes"]}
            for item in all_entries
            if item["entry"]["attributes"]["work"] == work
        ],
        key=lambda a: a["scholarly_rating"],
    )
    upgrades = [a for a in same_work if a["scholarly_rating"] > scholarly]

    stars = lambda n: "★" * n

    if product_type == "古籍":
        lines = [
            f"《{work}》传世注本体系庞大，选择哪一版本直接影响研读效果。",
            f"此版为{brand}出品，底本{base_text}，{style}，校勘{stars(scholarly)}，可读性{stars(readability)}。",
            f"受众为「{audience}」：{criteria['reason']}",
        ]
        if upgrades:
            upgrade_strs = [
                f"《{u['title'].split('（')[0]}》（{u['brand']}，{stars(u['scholarly_rating'])}校勘）"
                for u in upgrades[:2]
            ]
            lines.append(f"日后深入可升级至：{'、'.join(upgrade_strs)}。")
        return " ".join(lines)
    else:
        lines = [
            f"《{work}》为{editor}所书，{era}，为书法史名碑。",
            f"此本为{brand}出品，{style}，{base_text}，拓工印制{stars(scholarly)}，适临度{stars(readability)}。",
            f"受众为「{audience}」：{criteria['reason']}",
        ]
        if upgrades:
            upgrade_strs = [
                f"{u['title'].split('（')[0]}（{u['base_text']}，{stars(u['scholarly_rating'])}）"
                for u in upgrades[:2]
            ]
            lines.append(f"待基础稳固后，可升级至：{'、'.join(upgrade_strs)}。")
        return " ".join(lines)


# ============================================================
#  显示辅助
# ============================================================

def print_version_detail(i: int, score: int, e: dict, attrs: dict, product_type: str):
    marker = " ★ 推荐" if i == 0 else f"  备选{i}"
    print(f"    {marker}  {e['title']}")
    print(f"         出版社: {attrs['brand']} | 价格: ¥{attrs['price']['amount']:.1f}")
    if product_type == "古籍":
        print(f"         底本: {attrs['base_text']} | 注译风格: {attrs['annotation_style']}")
        print(f"         校勘评级: {'★' * attrs['scholarly_rating']} | 可读性: {'★' * attrs['readability']}")
        print(f"         适读: {', '.join(attrs['recommended_for'])}")
    else:
        print(f"         拓本来源: {attrs['base_text']} | 书体: {attrs['annotation_style']}")
        print(f"         拓工评级: {'★' * attrs['scholarly_rating']} | 适临度: {'★' * attrs['readability']}")
        print(f"         适临: {', '.join(attrs['recommended_for'])}")
    print()


# ============================================================
#  主流程
# ============================================================

def run_demo():
    print("=" * 64)
    print("  校雠 Agent — 文献学驱动的文化品版本推荐")
    print("  OCP 协议 | Discovery → Intention → Deal | 交易即教育")
    print("=" * 64)
    print()
    print("试试说：")
    print("  帮我选本楚辞给初中孩子读")
    print("  我想买论语，预算50以内，大学用")
    print("  字帖入门选哪个")
    print("  多宝塔碑进阶临摹")
    print("  曹全碑专业收藏")
    print("  （输入 q 退出）")
    print()

    while True:
        user_input = input("你 > ").strip()
        if user_input.lower() in ("q", "quit", "exit"):
            print("再见。")
            break
        if not user_input:
            continue

        print()

        # ===== Intention 阶段 =====
        intent = parse_intent(user_input)
        if not intent["work"]:
            supported = "古籍：楚辞、论语、诗经、庄子、唐诗三百首 | 字帖：多宝塔碑、曹全碑"
            print(f"  [Agent] 没听出你想找什么。目前支持：{supported}")
            print()
            continue

        print(f"  [意图识别]")
        print(f"    品类: {intent['product_type']}")
        print(f"    目标: {intent['work']}")
        print(f"    受众: {intent['audience']}")
        budget_str = f"{intent['budget']:.0f} 元" if intent["budget"] else "不限"
        print(f"    预算: {budget_str}")
        print()

        # ===== Discovery 阶段 =====
        print(f"  [Discovery] 正在查询 OCP Catalog Node ...")
        result = ocp_query(intent["work"])
        entries = result.get("entries", [])
        print(f"    发现 {result['result_count']} 个版本")
        print()

        if not entries:
            print("  没有找到相关版本。")
            print()
            continue

        # 从结果中推断品类（结果 category 一致）
        product_type = entries[0]["entry"]["attributes"].get("category", "古籍")

        # ===== Intention 阶段（版本学/碑帖学评估，明盒）=====
        assessed = assess_versions(entries, intent["audience"], intent["budget"])
        qualified = [a for a in assessed if a["qualified"]]

        if not qualified:
            print("  [评估] 当前条件下没有合适的版本。请放宽预算或调整受众。")
            print()
            continue

        criteria = AUDIENCE_CRITERIA.get(intent["audience"], AUDIENCE_CRITERIA["大众"])
        discipline = "版本学" if product_type == "古籍" else "碑帖学"
        print(f"  [{discipline}评估] 受众标准：{intent['audience']} — {criteria['desc']}")
        print(f"    评估依据：{criteria['reason']}")
        print(f"    已对 {len(assessed)} 个版本逐本评估：推荐 {len(qualified)} 个，其余供参考。")
        print(f"    （Agent 只给建议，最终由你选）")
        print()

        for a in assessed:
            print_version_assessment(a, discipline, product_type)

        # ===== 交易即教育：文化注释 =====
        top = next(a for a in assessed if a["verdict"] == "recommend")
        annotation = generate_cultural_annotation(
            top["attrs"], intent["audience"], entries, product_type
        )
        print(f"  [交易即教育 · {discipline}注释]")
        # 长文本换行显示
        while len(annotation) > 64:
            cut = annotation[:64]
            idx = cut.rfind("，") or cut.rfind("。") or 64
            print(f"    {annotation[:idx+1]}")
            annotation = annotation[idx+1:]
        print(f"    {annotation}")
        print()

        # ===== Deal 阶段 =====
        entry_id = top["entry"]["entry_id"]
        print(f"  [Deal] 正在通过 OCP resolve 获取下单链接 ...")
        resolved = ocp_resolve(entry_id)
        buy_binding = None
        for ab in resolved.get("action_bindings", []):
            if ab["action_id"] == "buy":
                buy_binding = ab
                break

        print(f"    商品: {resolved['title']}")
        print(f"    价格: ¥{resolved['visible_attributes']['price']['amount']:.1f}")
        if buy_binding:
            print(f"    下单入口: {buy_binding['entrypoint']['url']}")
        print(f"    交易ID: {resolved['commercial_object_id']}")
        print()
        print(f"  [Agent] 推荐已生成，交易流程已走通。如需确认购买，请点击下单入口。")
        print()
        print("-" * 64)
        print()


if __name__ == "__main__":
    run_demo()
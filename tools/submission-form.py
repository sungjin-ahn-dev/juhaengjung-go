#!/usr/bin/env python3
"""
공식 접수 양식(contest-application-consent.docx)을 채운다.

  python3 tools/submission-form.py --form <받은 양식.docx> --out <채운 양식.docx> \
      [--applicant <신청자.json>] [--set GITHUB=https://… --set APK=apk/… --set DEMO=https://… --set VIDEO=파일명.mp4]

- 02장(앱 프로젝트 소개)의 칸 여덟 개는 docs/02_접수양식.md의 `## 1.`~`## 8.` 글로 채운다. 칸은 서식 없는 글만 받는
  입력란(content control)이라 `**소제목**`은 `■ 소제목`, `- 항목`은 `· 항목`으로 바꿔 넣는다. 입력란 자체(tag·alias)는 그대로 둔다.
- 02장 끝의 "필요 시 별지를 추가할 수 있습니다" 다음에 별지(그림)를 붙인다. 그림 목록은 같은 파일의 `## 별지`.
- 01장(참가신청서)·04장(서명)은 --applicant를 줄 때만 아는 칸을 채운다. 동의 여부·서명·서명일자는 본인이 직접 쓰는 칸이라 손대지 않는다.
  신청자 정보(성명·연락처)는 저장소에 두지 않는다 — JSON은 저장소 밖에 둔다. 양식 파일(빈 것·채운 것)도 저장소에 넣지 않는다.

신청자 JSON 예:
  {"unit": "개인", "division": "일반", "team": "홍길동", "rep_name": "홍길동", "rep_role": "기획·개발",
   "rep_org": "", "rep_email": "", "rep_phone": "", "count": 1, "date": [2026, 11, 11],
   "members": [{"name": "홍길동", "org": "", "phone": "", "email": "", "role": "기획·개발"}], "team_name_04": ""}
빈 문자열인 칸은 밑줄을 그대로 남긴다(직접 쓰게).

표준 라이브러리만 쓴다. 채운 뒤에는 Word나 LibreOffice로 열어 눈으로 확인한다.
"""
import argparse
import json
import re
import struct
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "docs" / "02_접수양식.md"
IMG = ROOT / "docs" / "img"

TEXT_W_EMU = 9866 * 635  # 양식의 본문 폭(9866 dxa)
BOX_RPR = '<w:rPr><w:rFonts w:hint="eastAsia"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:eastAsia="ko-KR"/></w:rPr>'


def read_content(sets):
    """docs/02_접수양식.md → {"app": 앱명, "boxes": [칸 1~8의 글], "figs": [(파일, 설명)]}"""
    md = CONTENT.read_text(encoding="utf-8")
    for k, v in sets.items():
        md = md.replace("{{" + k + "}}", v)
    left = sorted(set(re.findall(r"\{\{(\w+)\}\}", md)))
    if left:
        sys.exit(f"채우지 않은 자리표가 있어요: {left} — --set {left[0]}=… 로 준다")
    app = re.search(r"^앱명 / 프로젝트명:\s*(.+)$", md, flags=re.M).group(1).strip()
    parts = re.split(r"^## (.+)$", md, flags=re.M)
    sections = {parts[i].strip(): parts[i + 1] for i in range(1, len(parts) - 1, 2)}
    boxes = []
    for n in range(1, 9):
        key = next((k for k in sections if k.startswith(f"{n}.")), None)
        if key is None:
            sys.exit(f"docs/02_접수양식.md에 '## {n}.' 칸이 없어요")
        boxes.append(plain(sections[key]))
    figs = []
    for line in sections.get("별지", "").splitlines():
        m = re.match(r"\s*\d+\.\s*(\S+)\s*\|\s*(.+)$", line)
        if m:
            figs.append((m.group(1), m.group(2).strip()))
    return {"app": app, "boxes": boxes, "figs": figs}


def plain(md):
    """Markdown 조각 → 입력란에 넣을 서식 없는 글(줄 목록)"""
    out = []
    for raw in md.strip("\n").splitlines():
        line = raw.rstrip()
        m = re.fullmatch(r"\*\*(.+?)\*\*(.*)", line)
        if m:
            line = "■ " + m.group(1) + m.group(2)
        elif line.startswith("- "):
            line = "· " + line[2:]
        line = line.replace("**", "")
        if line == "" and (not out or out[-1] == ""):
            continue
        out.append(line)
    while out and out[-1] == "":
        out.pop()
    return out


NO_AUTOSPACE = '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>'


def no_autospace(p):
    """문단 속성에 한글-영문·숫자 자동 간격 끄기를 넣는다(스키마 순서상 w:spacing 앞, 없으면 w:rPr 앞)."""
    m = re.match(r"(<w:p[^>]*>)(<w:pPr>)(.*?)(</w:pPr>)", p, flags=re.S)
    if not m or "w:autoSpaceDE" in m.group(3):
        return p
    inner = m.group(3)
    for anchor in ("<w:spacing ", "<w:ind ", "<w:contextualSpacing", "<w:jc ", "<w:rPr>"):
        k = inner.find(anchor)
        if k >= 0:
            inner = inner[:k] + NO_AUTOSPACE + inner[k:]
            break
    else:
        inner += NO_AUTOSPACE
    return m.group(1) + m.group(2) + inner + m.group(4) + p[m.end() :]


def run_lines(lines):
    """줄 목록 → 입력란 안의 run 하나(줄바꿈은 <w:br/>)"""
    if not lines:
        return '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
    body = "<w:br/>".join(f'<w:t xml:space="preserve">{escape(l)}</w:t>' if l else '<w:t xml:space="preserve"></w:t>' for l in lines)
    return f"<w:r>{BOX_RPR}{body}</w:r>"


PARA = re.compile(r"<w:p[ >].*?</w:p>", flags=re.S)
TEXT = re.compile(r"(<w:t(?: [^>]*)?>)([^<]*)(</w:t>)")


def para_text(p):
    return "".join(m.group(2) for m in TEXT.finditer(p))


def para_span(x, label, start=0):
    """글(런 여러 개로 쪼개져 있어도 이어 붙인 글)에 label이 든 첫 문단의 (시작, 끝)"""
    for m in PARA.finditer(x, start):
        if label in para_text(m.group(0)):
            return m.start(), m.end()
    return None


def edit_para(p, edits):
    """문단의 이어 붙인 글에서 [(시작, 끝, 새 글)]을 바꾼다 — 런 경계를 넘는 범위도 된다(새 글은 첫 런에 넣는다)."""
    nodes = list(TEXT.finditer(p))
    spans, pos = [], 0
    for m in nodes:
        spans.append((pos, pos + len(m.group(2))))
        pos += len(m.group(2))
    texts = [m.group(2) for m in nodes]
    touched = set()
    for s0, e0, repl in sorted(edits, key=lambda t: -t[0]):
        placed = False
        for idx, (a, b) in enumerate(spans):
            lo, hi = max(s0, a), min(e0, b)
            if lo < hi:
                t = texts[idx]
                texts[idx] = t[: lo - a] + ("" if placed else repl) + t[hi - a :]
                placed = True
                touched.add(idx)
    out, last = [], 0
    for idx, m in enumerate(nodes):
        out.append(p[last : m.start()])
        out.append(('<w:t xml:space="preserve">' if idx in touched else m.group(1)) + texts[idx] + m.group(3))
        last = m.end()
    out.append(p[last:])
    return "".join(out)


def fill_blanks(x, label, values, start=0):
    """label이 든 문단에서 밑줄(_____) 자리를 차례로 values로 바꾼다. None·빈 값이면 밑줄을 남긴다."""
    span = para_span(x, label, start)
    if span is None:
        sys.exit(f"양식에서 '{label}' 문단을 찾지 못했어요(양식이 바뀌었을 수 있어요)")
    ps, pe = span
    p = x[ps:pe]
    blanks = list(re.finditer(r"_{5,}", para_text(p)))
    edits = [(m.start(), m.end(), escape(str(v))) for m, v in zip(blanks, values) if v not in (None, "")]
    p2 = no_autospace(edit_para(p, edits)) if edits else p
    return x[:ps] + p2 + x[pe:], ps + len(p2)


def check_box(x, para_label, option):
    """para_label 문단에서 option 바로 앞의 □를 ■로 바꾼다."""
    span = para_span(x, para_label)
    if span is None:
        sys.exit(f"양식에서 '{para_label}' 문단을 찾지 못했어요")
    ps, pe = span
    p = x[ps:pe]
    joined = para_text(p)
    at = joined.find(option)
    box = joined.rfind("□", 0, at)
    if at < 0 or box < 0:
        sys.exit(f"'{para_label}'에서 '{option}' 선택 칸을 찾지 못했어요")
    return x[:ps] + edit_para(p, [(box, box + 1, "■")]) + x[pe:]


def table_after(x, label):
    """label이 든 문단을 품은 표의 (시작, 끝)"""
    span = para_span(x, label)
    if span is None:
        sys.exit(f"양식에서 '{label}' 표를 찾지 못했어요")
    t0 = x.rfind("<w:tbl>", 0, span[0])
    t1 = x.find("</w:tbl>", span[0]) + len("</w:tbl>")
    return t0, t1


def set_cell(row, col, text, size=18):
    """표의 한 줄에서 col번째 칸의 빈 문단에 글을 넣는다."""
    cells = list(re.finditer(r"<w:tc>.*?</w:tc>", row, flags=re.S))
    c = cells[col]
    cell = c.group(0)
    run = f'<w:r><w:rPr><w:rFonts w:hint="eastAsia"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/><w:lang w:eastAsia="ko-KR"/></w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'
    if "</w:p>" in cell:
        k = cell.rfind("</w:p>")
        cell = cell[:k] + run + cell[k:]
    else:  # <w:p .../> 꼴
        cell = re.sub(r"<w:p ([^>]*)/>", lambda m: f"<w:p {m.group(1)}>{run}</w:p>", cell, count=1)
    return row[: c.start()] + cell + row[c.end() :]


def png_size(path):
    b = path.read_bytes()[:32]
    if b[1:4] != b"PNG":
        sys.exit(f"PNG가 아니에요: {path}")
    return struct.unpack(">II", b[16:24])


def drawing(rid, n, name, descr, cx, cy):
    return (
        f'<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
        f'<wp:docPr id="{9000 + n}" name="{escape(name)}" descr="{escape(descr, {chr(34): "&quot;"})}"/>'
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<pic:nvPicPr><pic:cNvPr id="{9100 + n}" name="{escape(name)}"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>"
    )


def annex(figs):
    """별지 XML과 넣을 그림 목록[(rid, zip 안 경로, 파일)]"""
    ko = '<w:lang w:eastAsia="ko-KR"/>'
    xml = [
        # 쪽을 강제로 넘기지 않는다 — 02장 끝의 안내 두 줄이 다음 쪽으로 넘어가면 그 두 줄만 남은 빈 쪽이 생긴다.
        # 대신 제목·설명·첫 그림 제목·첫 그림을 '다음 문단과 함께'로 묶어, 자리가 모자라면 묶음째 다음 쪽으로 간다.
        f'<w:p><w:pPr><w:pStyle w:val="21"/><w:keepNext/>{NO_AUTOSPACE}<w:spacing w:before="480"/><w:rPr>{ko}</w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia"/>{ko}</w:rPr><w:t>별지 · 02 앱 프로젝트 소개에 딸린 그림</w:t></w:r></w:p>',
        f'<w:p><w:pPr><w:keepNext/>{NO_AUTOSPACE}<w:spacing w:before="60" w:after="60" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia"/><w:color w:val="595959"/><w:sz w:val="19"/><w:szCs w:val="19"/>{ko}</w:rPr>'
        "<w:t>그림은 모두 직접 만들었고, 화면은 시뮬레이터에서 찍은 실제 화면이다. 성명·소속·연락처는 들어 있지 않다.</w:t></w:r></w:p>",
    ]
    media = []
    for n, (file, cap) in enumerate(figs, 1):
        path = IMG / file
        if not path.exists():
            sys.exit(f"그림이 없어요: {path} — node tools/doc-figs.cjs 를 먼저 돌린다")
        w, h = png_size(path)
        cx = TEXT_W_EMU
        cy = round(cx * h / w)
        rid = f"rIdJhgo{n}"
        media.append((rid, f"media/jhgo-fig{n}.png", path))
        xml.append(
            f'<w:p><w:pPr><w:keepNext/>{NO_AUTOSPACE}<w:spacing w:before="240" w:after="80"/></w:pPr>'
            f'<w:r><w:rPr><w:rFonts w:hint="eastAsia"/><w:b/><w:bCs/><w:color w:val="16324F"/><w:sz w:val="21"/><w:szCs w:val="21"/>{ko}</w:rPr><w:t xml:space="preserve">별지 그림 {n}. </w:t></w:r>'
            f'<w:r><w:rPr><w:rFonts w:hint="eastAsia"/><w:sz w:val="21"/><w:szCs w:val="21"/>{ko}</w:rPr><w:t>{escape(cap)}</w:t></w:r></w:p>'
        )
        xml.append(f'<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>{drawing(rid, n, f"별지 그림 {n}", cap, cx, cy)}</w:r></w:p>')
    return "".join(xml), media


def main():
    ap = argparse.ArgumentParser(description="공식 접수 양식 채우기")
    ap.add_argument("--form", required=True, help="내려받은 빈 양식(.docx)")
    ap.add_argument("--out", required=True, help="채운 양식을 쓸 경로(.docx) — 저장소 밖에")
    ap.add_argument("--applicant", help="신청자 정보 JSON(저장소 밖). 없으면 01·04장은 앱 이름만 채운다")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="본문의 {{KEY}} 자리표 값")
    a = ap.parse_args()
    sets = dict(s.split("=", 1) for s in a.set)
    c = read_content(sets)
    who = json.loads(Path(a.applicant).read_text(encoding="utf-8")) if a.applicant else None

    zin = zipfile.ZipFile(a.form)
    names = [i.filename for i in zin.infolist() if not i.filename.endswith("/")]
    data = {n: zin.read(n) for n in names}
    x = data["word/document.xml"].decode("utf-8")

    # ── 02장: 입력란 여덟 개 ──
    sdts = list(re.finditer(r"<w:sdt>.*?</w:sdt>", x, flags=re.S))
    if len(sdts) != 8:
        sys.exit(f"입력란이 8개가 아니에요({len(sdts)}개) — 양식이 바뀌었을 수 있어요")
    for m, lines in reversed(list(zip(sdts, c["boxes"]))):
        sdt = m.group(0)
        if len(lines) > 1:  # 여러 줄을 넣는 칸은 여러 줄 입력란으로
            sdt = sdt.replace("<w:text/>", '<w:text w:multiLine="1"/>')
        sdt = re.sub(r"<w:sdtContent>.*?</w:sdtContent>", lambda _: f"<w:sdtContent>{run_lines(lines)}</w:sdtContent>", sdt, flags=re.S)
        x = x[: m.start()] + sdt + x[m.end() :]
    x = PARA.sub(lambda m: no_autospace(m.group(0)) if "<w:sdt>" in m.group(0) else m.group(0), x)
    # 긴 칸이 쪽을 넘어갈 수 있게: 입력란이 든 표 줄의 '쪽 나눔 금지'를 푼다
    x = re.sub(r"(<w:tr [^>]*><w:trPr>)<w:cantSplit/>(.*?</w:tr>)", lambda m: (m.group(1) + m.group(2)) if "<w:sdt>" in m.group(2) else m.group(0), x, flags=re.S)

    # ── 앱 이름(01·02·04장에 한 번씩) ──
    pos = 0
    n_app = 0
    while True:
        span = para_span(x, "앱명 / 프로젝트명:", pos)
        if span is None:
            break
        x, pos = fill_blanks(x, "앱명 / 프로젝트명:", [c["app"]], pos)
        n_app += 1

    # ── 01장·04장: 신청자가 준 것만 ──
    if who:
        x = check_box(x, "참가 단위:", "개인" if who.get("unit") == "개인" else "팀")
        x = check_box(x, "참가 부문:", "일반(스타트업 포함)" if who.get("division") == "일반" else "대학(원)생")
        x, _ = fill_blanks(x, "팀명(개인 참가 시 성명):", [who.get("team")])
        x, _ = fill_blanks(x, "대표자 성명:", [who.get("rep_name"), who.get("rep_role")])
        x, _ = fill_blanks(x, "대표자 소속(", [who.get("rep_org")])
        x, _ = fill_blanks(x, "대표자 이메일:", [who.get("rep_email")])
        x, _ = fill_blanks(x, "대표자 휴대폰번호:", [who.get("rep_phone")])
        x, _ = fill_blanks(x, "참가 인원:", [who.get("count")])
        d = who.get("date") or [None, None, None]
        x, _ = fill_blanks(x, "작성일:", d)
        # B. 참가 구성원 표
        t0, t1 = table_after(x, "담당 역할")
        tb = x[t0:t1]
        rows = list(re.finditer(r"<w:tr[ >].*?</w:tr>", tb, flags=re.S))
        for r, mem in reversed(list(zip(rows[1:], who.get("members", [])))):
            row = r.group(0)
            for col, key in enumerate(["name", "org", "phone", "email", "role"]):
                if mem.get(key):
                    row = set_cell(row, col, mem[key])
            tb = tb[: r.start()] + row + tb[r.end() :]
        x = x[:t0] + tb + x[t1:]
        # 04장 서명 표: 성명만(동의 여부·서명·날짜는 본인이)
        t0, t1 = table_after(x, "본인 서명")
        tb = x[t0:t1]
        # 첫 줄은 빈 한 칸짜리, 둘째 줄이 제목 — '대표자'·'팀원'으로 시작하는 줄에만 넣는다
        rows = [r for r in re.finditer(r"<w:tr[ >].*?</w:tr>", tb, flags=re.S) if para_text(r.group(0)).startswith(("대표자", "팀원"))]
        for r, mem in reversed(list(zip(rows, who.get("members", [])))):
            if mem.get("name"):
                tb = tb[: r.start()] + set_cell(r.group(0), 1, mem["name"], size=20) + tb[r.end() :]
        x = x[:t0] + tb + x[t1:]
        if who.get("team_name_04"):
            x, _ = fill_blanks(x, "팀명(팀 참가 시):", [who["team_name_04"]])

    # ── 별지 ──
    xml, media = annex(c["figs"])
    span = para_span(x, "필요 시 별지를 추가할 수 있습니다.")
    if span is None:
        sys.exit("양식에서 별지 안내 문단을 찾지 못했어요")
    x = x[: span[1]] + xml + x[span[1] :]
    rels = data["word/_rels/document.xml.rels"].decode("utf-8")
    add = "".join(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{target}"/>' for rid, target, _ in media)
    rels = rels.replace("</Relationships>", add + "</Relationships>")
    ct = data["[Content_Types].xml"].decode("utf-8")
    if 'Extension="png"' not in ct:
        ct = ct.replace("<Default ", '<Default Extension="png" ContentType="image/png"/><Default ', 1)

    data["word/document.xml"] = x.encode("utf-8")
    data["word/_rels/document.xml.rels"] = rels.encode("utf-8")
    data["[Content_Types].xml"] = ct.encode("utf-8")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, data[n])
        for _, target, path in media:
            z.writestr("word/" + target, path.read_bytes(), compress_type=zipfile.ZIP_STORED)
    chars = sum(len(l) for b in c["boxes"] for l in b)
    print(f"채운 양식: {out} ({out.stat().st_size // 1024} KB) · 칸 8개 글자 수 {chars} · 앱 이름 {n_app}곳 · 별지 그림 {len(media)}장 · 신청자 칸 {'채움' if who else '비움'}")


if __name__ == "__main__":
    main()

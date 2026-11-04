import sys, base64
from androguard.core.dex import DEX
from loguru import logger
logger.remove()
out=[]
n=0
for path in sys.argv[1:]:
    d = DEX(open(path,"rb").read())
    cm = d.get_class_manager()
    for c in d.get_classes():
        name=c.get_name()
        if not name.startswith("Lai/pleos/"): continue
        off = c.annotations_off
        if not off: continue
        adir = cm.get_obj_by_offset(off)
        coff = adir.get_class_annotations_off()
        if not coff: continue
        cls_ann = cm.get_obj_by_offset(coff)
        for aoi in cls_ann.get_annotation_off_item():
            ai = aoi.get_annotation_item()
            ea = ai.get_annotation()
            tname = cm.get_type(ea.get_type_idx())
            if tname != "Lkotlin/Metadata;": continue
            k=None; d1=[]; d2=[]
            for el in ea.get_elements():
                ename = cm.get_string(el.get_name_idx())
                v = el.get_value()
                if ename=="k":
                    k = v.get_value()
                elif ename in ("d1","d2"):
                    arr = v.get_value()  # EncodedArray
                    vals = [x.get_value() for x in arr.get_values()]
                    if ename=="d1": d1=vals
                    else: d2=vals
            out.append(f"#CLASS {name} {k}")
            out.append(f"D1 {len(d1)}")
            out.extend(base64.b64encode(s.encode('utf-8')).decode() for s in d1)
            out.append(f"D2 {len(d2)}")
            out.extend(base64.b64encode(s.encode('utf-8')).decode() for s in d2)
            n+=1
open("meta.txt","w").write("\n".join(out))
print(n,"classes with metadata")

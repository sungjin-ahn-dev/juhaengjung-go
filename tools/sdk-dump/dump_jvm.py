import sys, re
from androguard.core.dex import DEX
from loguru import logger
logger.remove()
out = []
for path in sys.argv[1:]:
    d = DEX(open(path, "rb").read())
    for c in d.get_classes():
        name = c.get_name()
        if not name.startswith("Lai/pleos/"):
            continue
        flags = c.get_access_flags_string()
        sup = c.get_superclassname()
        ifaces = c.get_interfaces()
        out.append(f"\n== {flags} {name} extends {sup} implements {ifaces}")
        for f in c.get_fields():
            out.append(f"   F {f.get_access_flags_string()} {f.get_name()} : {f.get_descriptor()}")
        for m in c.get_methods():
            out.append(f"   M {m.get_access_flags_string()} {m.get_name()}{m.get_descriptor()}")
open("pleos-api.txt", "w").write("\n".join(out))
print(len(out), "lines")

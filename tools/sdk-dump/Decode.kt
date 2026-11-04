import org.jetbrains.kotlin.metadata.ProtoBuf
import org.jetbrains.kotlin.metadata.deserialization.Flags
import org.jetbrains.kotlin.metadata.deserialization.NameResolver
import org.jetbrains.kotlin.metadata.deserialization.TypeTable
import org.jetbrains.kotlin.metadata.deserialization.returnType
import org.jetbrains.kotlin.metadata.deserialization.returnType as propReturnType
import org.jetbrains.kotlin.metadata.deserialization.type
import org.jetbrains.kotlin.metadata.deserialization.supertypes
import org.jetbrains.kotlin.metadata.jvm.deserialization.JvmProtoBufUtil
import java.io.File
import java.util.Base64

fun main(args: Array<String>) {
    val lines = File(args[0]).readLines()
    val out = StringBuilder()
    var i = 0
    fun b64(s: String) = String(Base64.getDecoder().decode(s), Charsets.UTF_8)
    while (i < lines.size) {
        val head = lines[i]; i++
        if (!head.startsWith("#CLASS ")) continue
        val (_, jvmName, kStr) = head.split(" ")
        val k = kStr.toInt()
        val n1 = lines[i].substringAfter("D1 ").toInt(); i++
        val d1 = Array(n1) { b64(lines[i + it]) }; i += n1
        val n2 = lines[i].substringAfter("D2 ").toInt(); i++
        val d2 = Array(n2) { b64(lines[i + it]) }; i += n2
        try {
            when (k) {
                1 -> {
                    val (nr, cls) = JvmProtoBufUtil.readClassDataFrom(d1, d2)
                    out.append(renderClass(jvmName, nr, cls))
                }
                2 -> {
                    val (nr, pkg) = JvmProtoBufUtil.readPackageDataFrom(d1, d2)
                    out.append("\n== file $jvmName\n")
                    val tt = TypeTable(pkg.typeTable)
                    for (f in pkg.functionList) out.append("   fun ").append(renderFun(nr, tt, f)).append('\n')
                    for (p in pkg.propertyList) out.append("   val ").append(nr.getString(p.name)).append(": ").append(renderType(nr, tt, p.propReturnType(tt))).append('\n')
                }
                else -> {}
            }
        } catch (e: Throwable) {
            out.append("\n== $jvmName  (decode failed: ${e.javaClass.simpleName}: ${e.message})\n")
        }
    }
    File(args[1]).writeText(out.toString())
    println("done")
}

fun renderClass(jvmName: String, nr: NameResolver, cls: ProtoBuf.Class): String {
    val sb = StringBuilder()
    val tt = TypeTable(cls.typeTable)
    val kind = Flags.CLASS_KIND.get(cls.flags)
    val mods = buildList {
        if (Flags.IS_DATA.get(cls.flags)) add("data")
        if (Flags.MODALITY.get(cls.flags) == ProtoBuf.Modality.ABSTRACT && kind == ProtoBuf.Class.Kind.CLASS) add("abstract")
        if (Flags.MODALITY.get(cls.flags) == ProtoBuf.Modality.SEALED) add("sealed")
    }
    val kindStr = when (kind) {
        ProtoBuf.Class.Kind.INTERFACE -> "interface"
        ProtoBuf.Class.Kind.ENUM_CLASS -> "enum class"
        ProtoBuf.Class.Kind.OBJECT -> "object"
        ProtoBuf.Class.Kind.COMPANION_OBJECT -> "companion object"
        ProtoBuf.Class.Kind.ANNOTATION_CLASS -> "annotation class"
        ProtoBuf.Class.Kind.ENUM_ENTRY -> "enum entry"
        else -> "class"
    }
    val name = nr.getQualifiedClassName(cls.fqName).replace('/', '.')
    val supers = cls.supertypes(tt).map { renderType(nr, tt, it) }.filter { it != "Any" }
    sb.append("\n== ").append((mods + kindStr).joinToString(" ")).append(' ').append(name)
    if (supers.isNotEmpty()) sb.append(" : ").append(supers.joinToString(", "))
    sb.append("   [").append(jvmName).append("]\n")
    if (kind == ProtoBuf.Class.Kind.ENUM_CLASS) {
        sb.append("   entries: ").append(cls.enumEntryList.map { nr.getString(it.name) }.joinToString(", ")).append('\n')
    }
    for (c in cls.constructorList) {
        val sec = Flags.IS_SECONDARY.get(c.flags)
        val vis = Flags.VISIBILITY.get(c.flags)
        if (vis == ProtoBuf.Visibility.PRIVATE) continue
        sb.append("   constructor").append(if (sec) "(secondary)" else "").append('(')
        sb.append(c.valueParameterList.joinToString(", ") { renderParam(nr, tt, it) }).append(")\n")
    }
    for (f in cls.functionList) {
        val vis = Flags.VISIBILITY.get(f.flags)
        if (vis == ProtoBuf.Visibility.PRIVATE || vis == ProtoBuf.Visibility.INTERNAL) continue
        val sus = if (Flags.IS_SUSPEND.get(f.flags)) "suspend " else ""
        val abs = if (Flags.MODALITY.get(f.flags) == ProtoBuf.Modality.ABSTRACT) "abstract " else ""
        sb.append("   ").append(abs).append(sus).append("fun ").append(renderFun(nr, tt, f)).append('\n')
    }
    for (p in cls.propertyList) {
        val vis = Flags.VISIBILITY.get(p.flags)
        if (vis == ProtoBuf.Visibility.PRIVATE || vis == ProtoBuf.Visibility.INTERNAL) continue
        sb.append("   ").append(if (Flags.IS_VAR.get(p.flags)) "var " else "val ").append(nr.getString(p.name)).append(": ").append(renderType(nr, tt, p.propReturnType(tt))).append('\n')
    }
    return sb.toString()
}

fun renderFun(nr: NameResolver, tt: TypeTable, f: ProtoBuf.Function): String {
    val ret = renderType(nr, tt, f.returnType(tt))
    return nr.getString(f.name) + "(" + f.valueParameterList.joinToString(", ") { renderParam(nr, tt, it) } + ")" + (if (ret != "Unit") ": $ret" else "")
}

fun renderParam(nr: NameResolver, tt: TypeTable, vp: ProtoBuf.ValueParameter): String {
    val def = if (Flags.DECLARES_DEFAULT_VALUE.get(vp.flags)) " = …" else ""
    val vararg = if (vp.hasVarargElementType() || vp.hasVarargElementTypeId()) "vararg " else ""
    val t = if (vararg.isNotEmpty()) renderType(nr, tt, if (vp.hasVarargElementType()) vp.varargElementType else tt[vp.varargElementTypeId]) else renderType(nr, tt, vp.type(tt))
    return vararg + nr.getString(vp.name) + ": " + t + def
}

fun renderType(nr: NameResolver, tt: TypeTable, t: ProtoBuf.Type): String {
    val base = when {
        t.hasClassName() -> nr.getQualifiedClassName(t.className).substringAfterLast('/').replace('$', '.')
        t.hasTypeAliasName() -> nr.getQualifiedClassName(t.typeAliasName).substringAfterLast('/')
        t.hasTypeParameter() -> "T${t.typeParameter}"
        t.hasTypeParameterName() -> nr.getString(t.typeParameterName)
        else -> "?"
    }
    val args = t.argumentList.map { a ->
        if (a.projection == ProtoBuf.Type.Argument.Projection.STAR) "*" else {
            val at = if (a.hasType()) a.type else tt[a.typeId]
            val pre = when (a.projection) { ProtoBuf.Type.Argument.Projection.IN -> "in "; ProtoBuf.Type.Argument.Projection.OUT -> "out "; else -> "" }
            pre + renderType(nr, tt, at)
        }
    }
    val fn = Regex("^Function(\\d+)$").find(base)
    val rendered = if (fn != null && args.isNotEmpty()) {
        "(" + args.dropLast(1).joinToString(", ") + ") -> " + args.last()
    } else base + (if (args.isNotEmpty()) "<" + args.joinToString(", ") + ">" else "")
    return if (t.nullable) (if (fn != null) "($rendered)?" else "$rendered?") else rendered
}

package com.vektra.app

import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * A Chess.com screen saved with `adb shell uiautomator dump` (in
 * src/test/resources), read the way the accessibility service sees it.
 */
class ScreenDump(resource: String) {
    val labels = ArrayList<ScreenLabel>()
    val texts = ArrayList<String>()

    init {
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream(resource)) { "missing $resource" }
        val nodes = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(stream).getElementsByTagName("node")
        val bounds = Regex("""\[(\d+),(\d+)]\[(\d+),(\d+)]""")
        for (i in 0 until nodes.length) {
            val node = nodes.item(i) as Element
            val desc = node.getAttribute("content-desc")
            if (desc.isNotBlank()) {
                val (l, t, r, b) = bounds.find(node.getAttribute("bounds"))!!.destructured
                labels += ScreenLabel(desc, l.toInt(), t.toInt(), r.toInt(), b.toInt())
            }
            node.getAttribute("text").takeIf { it.isNotBlank() }?.let { texts += it }
        }
    }
}

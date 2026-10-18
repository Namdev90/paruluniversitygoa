package `in`.navrang.gate

/** RAM-only acknowledgement queue. An issue cannot be displaced by a later receipt. */
class ScanOutcomes(
    private val timeoutMs: Long = 2500,
    private val confirmedDisplayMs: Long = 1200,
) {
    private val pending = linkedMapOf<String, Pair<Long, ScanResult>>()
    private val acknowledged = mutableSetOf<String>()
    private val queue = ArrayDeque<ScanResult>()
    private var shownAt = 0L
    var current: ScanResult? = null
        private set

    var held: ScanResult? = null
        private set

    fun receive(result: ScanResult, now: Long) {
        if (result.pending) {
            if (result.id.isEmpty() || result.id in acknowledged) return
            pending[result.id] = (pending[result.id]?.first ?: now) to result
        } else {
            pending.remove(result.id)
            acknowledged.remove(result.id)
            queue.removeAll { it.id == result.id && it.pending }
        }
        val old = held
        if (old != null) {
            if (old.id == result.id && old.pending) {
                held = result
                current = result
                shownAt = now
            } else if (!result.pending) queue.addLast(result)
            return
        }
        if (queue.isNotEmpty()) {
            if (!result.pending) queue.addLast(result)
            tick(now)
            return
        }
        show(result, now)
        tick(now)
    }

    private fun show(result: ScanResult, now: Long) {
        current = result
        shownAt = now
        if (!result.pending && !result.confirmed) held = result
    }

    fun tick(now: Long) {
        if (held != null) return
        val overdue = pending.values.firstOrNull { now - it.first >= timeoutMs }?.second
        if (overdue != null) {
            current = overdue
            held = overdue
            shownAt = now
            return
        }
        if (queue.isNotEmpty() && now - shownAt >= confirmedDisplayMs)
            show(queue.removeFirst(), now)
    }

    fun acknowledge(now: Long) {
        if (held == null) return
        held?.let {
            if (it.pending) acknowledged.add(it.id)
            pending.remove(it.id)
        }
        held = null
        if (queue.isNotEmpty()) show(queue.removeFirst(), now)
        if (held == null) tick(now)
    }

    fun clear() {
        pending.clear()
        acknowledged.clear()
        queue.clear()
        current = null
        held = null
        shownAt = 0
    }
}

/** Runs the tool. */
fun run() {
    println("run")
}

/**
 * TODO: state what this does, in one active-voice sentence.
 *
 * @param name TODO: state what it is. Do not repeat the type.
 */
class Tool(val name: String) {
    /**
     * TODO: state what this does, in one active-voice sentence.
     * @return TODO: state what the caller gets back.
     */
    fun id(): String {
        return name
    }
}

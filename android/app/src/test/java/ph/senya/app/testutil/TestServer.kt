package ph.senya.app.testutil

import java.io.Closeable
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException

/**
 * Serves files under [root] like `python -m http.server`; 404 for anything missing.
 * Plain sockets, because the Android unit-test classpath has no com.sun.net.httpserver.
 */
class TestServer(private val root: File) : Closeable {
    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    @Volatile private var closed = false
    /** Holds the next response this long, like a free-tier host waking up. */
    @Volatile var nextResponseDelayMs = 0L

    val baseUrl: String = "http://127.0.0.1:${socket.localPort}"

    init {
        Thread {
            while (!closed) {
                try {
                    socket.accept().use { handle(it) }
                } catch (e: SocketException) {
                    // closed
                }
            }
        }.apply { isDaemon = true }.start()
    }

    private fun handle(client: Socket) {
        val reader = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
        val requestLine = reader.readLine() ?: return
        while (reader.readLine()?.isNotEmpty() == true) { /* skip headers */ }
        val path = requestLine.split(" ").getOrNull(1)?.substringBefore('?').orEmpty()
        val file = File(root, path.trimStart('/'))
        val delay = nextResponseDelayMs
        nextResponseDelayMs = 0
        if (delay > 0) Thread.sleep(delay)
        val out = client.getOutputStream()
        if (file.isFile) {
            val bytes = file.readBytes()
            out.write("HTTP/1.1 200 OK\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
            out.write(bytes)
        } else {
            out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
        }
        out.flush()
    }

    override fun close() {
        if (closed) return
        closed = true
        socket.close()
    }
}

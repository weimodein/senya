package ph.senya.app.ml

import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A softmax classifier. [predict] takes a batch of one ([1, 63] or [1, 32, 63]) and returns the N probabilities. */
interface ProbabilityModel : Closeable {
    val inputShape: IntArray
    val outputSize: Int
    fun predict(input: Any): FloatArray
}

class TfliteModel private constructor(buffer: ByteBuffer) : ProbabilityModel {
    private val interpreter = Interpreter(buffer, Interpreter.Options().setNumThreads(2))
    override val inputShape: IntArray = interpreter.getInputTensor(0).shape()
    override val outputSize: Int = interpreter.getOutputTensor(0).shape().last()

    override fun predict(input: Any): FloatArray {
        val output = arrayOf(FloatArray(outputSize))
        interpreter.run(input, output)
        return output[0]
    }

    override fun close() = interpreter.close()

    companion object {
        fun fromBytes(bytes: ByteArray): ProbabilityModel {
            val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
            buffer.put(bytes).rewind()
            return TfliteModel(buffer)
        }
    }
}

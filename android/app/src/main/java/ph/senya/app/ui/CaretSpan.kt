package ph.senya.app.ui

import android.graphics.Canvas
import android.graphics.Paint
import android.text.style.ReplacementSpan
import kotlin.math.ceil

/**
 * The transcript caret (M2 mockup): a thin bar as tall as the letters, drawn instead of a "|" glyph.
 * A glyph can wrap onto its own line and shows up as a stray dot; a span placed after a word joiner can't.
 */
class CaretSpan(private val color: Int, private val widthPx: Float, private val gapPx: Float) : ReplacementSpan() {
    override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
        // Keep the line as tall as the text around it
        if (fm != null) paint.getFontMetricsInt(fm)
        return ceil(gapPx + widthPx).toInt()
    }

    override fun draw(
        canvas: Canvas, text: CharSequence?, start: Int, end: Int,
        x: Float, top: Int, y: Int, bottom: Int, paint: Paint,
    ) {
        val metrics = paint.fontMetrics
        val oldColor = paint.color
        val oldStyle = paint.style
        paint.color = color
        paint.style = Paint.Style.FILL
        canvas.drawRect(x + gapPx, y + metrics.ascent * 0.8f, x + gapPx + widthPx, y + metrics.descent * 0.4f, paint)
        paint.color = oldColor
        paint.style = oldStyle
    }
}

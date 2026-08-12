package com.codecsverige.pdfnative

import android.content.ContentValues
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.rendering.ImageType
import com.tom_roush.pdfbox.rendering.PDFRenderer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

class PdfNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfNative")

    AsyncFunction("inspectPdf") { inputUri: String, password: String? ->
      initialize()
      val document = loadDocument(inputUri, password)
      try {
        val info = document.documentInformation
        mapOf(
          "pageCount" to document.numberOfPages,
          "encrypted" to document.isEncrypted,
          "title" to (info.title ?: ""),
          "author" to (info.author ?: "")
        )
      } finally {
        document.close()
      }
    }

    AsyncFunction("protectPdf") { inputUri: String, outputPath: String, password: String ->
      require(password.length >= 4) { "Password must contain at least 4 characters." }
      initialize()
      val document = loadDocument(inputUri, null)
      try {
        val permissions = AccessPermission()
        val ownerPassword = password + "__pdfpro_owner"
        val policy = StandardProtectionPolicy(ownerPassword, password, permissions)
        policy.encryptionKeyLength = 256
        document.protect(policy)
        saveDocument(document, outputPath)
      } finally {
        document.close()
      }
    }

    AsyncFunction("removePassword") { inputUri: String, outputPath: String, password: String ->
      initialize()
      val document = loadDocument(inputUri, password)
      try {
        document.setAllSecurityToBeRemoved(true)
        saveDocument(document, outputPath)
      } finally {
        document.close()
      }
    }

    AsyncFunction("renderPage") { inputUri: String, pageIndex: Int, outputPath: String, dpi: Double, quality: Int, password: String? ->
      initialize()
      val document = loadDocument(inputUri, password)
      try {
        require(pageIndex >= 0 && pageIndex < document.numberOfPages) { "Page is outside the document range." }
        val renderer = PDFRenderer(document)
        val bitmap = renderer.renderImageWithDPI(pageIndex, dpi.toFloat(), ImageType.RGB)
        writeJpeg(bitmap, outputPath, quality)
        bitmap.recycle()
        fileResult(outputPath, document.numberOfPages)
      } finally {
        document.close()
      }
    }

    AsyncFunction("renderAllPages") { inputUri: String, outputDir: String, dpi: Double, quality: Int, password: String? ->
      initialize()
      val directory = File(pathFromUri(outputDir))
      if (!directory.exists()) directory.mkdirs()
      val document = loadDocument(inputUri, password)
      try {
        val renderer = PDFRenderer(document)
        val results = mutableListOf<Map<String, Any>>()
        for (index in 0 until document.numberOfPages) {
          val bitmap = renderer.renderImageWithDPI(index, dpi.toFloat(), ImageType.RGB)
          val file = File(directory, "page_${(index + 1).toString().padStart(3, '0')}.jpg")
          writeJpeg(bitmap, file.absolutePath, quality)
          bitmap.recycle()
          results.add(
            mapOf(
              "uri" to file.toURI().toString(),
              "page" to index + 1,
              "bytes" to file.length()
            )
          )
        }
        results
      } finally {
        document.close()
      }
    }

    AsyncFunction("compressPdf") { inputUri: String, outputPath: String, mode: String ->
      initialize()
      val settings = when (mode.lowercase()) {
        "extreme" -> Pair(84f, 46)
        "strong" -> Pair(104f, 58)
        else -> Pair(126f, 70)
      }
      rasterCompress(inputUri, outputPath, settings.first, settings.second)
    }

    AsyncFunction("saveToDownloads") { inputUri: String, fileName: String, mimeType: String ->
      saveToDownloads(inputUri, fileName, mimeType)
    }
  }

  private fun initialize() {
    val context = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable.")
    PDFBoxResourceLoader.init(context.applicationContext)
  }

  private fun pathFromUri(value: String): String {
    return if (value.startsWith("file://")) Uri.parse(value).path ?: value.removePrefix("file://") else value
  }

  private fun loadDocument(inputUri: String, password: String?): PDDocument {
    val file = File(pathFromUri(inputUri))
    require(file.exists()) { "PDF file was not found." }
    return if (password.isNullOrEmpty()) PDDocument.load(file) else PDDocument.load(file, password)
  }

  private fun saveDocument(document: PDDocument, outputPath: String): Map<String, Any> {
    val file = File(pathFromUri(outputPath))
    file.parentFile?.mkdirs()
    document.save(file)
    return fileResult(file.absolutePath, document.numberOfPages)
  }

  private fun fileResult(path: String, pageCount: Int): Map<String, Any> {
    val file = File(pathFromUri(path))
    return mapOf(
      "uri" to file.toURI().toString(),
      "bytes" to file.length(),
      "pageCount" to pageCount
    )
  }

  private fun saveToDownloads(inputUri: String, requestedName: String, mimeType: String): Map<String, Any> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw IllegalStateException("Direct Downloads requires Android 10 or newer. Use Save As to choose a folder.")
    }

    val context = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable.")
    val source = File(pathFromUri(inputUri))
    require(source.exists()) { "The generated file was not found." }

    val safeName = requestedName
      .replace(Regex("[\\\\/:*?\"<>|]"), "_")
      .trim()
      .ifEmpty { if (mimeType == "application/pdf") "PDF-Pro-document.pdf" else "PDF-Pro-file" }

    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
      put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PDF Pro")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }

    val outputUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Android could not create the file in Downloads.")

    try {
      resolver.openOutputStream(outputUri, "w")?.use { output ->
        source.inputStream().use { input -> input.copyTo(output, 64 * 1024) }
      } ?: throw IllegalStateException("Android could not open the Downloads destination.")

      values.clear()
      values.put(MediaStore.MediaColumns.IS_PENDING, 0)
      resolver.update(outputUri, values, null, null)

      return mapOf(
        "uri" to outputUri.toString(),
        "bytes" to source.length(),
        "folder" to "Downloads/PDF Pro"
      )
    } catch (error: Throwable) {
      resolver.delete(outputUri, null, null)
      throw error
    }
  }

  private fun writeJpeg(bitmap: Bitmap, outputPath: String, quality: Int) {
    val file = File(pathFromUri(outputPath))
    file.parentFile?.mkdirs()
    FileOutputStream(file).use { stream ->
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(25, 100), stream)) {
        throw IllegalStateException("Could not encode the rendered page.")
      }
    }
  }

  private fun rasterCompress(inputUri: String, outputPath: String, dpi: Float, quality: Int): Map<String, Any> {
    val source = loadDocument(inputUri, null)
    val output = PDDocument()
    try {
      val renderer = PDFRenderer(source)
      for (index in 0 until source.numberOfPages) {
        val sourcePage = source.getPage(index)
        val box = sourcePage.cropBox ?: sourcePage.mediaBox
        val rotated = ((sourcePage.rotation % 360) + 360) % 360
        val pageWidth = if (rotated == 90 || rotated == 270) box.height else box.width
        val pageHeight = if (rotated == 90 || rotated == 270) box.width else box.height

        val bitmap = renderer.renderImageWithDPI(index, dpi, ImageType.RGB)
        val buffer = ByteArrayOutputStream()
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(25, 95), buffer)) {
          bitmap.recycle()
          throw IllegalStateException("Could not compress page ${index + 1}.")
        }
        bitmap.recycle()

        val page = PDPage(PDRectangle(pageWidth, pageHeight))
        output.addPage(page)
        val image = JPEGFactory.createFromStream(output, ByteArrayInputStream(buffer.toByteArray()))
        PDPageContentStream(output, page).use { content ->
          content.drawImage(image, 0f, 0f, pageWidth, pageHeight)
        }
      }

      val outputFile = File(pathFromUri(outputPath))
      outputFile.parentFile?.mkdirs()
      output.save(outputFile)
      val inputFile = File(pathFromUri(inputUri))
      return mapOf(
        "uri" to outputFile.toURI().toString(),
        "bytes" to outputFile.length(),
        "originalBytes" to inputFile.length(),
        "pageCount" to output.numberOfPages,
        "flattened" to true
      )
    } finally {
      output.close()
      source.close()
    }
  }
}

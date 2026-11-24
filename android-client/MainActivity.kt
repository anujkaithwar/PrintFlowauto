package com.printflow.client

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        filePathCallback?.onReceiveValue(uris.toTypedArray())
        filePathCallback = null
    }

    companion object {
        const val DEFAULT_SHOP_URL = "__SHOP_URL__"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.databaseEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Launch UPI payment apps (GPay, PhonePe, Paytm, BHIM) and WhatsApp externally
                if (url.startsWith("upi://") || url.startsWith("https://wa.me/") || url.startsWith("whatsapp://")) {
                    return try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        true
                    } catch (_: Exception) {
                        true
                    }
                }
                return false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                fileChooserLauncher.launch(arrayOf("*/*"))
                return true
            }
        }

        val targetUrl = intent?.data?.toString() ?: DEFAULT_SHOP_URL
        webView.loadUrl(targetUrl)
    }

    fun printCurrentPage(jobName: String) {
        val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
        val printAdapter = webView.createPrintDocumentAdapter(jobName)
        printManager.print(jobName, printAdapter, PrintAttributes.Builder().build())
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}

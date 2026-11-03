package com.vektra.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URL
import java.security.MessageDigest

/**
 * Updates from Vektra's GitHub releases, like the extension's
 * (extension/src/shared/updates.ts): the release workflow attaches a signed
 * vektra-<version>.apk and its SHA-256. The app only checks when its screen
 * opens and installs only when the user taps Update; Android then asks them
 * to confirm, since a sideloaded app can't update itself silently.
 */
object AppUpdater {
    private const val LATEST_RELEASE_API = "https://api.github.com/repos/Filiposakkq/Vektra/releases/latest"

    data class Release(val version: String, val apkUrl: String, val sha256Url: String)

    /** A release's page on GitHub: what changed in it, as the extension links to. */
    fun releasePage(version: String) = "https://github.com/Filiposakkq/Vektra/releases/tag/v$version"

    /** Below zero if [a] is older than [b], zero if equal, above zero if newer ("0.2.10" > "0.2.9"). */
    fun compareVersions(a: String, b: String): Int {
        val x = a.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
        val y = b.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) {
            val d = x.getOrElse(i) { 0 } - y.getOrElse(i) { 0 }
            if (d != 0) return d
        }
        return 0
    }

    /** The latest release if it is newer than [running] and has an APK; network, so not on the main thread. */
    fun newerRelease(running: String): Release? {
        val json = JSONObject(URL(LATEST_RELEASE_API).readText())
        val version = json.getString("tag_name").removePrefix("v")
        if (compareVersions(version, running) <= 0) return null
        val assets = json.getJSONArray("assets")
        val urls = (0 until assets.length()).associate {
            val asset = assets.getJSONObject(it)
            asset.getString("name") to asset.getString("browser_download_url")
        }
        return Release(version, urls["vektra-$version.apk"] ?: return null, urls["vektra-$version.apk.sha256"] ?: return null)
    }

    /** Downloads the APK and checks it against the release's SHA-256; network, so not on the main thread. */
    fun download(context: Context, release: Release): File {
        val apk = File(File(context.cacheDir, "updates").apply { mkdirs() }, "vektra.apk")
        URL(release.apkUrl).openStream().use { input -> apk.outputStream().use { input.copyTo(it) } }
        val expected = URL(release.sha256Url).readText().trim().split(Regex("\\s+")).first().lowercase()
        val actual = MessageDigest.getInstance("SHA-256").digest(apk.readBytes()).joinToString("") { "%02x".format(it) }
        if (actual != expected) {
            apk.delete()
            throw IOException("the download doesn't match its checksum")
        }
        return apk
    }

    /** Hands the APK to Android's installer, which asks the user to confirm (see [InstallResult]). */
    fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val id = installer.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
        installer.openSession(id).use { session ->
            session.openWrite("vektra.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // Mutable: the installer adds the status and its confirmation screen to the intent.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val result = PendingIntent.getBroadcast(context, id, Intent(context, InstallResult::class.java), flags)
            session.commit(result.intentSender)
        }
    }

    /** The installer's answer: show its confirmation screen, or say why it failed. */
    class InstallResult : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                    context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                PackageInstaller.STATUS_SUCCESS -> {}
                else -> {
                    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    Log.w("Vektra", "update not installed: $status $message")
                    if (status != PackageInstaller.STATUS_FAILURE_ABORTED) {
                        Toast.makeText(context, "Vektra couldn't update: ${message ?: "error $status"}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }
}

import groovy.json.JsonSlurper
import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.google.services) apply false
}

// Configuration must be supplied by the project owner. No generated credentials.
val pushEnabled = providers.gradleProperty("navrangPushEnabled").orNull == "true"
val dailySdkIncluded = providers.gradleProperty("navrangDailySdkIncluded").orNull == "true"
val voiceEnabled = providers.gradleProperty("navrangVoiceEnabled").orNull == "true"
val relayOrigin = providers.gradleProperty("navrangRelayOrigin").orNull.orEmpty()
val referenceAdvancePpm = providers.gradleProperty("navrangRelayReferenceAdvancePpm").orNull?.toLongOrNull()
val clockEvidence = providers.gradleProperty("navrangRelayClockEvidenceAccepted").orNull == "true"
// Candidate-only switches. Enable for acceptance before changing release defaults.
val optimizedRelease = providers.gradleProperty("navrangOptimizedRelease").orNull == "true"
val abiDelivery = providers.gradleProperty("navrangAbiSplits").orNull == "true"
// Optional source-built encoder. Toolchain installation/license acceptance is external.
val bundledOpusIncluded = providers.gradleProperty("navrangBundledOpusIncluded").orNull == "true"
val navrangNdkPath = providers.gradleProperty("navrangNdkPath").orNull.orEmpty()
val relayAbis = listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
if (voiceEnabled) {
    val origin = runCatching { URI(relayOrigin) }.getOrNull()
    val host = origin?.host.orEmpty()
    require(origin != null && origin.scheme == "https" && host.contains('.') &&
        host.matches(Regex("[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")) && !host.matches(Regex("[0-9.]+")) &&
        relayOrigin == "https://$host") { "An approved canonical HTTPS relay origin is required." }
    require(referenceAdvancePpm != null && referenceAdvancePpm in 0L..1_000_000L && clockEvidence) {
        "An explicit evidenced relay reference advance bound and clock acceptance are required."
    }
    require(providers.gradleProperty("navrangVoiceMediaAccepted").orNull == "true") {
        "Live relay watchdog and physical-device media acceptance are required before enabling voice."
    }
}
if (pushEnabled) {
    require(file("google-services.json").isFile) { "Owner google-services.json is required for push." }
    apply(plugin = "com.google.gms.google-services")
}

val published = JsonSlurper().parse(rootProject.file("release.json")) as Map<*, *>
val prepareNativeAssets = tasks.register<Exec>("prepareNativeAssets") {
    inputs.file(rootProject.file("tools/prepare-classic-host.py"))
    inputs.file(rootProject.file("app/java/in/navrang/gate/MainActivity.java"))
    outputs.dir(layout.buildDirectory.dir("generated/classicJava"))
    commandLine("python3", rootProject.file("tools/prepare-classic-host.py"), layout.buildDirectory.dir("generated/classicJava").get().asFile)
}
val copyNativeAssets = tasks.register<Sync>("copyNativeAssets") {
    from(rootProject.file("app/assets")) {
        exclude("legacy.html", "notifications.js", "notifications.css", "voice.js", "locator.js", "locator.css")
        exclude("app.js", "vendor/**", "art/event-poster.jpg", "art/ASSET-NOTES.md")
    }
    into(layout.buildDirectory.dir("generated/assets"))
}

val sharedJava =
    tasks.register<Sync>("sharedJava") {
        from(rootProject.file("app/java")) {
            exclude(
                "**/MainActivity.java",
                "**/ScanActivity.java",
                "**/GateBrandingApplication.java",
            )
        }
        into(layout.buildDirectory.dir("generated/java"))
    }
val sharedResources = tasks.register<Sync>("sharedResources") {
    from(rootProject.file("app/res")) { exclude("drawable/app_icon.png") }
    from(rootProject.file("app/assets/art")) {
        include("app-icon.png")
        into("drawable")
        rename { "app_icon.png" }
    }
    from(rootProject.file("app/assets/art")) {
        include("dancer-*.webp", "google-g.png")
        into("drawable")
        rename { it.replace('-', '_') }
    }
    into(layout.buildDirectory.dir("generated/sharedResources"))
}

android {
    namespace = "in.navrang.gate"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "in.navrang.gate"
        minSdk = 24
        targetSdk = 37
        versionCode = (published["versionCode"] as Number).toInt()
        versionName = published["versionName"] as String
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("boolean", "PUSH_ENABLED", pushEnabled.toString())
        buildConfigField("boolean", "VOICE_ENABLED", voiceEnabled.toString())
        buildConfigField("String", "RELAY_ORIGIN", if (voiceEnabled) "\"$relayOrigin\"" else "\"\"")
        buildConfigField("long", "RELAY_REFERENCE_ADVANCE_PPM", "${if (voiceEnabled) referenceAdvancePpm else 0L}L")
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    buildTypes {
        debug {
            // Synthetic tests cannot replace the installed production app or accept its OAuth
            // callback.
            applicationIdSuffix = ".internal"
            versionNameSuffix = "-native-internal"
        }
        release {
            isMinifyEnabled = optimizedRelease
            isShrinkResources = optimizedRelease
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            isCrunchPngs = false
            // Signing is exclusively performed by tools/build-native.py after its
            // original-key/parity gates.
        }
    }
    splits {
        abi {
            isEnable = abiDelivery
            reset()
            include(*relayAbis.toTypedArray())
            isUniversalApk = true
        }
    }
    sourceSets.getByName("main") {
        if (bundledOpusIncluded) jniLibs.directories.add(layout.buildDirectory.dir("generated/relayJni").get().asFile.path)
        if (dailySdkIncluded) java.directories.add(file("src/daily/java").path)
        java.directories.add(layout.buildDirectory.dir("generated/java").get().asFile.path)
        java.directories.add(layout.buildDirectory.dir("generated/classicJava").get().asFile.path)
        assets.directories.add(layout.buildDirectory.dir("generated/assets").get().asFile.path)
        res.directories.add(
            layout.buildDirectory.dir("generated/sharedResources").get().asFile.path
        )
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
    packaging { resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1") }
}

tasks.named("preBuild").configure { dependsOn(prepareNativeAssets, copyNativeAssets, sharedJava, sharedResources) }
if (bundledOpusIncluded) {
    require(navrangNdkPath.isNotEmpty()) { "An already authorized NDK path is required; no license or installation runs during this build." }
    val prepareRelayOpus = tasks.register<Exec>("prepareRelayOpus") {
        inputs.property("navrangNdkPath", navrangNdkPath)
        inputs.property("relayAbis", relayAbis)
        inputs.dir(rootProject.file("native-app/src/main/cpp"))
        inputs.dir(rootProject.file("third_party/opus"))
        inputs.file(rootProject.file("tools/build-relay-opus.py"))
        inputs.file(rootProject.file("tools/relay_opus_artifact.py"))
        outputs.dir(layout.buildDirectory.dir("generated/relayJni"))
        commandLine("python3", rootProject.file("tools/build-relay-opus.py"), "--ndk", navrangNdkPath,
            "--output", layout.buildDirectory.dir("generated/relayJni").get().asFile,
            "--abis", relayAbis.joinToString(","))
    }
    tasks.named("preBuild").configure { dependsOn(prepareRelayOpus) }
}

dependencies {
    if (dailySdkIncluded) implementation("co.daily:client:0.41.0")
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material)
    implementation(libs.compose.icons)
    implementation(libs.activity)
    implementation(libs.fragment)
    implementation(libs.biometric)
    implementation(libs.adaptive)
    implementation(libs.navigation)
    implementation(libs.lifecycle.runtime)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.credentials)
    implementation(libs.credentials.play)
    implementation(libs.googleid)
    implementation(libs.coroutines)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.browser)
    implementation(libs.splash)
    implementation(files("../libs/core-3.5.3.jar"))
    debugImplementation(libs.compose.tooling)
    debugImplementation(libs.compose.test.manifest)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.compose.test)
    testImplementation(libs.coroutines.test)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.test)
}

tasks.withType<Test>().configureEach {
    systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
    listOf(
            "http.proxyHost",
            "http.proxyPort",
            "https.proxyHost",
            "https.proxyPort",
            "javax.net.ssl.trustStore",
        )
        .forEach { key ->
            System.getProperty(key)?.let { systemProperty(key, it) }
        }
    systemProperty(
        "navrang.screenshot.dir",
        layout.buildDirectory.dir("synthetic-screenshots").get().asFile.path,
    )
    maxHeapSize = "2g"
}

import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
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
        // Retain the archived offline prototype in git, never in the installed app.
        // Native import has its own bounded parser; current report-export.js writes XLSX.
        exclude("legacy.html", "legacy-style.css", "app.js", "store.js", "workbook.js",
            "package.js", "local-schema.sql", "vendor/**", "art/event-poster.jpg", "art/ASSET-NOTES.md",
            "art/navrang-parul-combined.png", "art/dancer-male.webp", "art/dancer-female.webp")
    }
    into(layout.buildDirectory.dir("generated/assets"))
}
val prepareRemoteArtwork = tasks.register<Exec>("prepareRemoteArtwork") {
    inputs.file(rootProject.file("tools/prepare-remote-artwork.py"))
    inputs.files(listOf("navrang-parul-combined.png", "dancer-male.webp", "dancer-female.webp").map { rootProject.file("app/assets/art/$it") })
    outputs.dir(layout.buildDirectory.dir("generated/remoteAssets"))
    commandLine("python3", rootProject.file("tools/prepare-remote-artwork.py"), layout.buildDirectory.dir("generated/remoteAssets").get().asFile)
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
            // Remove unreachable legacy UI and unused dependency code from shipped builds.
            optimization { enable = true }
            isCrunchPngs = false
            // Signing is exclusively performed by tools/build-native.py after its
            // original-key/parity gates.
        }
    }
    sourceSets.getByName("main") {
        java.directories.add(layout.buildDirectory.dir("generated/java").get().asFile.path)
        java.directories.add(layout.buildDirectory.dir("generated/classicJava").get().asFile.path)
        assets.directories.add(layout.buildDirectory.dir("generated/assets").get().asFile.path)
        assets.directories.add(layout.buildDirectory.dir("generated/remoteAssets").get().asFile.path)
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

tasks.named("preBuild").configure { dependsOn(prepareNativeAssets, copyNativeAssets, prepareRemoteArtwork, sharedJava, sharedResources) }

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material)
    implementation(libs.compose.icons)
    implementation(libs.activity)
    implementation(libs.fragment)
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

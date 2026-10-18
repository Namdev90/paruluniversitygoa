import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

val published = JsonSlurper().parse(rootProject.file("release.json")) as Map<*, *>
val prepareNativeAssets =
    tasks.register<Exec>("prepareNativeAssets") {
        inputs.file(rootProject.file("tools/PrepareBrands.java"))
        inputs.dir(rootProject.file("app/assets/art"))
        outputs.dir(layout.buildDirectory.dir("generated/branding"))
        commandLine(
            "java",
            "-Djava.awt.headless=true",
            rootProject.file("tools/PrepareBrands.java"),
            rootDir,
            layout.buildDirectory.dir("generated/branding").get().asFile,
        )
    }
val copyNativeAssets =
    tasks.register<Sync>("copyNativeAssets") {
        dependsOn(prepareNativeAssets)
        from(rootProject.file("app/assets")) {
            include(
                "gate-config.json",
                "local-schema.sql",
                "audio/**",
                "art/*.webp",
                "art/google-g.png",
            )
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
                "**/WebViewSupport.java",
            )
        }
        into(layout.buildDirectory.dir("generated/java"))
    }
val sharedResources =
    tasks.register<Sync>("sharedResources") {
        dependsOn(prepareNativeAssets)
        from(rootProject.file("app/res")) { exclude("drawable/app_icon.png", "values/styles.xml") }
        from(layout.buildDirectory.dir("generated/branding/app/res"))
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
            isMinifyEnabled = false
            // Signing is exclusively performed by tools/build-native.py after its
            // original-key/parity gates.
        }
    }
    sourceSets.getByName("main") {
        java.directories.add(layout.buildDirectory.dir("generated/java").get().asFile.path)
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

tasks.named("preBuild").configure { dependsOn(copyNativeAssets, sharedJava, sharedResources) }

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

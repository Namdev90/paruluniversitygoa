# Keep application reflection, generated classic hosts, callback names and bridges.
# Dependencies may still be optimized using their consumer rules.
-keep class in.navrang.gate.** { *; }
# The optional media SDK crosses JNI and reflection boundaries. Retain its API
# until optimized physical-device acceptance verifies its own consumer rules.
-keep class co.daily.** { *; }
-keepclasseswithmembernames,includedescriptorclasses class * { native <methods>; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*

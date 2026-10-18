# Bundled libraries

- SheetJS Community Edition 0.20.3. Copyright SheetJS LLC. Apache License 2.0. Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js. License text: app/assets/vendor/SheetJS-LICENSE.txt.
- Pako 2.1.0 (inflate only). Copyright Vitaly Puzrin, Andrei Tuputcyn and zlib authors. MIT AND Zlib. Source: https://github.com/nodeca/pako/blob/2.1.0/dist/pako_inflate.min.js. License text: app/assets/vendor/pako-LICENSE.txt. Used by the legacy workbook importer to bound ZIP expansion.
- ZXing core 3.5.3. Copyright ZXing authors. Apache License 2.0. Source: https://github.com/zxing/zxing/tree/zxing-3.5.3. Maven artifact: https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar. License text: app/assets/vendor/ZXing-LICENSE.txt.

Android SDK build tools and the platform compile jar are build dependencies, not redistributed runtime components. The prototype signing key is kept private and is not redistributed in this repository.

The unchanged event poster was provided by the organizer. University and event artwork/wordmarks retain their owners' rights and are not relicensed by the repository's MIT code license. The distinct Navrang Gate app mark was generated for this project; see app/assets/art/ASSET-NOTES.md.

jsdom 26.1.0 (MIT) and fake-indexeddb 6.0.1 (Apache-2.0) are development-only DOM/storage test dependencies. Neither is included in the APK or deployed static app.

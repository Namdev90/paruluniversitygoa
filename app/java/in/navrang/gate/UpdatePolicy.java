package in.navrang.gate;
import java.io.*;
import java.security.MessageDigest;
/** Shared, testable rules for this APK distribution channel. */
public final class UpdatePolicy {
 public static final String APP_ID="in.navrang.gate",ROOT="https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/",MANIFEST=ROOT+"updates/latest.json";
 public static final long MAX_APK=25L*1024*1024;
 public static final String[] ABIS={"arm64-v8a","armeabi-v7a","x86_64","x86"};
 public static boolean supportedAbi(String abi){for(String allowed:ABIS)if(allowed.equals(abi))return true;return false;}
 public static String apkUrl(String name,String abi){
  if(abi!=null&&!supportedAbi(abi))throw new IllegalArgumentException("Unsupported APK ABI.");
  return ROOT+"downloads/Navrang-Gate-"+name+(abi==null?"":"-"+abi)+".apk";
 }
 /** ABI is bound by the signed, allowlisted URL; the v1 payload remains compatible. */
 public static void validateArtifact(int version,String name,String url,long bytes,String hash,String abi){
  validate(version,name,url,bytes,hash);
  if(!apkUrl(name,abi).equals(url))throw new IllegalArgumentException("APK ABI does not match its URL.");
 }
 public static String preferredAbi(String[] deviceAbis,java.util.Set<String> available){
  if(deviceAbis!=null)for(String abi:deviceAbis)if(supportedAbi(abi)&&available.contains(abi))return abi;
  return null; // Keep the authenticated universal APK for unknown or uncovered devices.
 }
 public static void validate(int version,String name,String url,long bytes,String hash){
  boolean allowed=apkUrl(name,null).equals(url);for(String abi:ABIS)allowed|=apkUrl(name,abi).equals(url);
  if(version<1||name==null||!name.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?")||!allowed||bytes<100000||bytes>MAX_APK||hash==null||!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid app update metadata.");
 }
 /** Canonical, domain-separated UTF-8 payload shared with the private release signer. */
 public static byte[] manifestBytes(int version,String name,String url,long bytes,String hash){
  validate(version,name,url,bytes,hash);
  return ("navrang-release-v1\n"+APP_ID+"\n"+version+"\n"+name+"\n"+url+"\n"+bytes+"\n"+hash+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8);
 }
 public static boolean authentic(byte[] installedCertificate,int version,String name,String url,long bytes,String hash,byte[] signed){
  try{
   if(installedCertificate==null||installedCertificate.length>16384||signed==null||signed.length<32||signed.length>2048)return false;
   java.security.cert.Certificate certificate=java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(installedCertificate));
   java.security.PublicKey key=certificate.getPublicKey();String algorithm=key.getAlgorithm();
   if(!"RSA".equals(algorithm)&&!"EC".equals(algorithm))return false;
   java.security.Signature signature=java.security.Signature.getInstance("RSA".equals(algorithm)?"SHA256withRSA":"SHA256withECDSA");
   signature.initVerify(key);signature.update(manifestBytes(version,name,url,bytes,hash));return signature.verify(signed);
  }catch(Exception rejected){return false;}
 }
 public static String digest(byte[] value)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(value));}
 public static String hex(byte[] value){StringBuilder b=new StringBuilder();for(byte v:value)b.append(String.format(java.util.Locale.US,"%02x",v&255));return b.toString();}
 public static String hash(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return hex(d.digest());}
}
